import { beforeAll, describe, expect, it } from "vitest";
import { ensureScratchDb, exec, query, vec } from "./scratchDb";

/**
 * Tests for the `hybrid_search` RPC (supabase/migrations/20260703200000_hybrid_search.sql):
 * FTS + cosine, fused with Reciprocal Rank Fusion at k=60.
 *
 * Runs against a DISPOSABLE container, never the real local stack — these
 * tests INSERT fixture rows, and the real database holds actual notes.
 * If Docker isn't running the suite skips rather than fails.
 */

const available = ensureScratchDb();
const maybe = available ? describe : describe.skip;

/** Stable fixture ids so assertions can name specific rows. */
const SPACE_A = "11111111-1111-4111-8111-111111111111";
const SPACE_B = "22222222-2222-4222-8222-222222222222";
const PAGE_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const PAGE_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/** Rebuild a known corpus. Chunk content is chosen so FTS hits are predictable. */
function seed(): void {
  exec(`
    delete from chunks;
    -- Delete files before spaces/pages: files_space_id_fkey has no ON DELETE
    -- CASCADE, so rows another suite left in the shared scratch container made
    -- this seed fail with an FK violation (order-dependent, so it only bit on a
    -- second run against a dirty container).
    delete from files;
    delete from pages;
    delete from spaces;

    insert into spaces (id, name, slug) values
      ('${SPACE_A}', 'Space A', 'space-a'),
      ('${SPACE_B}', 'Space B', 'space-b');

    insert into pages (id, space_id, title, position) values
      ('${PAGE_A}', '${SPACE_A}', 'Postgres Notes', 'a0'),
      ('${PAGE_B}', '${SPACE_B}', 'Cooking Notes', 'a0');

    insert into chunks
      (id, source_type, page_id, space_id, chunk_index, heading_path, content, content_hash, embedding, embedding_model)
    values
      -- Strong FTS match AND closest vector to seed 1 -> should rank first.
      ('c0000001-0000-4000-8000-000000000001', 'page', '${PAGE_A}', '${SPACE_A}', 0, '{"Indexes"}',
       'Postgres indexes speed up queries dramatically', 'h1', '${vec(1)}', 'test-model'),
      -- FTS match only (vector far away).
      ('c0000002-0000-4000-8000-000000000002', 'page', '${PAGE_A}', '${SPACE_A}', 1, '{"Vacuum"}',
       'Postgres vacuum reclaims dead tuples', 'h2', '${vec(50)}', 'test-model'),
      -- Vector-near (same seed direction as the query) but NO lexical overlap.
      ('c0000003-0000-4000-8000-000000000003', 'page', '${PAGE_A}', '${SPACE_A}', 2, '{"Misc"}',
       'Totally unrelated prose about sailing boats', 'h3', '${vec(1)}', 'test-model'),
      -- Different space entirely, strong FTS match -> used to test space_filter.
      ('c0000004-0000-4000-8000-000000000004', 'page', '${PAGE_B}', '${SPACE_B}', 0, '{"Sauces"}',
       'Postgres is not a sauce but this mentions postgres', 'h4', '${vec(80)}', 'test-model');
  `);
}

maybe("hybrid_search RPC", () => {
  beforeAll(() => seed());

  const call = (opts: {
    q: string;
    embedding?: string;
    space?: string | null;
    count?: number;
  }) =>
    query<{
      chunk_id: string;
      content: string;
      title: string;
      space_id: string;
      rrf_score: number;
    }>(
      `select * from hybrid_search(
         $q$${opts.q}$q$,
         '${opts.embedding ?? vec(1)}'::vector(768),
         ${opts.space === undefined || opts.space === null ? "null" : `'${opts.space}'::uuid`},
         ${opts.count ?? 8}
       )`
    );

  it("returns lexical matches for a plain query", () => {
    const rows = call({ q: "postgres" });
    expect(rows.length).toBeGreaterThan(0);
    const contents = rows.map((r) => r.content).join(" | ");
    expect(contents).toMatch(/Postgres/i);
  });

  it("ranks a chunk matching BOTH arms above one matching only the lexical arm", () => {
    // c1 is both a strong FTS hit and the nearest vector; c2 is FTS-only.
    const rows = call({ q: "postgres", embedding: vec(1) });
    const idx = (id: string) => rows.findIndex((r) => r.chunk_id.startsWith(id));
    const both = idx("c0000001");
    const ftsOnly = idx("c0000002");
    expect(both).toBeGreaterThanOrEqual(0);
    expect(ftsOnly).toBeGreaterThanOrEqual(0);
    expect(both).toBeLessThan(ftsOnly);
  });

  it("orders results by rrf_score descending", () => {
    const scores = call({ q: "postgres" }).map((r) => Number(r.rrf_score));
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
  });

  it("honours match_count", () => {
    expect(call({ q: "postgres", count: 2 }).length).toBeLessThanOrEqual(2);
    expect(call({ q: "postgres", count: 1 }).length).toBe(1);
  });

  it("scopes results to a single space when space_filter is set", () => {
    const rows = call({ q: "postgres", space: SPACE_A });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.space_id).toBe(SPACE_A);
    // The Space B chunk that also says "postgres" must be excluded.
    expect(rows.some((r) => r.chunk_id.startsWith("c0000004"))).toBe(false);
  });

  it("returns chunks from every space when space_filter is null", () => {
    const spaces = new Set(call({ q: "postgres", space: null }).map((r) => r.space_id));
    expect(spaces.has(SPACE_A)).toBe(true);
    expect(spaces.has(SPACE_B)).toBe(true);
  });

  it("joins the page title onto each row", () => {
    const rows = call({ q: "postgres", space: SPACE_A });
    expect(rows.every((r) => r.title === "Postgres Notes")).toBe(true);
  });

  it("still returns vector-only neighbours for a query with no lexical hits", () => {
    // The vector arm is unconditional, so a nonsense query is NOT empty. This
    // is deliberate retrieval behaviour worth pinning: the assistant always
    // gets candidate context.
    const rows = call({ q: "zzzznotawordzzzz", embedding: vec(1) });
    expect(rows.length).toBeGreaterThan(0);
  });

  describe("hostile query strings (websearch_to_tsquery must not throw)", () => {
    // hybrid_search takes query_text as a bound parameter and parses it with
    // websearch_to_tsquery, which tolerates arbitrary user input. These pin
    // that: a search box must never 500 on punctuation, and there is no
    // injection surface via the query string.
    const hostile: [string, string][] = [
      ["single quote", "it's"],
      ["doubled quote", "it''s"],
      ["tsquery operators", "postgres & vacuum | index ! notes"],
      ["colon weight syntax", "postgres:*"],
      ["unbalanced paren", "postgres ) ( index"],
      ["angle/backslash", "postgres <-> index \\ tail"],
      ["sql-ish payload", "'; drop table chunks; --"],
      ["empty string", ""],
      ["only punctuation", "!!! ??? &&&"],
      ["unicode", "postgres — indexé 日本語"],
    ];

    it.each(hostile)("survives %s", (_label, q) => {
      expect(() => call({ q })).not.toThrow();
    });

    it("did not actually drop the chunks table", () => {
      // Proves the injection-looking payload above was treated as search text.
      const rows = query<{ n: number }>("select count(*)::int as n from chunks");
      expect(rows[0].n).toBe(4);
    });
  });
});

describe.skipIf(available)("hybrid_search RPC (skipped)", () => {
  it("skipped because Docker is unavailable", () => {
    expect(available).toBe(false);
  });
});
