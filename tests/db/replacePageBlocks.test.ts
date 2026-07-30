/**
 * Unit tests for `replacePageBlocks` — the page-save reconciliation, and the
 * single most dangerous function in the codebase: every keystroke Erik types
 * eventually goes through it, and two of its historical failure modes destroyed
 * content with no error and no undo path.
 *
 * Covered here:
 *   - CODE_REVIEW §E1 / BUG-1 / D-007 — a block id owned by another page must be
 *     reminted, never re-parented. This is the cross-page copy-paste data-loss
 *     path, reproduced at SQL level on 2026-07-26.
 *   - CODE_REVIEW §E6 — the delete pass must be scoped to `page_id` and driven by
 *     an explicit id list, so it is structurally incapable of touching another
 *     page's rows (it used to interpolate ids into a quoted PostgREST filter).
 *   - Ordinary reconciliation: upsert-in-place, delete-what's-gone, touch the page.
 *
 * Runs against `tests/db/fakeSupabase.ts` rather than Postgres, so it runs in any
 * environment. The transactional version of this reconcile (roadmap A4) is where
 * a real-container integration test belongs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase, type Row } from "./fakeSupabase";

// `lib/db/blocks.ts` calls `createServiceSupabase()` at the top of the function,
// so a module mock is enough — no dependency injection needed.
let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createServiceSupabase: () => fake,
}));

const { replacePageBlocks } = await import("@/lib/db/blocks");

const PAGE_A = "aaaaaaaa-0000-0000-0000-000000000001";
const PAGE_B = "bbbbbbbb-0000-0000-0000-000000000002";

function block(id: string, text: string, position = "a0") {
  return {
    id,
    type: "paragraph" as const,
    content: { type: "text", text } as unknown as never,
    position,
  };
}

function blockRow(id: string, pageId: string, text: string, position = "a0"): Row {
  return {
    id,
    page_id: pageId,
    parent_block_id: null,
    type: "paragraph",
    content: { type: "text", text },
    position,
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("replacePageBlocks — ordinary reconciliation", () => {
  beforeEach(() => {
    fake = createFakeSupabase({
      pages: [
        { id: PAGE_A, updated_at: "2026-01-01T00:00:00.000Z" },
        { id: PAGE_B, updated_at: "2026-01-01T00:00:00.000Z" },
      ],
      blocks: [
        blockRow("11111111-1111-1111-1111-111111111111", PAGE_A, "first", "a0"),
        blockRow("22222222-2222-2222-2222-222222222222", PAGE_A, "second", "a1"),
      ],
    });
  });

  it("updates existing rows in place without changing their ids", async () => {
    const { remapped } = await replacePageBlocks(PAGE_A, [
      block("11111111-1111-1111-1111-111111111111", "first edited", "a0"),
      block("22222222-2222-2222-2222-222222222222", "second", "a1"),
    ]);

    expect(remapped).toEqual({});
    const rows = fake.rows("blocks");
    expect(rows).toHaveLength(2);
    expect(rows[0].content).toEqual({ type: "text", text: "first edited" });
  });

  it("inserts new blocks and deletes ones no longer in the doc", async () => {
    await replacePageBlocks(PAGE_A, [
      block("11111111-1111-1111-1111-111111111111", "first", "a0"),
      block("33333333-3333-3333-3333-333333333333", "third", "a2"),
    ]);

    const ids = fake.rows("blocks").map((r) => r.id);
    expect(ids).toContain("33333333-3333-3333-3333-333333333333");
    expect(ids).not.toContain("22222222-2222-2222-2222-222222222222");
  });

  it("deletes every block when handed an empty doc, and does not upsert", async () => {
    await replacePageBlocks(PAGE_A, []);

    expect(fake.rows("blocks")).toHaveLength(0);
    expect(fake.calls).not.toContain("blocks.upsert");
  });

  it("bumps the page's updated_at so the sidebar shows 'Edited …'", async () => {
    await replacePageBlocks(PAGE_A, [block("11111111-1111-1111-1111-111111111111", "x")]);

    const page = fake.rows("pages").find((p) => p.id === PAGE_A)!;
    expect(page.updated_at).not.toBe("2026-01-01T00:00:00.000Z");
    expect(fake.calls).toContain("pages.update");
  });
});

describe("replacePageBlocks — never steals a block from another page (§E1 / BUG-1 / D-007)", () => {
  const STOLEN = "44444444-4444-4444-4444-444444444444";
  const NATIVE = "55555555-5555-5555-5555-555555555555";

  beforeEach(() => {
    fake = createFakeSupabase({
      pages: [
        { id: PAGE_A, updated_at: "2026-01-01T00:00:00.000Z" },
        { id: PAGE_B, updated_at: "2026-01-01T00:00:00.000Z" },
      ],
      blocks: [
        // The block the user copied *out of* page A. It must survive.
        blockRow(STOLEN, PAGE_A, "page A's only paragraph", "a0"),
        blockRow(NATIVE, PAGE_B, "page B's own paragraph", "a0"),
      ],
    });
  });

  it("leaves the source page's row untouched", async () => {
    await replacePageBlocks(PAGE_B, [
      block(NATIVE, "page B's own paragraph", "a0"),
      block(STOLEN, "page A's only paragraph", "a1"),
    ]);

    const survivor = fake.rows("blocks").find((r) => r.id === STOLEN);
    expect(survivor, "page A's block was deleted — this is BUG-1").toBeDefined();
    expect(survivor!.page_id).toBe(PAGE_A);
    expect(survivor!.content).toEqual({ type: "text", text: "page A's only paragraph" });
  });

  it("remints the pasted block onto a fresh id on the destination page", async () => {
    const { remapped } = await replacePageBlocks(PAGE_B, [
      block(NATIVE, "page B's own paragraph", "a0"),
      block(STOLEN, "page A's only paragraph", "a1"),
    ]);

    expect(Object.keys(remapped)).toEqual([STOLEN]);
    const fresh = remapped[STOLEN];
    expect(fresh).toMatch(UUID_RE);
    expect(fresh).not.toBe(STOLEN);

    const pageB = fake.rows("blocks").filter((r) => r.page_id === PAGE_B);
    expect(pageB.map((r) => r.id).sort()).toEqual([NATIVE, fresh].sort());
  });

  it("does not remint a block that already belongs to this page", async () => {
    const { remapped } = await replacePageBlocks(PAGE_B, [block(NATIVE, "edited", "a0")]);
    expect(remapped).toEqual({});
  });

  it("does not remint a genuinely new id that exists nowhere yet", async () => {
    const brandNew = "66666666-6666-6666-6666-666666666666";
    const { remapped } = await replacePageBlocks(PAGE_B, [
      block(NATIVE, "page B's own paragraph", "a0"),
      block(brandNew, "typed just now", "a1"),
    ]);

    expect(remapped).toEqual({});
    expect(fake.rows("blocks").find((r) => r.id === brandNew)?.page_id).toBe(PAGE_B);
  });

  it("rewrites parent_block_id inside a pasted subtree to the reminted ids", async () => {
    // parent_block_id is written null everywhere today (roadmap B3 makes it
    // real). Assert the remap already handles it, so B3 does not reintroduce a
    // subtree whose children point at the *source* page's parent row.
    const parent = "77777777-7777-7777-7777-777777777777";
    const child = "88888888-8888-8888-8888-888888888888";
    fake = createFakeSupabase({
      pages: [{ id: PAGE_B, updated_at: "2026-01-01T00:00:00.000Z" }],
      blocks: [blockRow(parent, PAGE_A, "parent", "a0"), blockRow(child, PAGE_A, "child", "a1")],
    });

    const { remapped } = await replacePageBlocks(PAGE_B, [
      { ...block(parent, "parent", "a0"), parentBlockId: null },
      { ...block(child, "child", "a1"), parentBlockId: parent },
    ]);

    expect(Object.keys(remapped).sort()).toEqual([parent, child].sort());
    const newChild = fake.rows("blocks").find((r) => r.id === remapped[child])!;
    expect(newChild.parent_block_id).toBe(remapped[parent]);
  });
});

describe("replacePageBlocks — the delete pass cannot reach another page (§E6)", () => {
  it("never deletes rows belonging to a different page", async () => {
    const a1 = "11111111-aaaa-4aaa-8aaa-111111111111";
    const b1 = "22222222-bbbb-4bbb-8bbb-222222222222";
    const b2 = "33333333-bbbb-4bbb-8bbb-333333333333";
    fake = createFakeSupabase({
      pages: [{ id: PAGE_B, updated_at: "2026-01-01T00:00:00.000Z" }],
      blocks: [
        blockRow(a1, PAGE_A, "untouchable", "a0"),
        blockRow(b1, PAGE_B, "keep", "a0"),
        blockRow(b2, PAGE_B, "drop", "a1"),
      ],
    });

    await replacePageBlocks(PAGE_B, [block(b1, "keep", "a0")]);

    const ids = fake.rows("blocks").map((r) => r.id);
    expect(ids).toContain(a1);
    expect(ids).toContain(b1);
    expect(ids).not.toContain(b2);
  });

  it("survives ids containing quotes and commas", async () => {
    // The old implementation built `not("id","in",'("a","b")')` by string
    // concatenation, so any id containing a quote or comma silently produced the
    // wrong filter. uuids never contain those characters, but the *shape* was the
    // defect; this pins the parameterized behaviour.
    const nasty = 'x","y';
    fake = createFakeSupabase({
      pages: [{ id: PAGE_B, updated_at: "2026-01-01T00:00:00.000Z" }],
      blocks: [blockRow(nasty, PAGE_B, "keep me", "a0"), blockRow("plain", PAGE_B, "drop", "a1")],
    });

    await replacePageBlocks(PAGE_B, [block(nasty, "keep me", "a0")]);

    const ids = fake.rows("blocks").map((r) => r.id);
    expect(ids).toEqual([nasty]);
  });
});

describe("replacePageBlocks — errors surface instead of half-applying silently", () => {
  const id = "99999999-9999-4999-8999-999999999999";

  function withFailure(key: string) {
    fake = createFakeSupabase(
      {
        pages: [{ id: PAGE_A, updated_at: "2026-01-01T00:00:00.000Z" }],
        blocks: [blockRow(id, PAGE_A, "x", "a0")],
      },
      { failOn: { [key]: "boom" } }
    );
  }

  it("throws when the ownership pre-check fails, before writing anything", async () => {
    withFailure("blocks.select");
    await expect(replacePageBlocks(PAGE_A, [block(id, "x")])).rejects.toThrow(
      /ownership check failed: boom/
    );
    expect(fake.calls).not.toContain("blocks.upsert");
  });

  it("throws when the upsert fails, before the delete pass runs", async () => {
    withFailure("blocks.upsert");
    await expect(replacePageBlocks(PAGE_A, [block(id, "x")])).rejects.toThrow(
      /upsert failed: boom/
    );
    expect(fake.calls).not.toContain("blocks.delete");
  });

  it("throws when the delete fails", async () => {
    withFailure("blocks.delete");
    await expect(replacePageBlocks(PAGE_A, [])).rejects.toThrow(/delete failed: boom/);
  });

  it("throws when touching the page fails", async () => {
    withFailure("pages.update");
    await expect(replacePageBlocks(PAGE_A, [block(id, "x")])).rejects.toThrow(
      /touch failed: boom/
    );
  });
});
