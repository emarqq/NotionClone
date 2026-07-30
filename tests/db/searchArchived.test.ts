import { beforeAll, describe, expect, it } from "vitest";
import { ensureScratchDb, exec, query, vec } from "./scratchDb";

/**
 * Tests for roadmap C4 / CODE_REVIEW §R5 — archived pages must not be retrieved.
 *
 * `archivePage()` only flips `pages.is_archived`; the chunks stay. Before
 * `20260730000000_exclude_archived_from_search.sql` neither `hybrid_search` nor
 * `neighbor_search` filtered on it, so archiving a page to put it away did not
 * stop the assistant quoting and linking to it.
 *
 * Runs against the DISPOSABLE container (`nc_test_pg`, port 54329), never the
 * real local stack — this file INSERTs and DELETEs fixture rows and the real
 * database holds Erik's actual notes. Skips when Docker is unavailable, which is
 * the case in every sandboxed session.
 */

const available = ensureScratchDb();
const maybe = available ? describe : describe.skip;

const SPACE = "33333333-3333-4333-8333-333333333333";
const LIVE_PAGE = "d0000000-0000-4000-8000-000000000001";
const ARCHIVED_PAGE = "d0000000-0000-4000-8000-000000000002";
const SEED_PAGE = "d0000000-0000-4000-8000-000000000003";
const FILE_ON_ARCHIVED = "f0000000-0000-4000-8000-000000000001";
const FILE_UNATTACHED = "f0000000-0000-4000-8000-000000000002";

const CHUNK_LIVE = "e0000000-0000-4000-8000-000000000001";
const CHUNK_ARCHIVED = "e0000000-0000-4000-8000-000000000002";
const CHUNK_FILE_ON_ARCHIVED = "e0000000-0000-4000-8000-000000000003";
const CHUNK_FILE_UNATTACHED = "e0000000-0000-4000-8000-000000000004";

/**
 * One live page, one archived page, a file attached to the archived page, and an
 * unattached file — every chunk mentioning "kestrel" so a single FTS query
 * reaches all of them, and every embedding on the same seed so the vector arm
 * does too. Anything still returned is returned because the filter failed.
 */
function seed(): void {
  exec(`
    delete from chunks;
    delete from files;
    delete from links;
    delete from pages;
    delete from spaces;

    insert into spaces (id, name, slug) values ('${SPACE}', 'Archive Tests', 'archive-tests');

    insert into pages (id, space_id, title, position, is_archived) values
      ('${LIVE_PAGE}',     '${SPACE}', 'Live Page',     'a0', false),
      ('${ARCHIVED_PAGE}', '${SPACE}', 'Archived Page', 'a1', true),
      ('${SEED_PAGE}',     '${SPACE}', 'Seed Page',     'a2', false);

    insert into files (id, space_id, page_id, storage_path, filename, mime_type, size_bytes) values
      ('${FILE_ON_ARCHIVED}', '${SPACE}', '${ARCHIVED_PAGE}', 'p/attached.pdf',   'attached.pdf',   'application/pdf', 100),
      ('${FILE_UNATTACHED}',  '${SPACE}', null,               'p/unattached.pdf', 'unattached.pdf', 'application/pdf', 100);

    insert into chunks
      (id, source_type, page_id, file_id, space_id, chunk_index, heading_path, content, content_hash, embedding, embedding_model)
    values
      ('${CHUNK_LIVE}',              'page', '${LIVE_PAGE}',     null, '${SPACE}', 0, '{}', 'kestrel notes on a live page',            'ha1', '${vec(3)}', 'test-model'),
      ('${CHUNK_ARCHIVED}',          'page', '${ARCHIVED_PAGE}', null, '${SPACE}', 0, '{}', 'kestrel notes on an archived page',       'ha2', '${vec(3)}', 'test-model'),
      ('${CHUNK_FILE_ON_ARCHIVED}',  'file', null, '${FILE_ON_ARCHIVED}', '${SPACE}', 0, '{}', 'kestrel text inside an attached pdf', 'ha3', '${vec(3)}', 'test-model'),
      ('${CHUNK_FILE_UNATTACHED}',   'file', null, '${FILE_UNATTACHED}',  '${SPACE}', 0, '{}', 'kestrel text inside a loose pdf',     'ha4', '${vec(3)}', 'test-model');
  `);
}

interface Row {
  chunk_id: string;
  content: string;
  title: string;
}

const hybrid = (q: string, embedding = vec(3), count = 20) =>
  query<Row>(
    `select * from hybrid_search($q$${q}$q$, '${embedding}'::vector(768), null, ${count})`
  );

const neighbors = (pageIds: string[], count = 20) =>
  query<Row>(
    `select * from neighbor_search(
       '${vec(3)}'::vector(768),
       array[${pageIds.map((id) => `'${id}'::uuid`).join(",")}],
       null,
       ${count}
     )`
  );

maybe("hybrid_search excludes archived pages (C4 / §R5)", () => {
  beforeAll(() => seed());

  it("returns the chunk on the live page", () => {
    expect(hybrid("kestrel").map((r) => r.chunk_id)).toContain(CHUNK_LIVE);
  });

  it("does NOT return the chunk on the archived page (lexical arm)", () => {
    expect(hybrid("kestrel").map((r) => r.chunk_id)).not.toContain(CHUNK_ARCHIVED);
  });

  it("does NOT return the archived page's chunk via the vector arm either", () => {
    // A query with no lexical hits at all still exercises the vector arm, which
    // is where a filter applied to only one CTE would leak.
    const ids = hybrid("zzzznotawordzzzz").map((r) => r.chunk_id);
    expect(ids).toContain(CHUNK_LIVE);
    expect(ids).not.toContain(CHUNK_ARCHIVED);
  });

  it("excludes a file chunk whose attached page is archived", () => {
    // Archiving a page puts its attachments away with it; a retrievable PDF
    // hanging off an archived page is the same surprise one level down.
    expect(hybrid("kestrel").map((r) => r.chunk_id)).not.toContain(CHUNK_FILE_ON_ARCHIVED);
  });

  it("still returns an unattached file's chunk", () => {
    // files.page_id is null — it was never on an archived page, so nothing about
    // archiving should hide it.
    expect(hybrid("kestrel").map((r) => r.chunk_id)).toContain(CHUNK_FILE_UNATTACHED);
  });

  it("filters before the candidate limit, not after", () => {
    // The bug this pins: filtering in the final select instead of inside the
    // CTEs. 30 archived chunks would fill both top-20 candidate lists, and the
    // one live chunk — which should obviously be returned — would never enter the
    // fusion at all, so the query would answer "nothing found".
    exec(`
      insert into chunks
        (source_type, page_id, space_id, chunk_index, heading_path, content, content_hash, embedding, embedding_model)
      select 'page', '${ARCHIVED_PAGE}', '${SPACE}', 100 + g, '{}',
             'kestrel kestrel kestrel filler ' || g, 'hb' || g, '${vec(3)}', 'test-model'
      from generate_series(1, 30) g;
    `);
    try {
      const ids = hybrid("kestrel").map((r) => r.chunk_id);
      expect(ids).toContain(CHUNK_LIVE);
      expect(ids).not.toContain(CHUNK_ARCHIVED);
    } finally {
      exec(`delete from chunks where content_hash like 'hb%';`);
    }
  });

  it("un-archiving makes a page retrievable again", () => {
    exec(`update pages set is_archived = false where id = '${ARCHIVED_PAGE}';`);
    try {
      expect(hybrid("kestrel").map((r) => r.chunk_id)).toContain(CHUNK_ARCHIVED);
    } finally {
      exec(`update pages set is_archived = true where id = '${ARCHIVED_PAGE}';`);
    }
  });
});

maybe("neighbor_search excludes archived pages (C4 / §R5)", () => {
  beforeAll(() => seed());

  it("returns a live neighbour page's chunk", () => {
    expect(neighbors([LIVE_PAGE]).map((r) => r.chunk_id)).toContain(CHUNK_LIVE);
  });

  it("returns nothing for an archived neighbour page", () => {
    // lib/rag/graph.ts already drops archived pages from the neighbour set, so
    // this is defence in depth: the RPC holds the grant, and the invariant must
    // not depend on a caller remembering it.
    expect(neighbors([ARCHIVED_PAGE])).toHaveLength(0);
  });

  it("keeps the live neighbour when asked for both at once", () => {
    const ids = neighbors([LIVE_PAGE, ARCHIVED_PAGE]).map((r) => r.chunk_id);
    expect(ids).toContain(CHUNK_LIVE);
    expect(ids).not.toContain(CHUNK_ARCHIVED);
  });
});

describe.skipIf(available)("archived-page search filtering (skipped)", () => {
  it("skipped because Docker is unavailable", () => {
    expect(available).toBe(false);
  });
});
