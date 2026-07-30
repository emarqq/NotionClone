import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import type { Block, BlockType, Json } from "@/lib/db/types";

export interface BlockInput {
  id: string;
  type: BlockType;
  content: Json;
  position: string;
  parentBlockId?: string | null;
}

export interface ReplacePageBlocksResult {
  /**
   * Incoming block id → freshly minted id, for every block whose id was already
   * owned by a *different* page (see `replacePageBlocks`). Empty in the normal
   * case. The caller should rewrite these ids into the editor's `blockId` attrs
   * so the next save carries the new ids and the remap does not repeat.
   */
  remapped: Record<string, string>;
}

export async function getBlocks(pageId: string): Promise<Block[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("blocks")
    .select("*")
    .eq("page_id", pageId);
  if (error) throw new Error(`getBlocks failed: ${error.message}`);
  // Sort in JS: fractional-index keys are byte-ordered, and the database's
  // locale collation disagrees (e.g. it puts 'Zz' after 'a0').
  return ((data ?? []) as Block[])
    .slice()
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
}

/**
 * Finds which of `ids` are already rows belonging to a page other than `pageId`.
 *
 * A block id reaches us from another page because `data-block-id` survives the
 * OS clipboard: copying a whole block out of page A and pasting it into page B
 * carries A's id along. Without this check the upsert below would set
 * `page_id = B` on A's existing row — i.e. *move* the block, silently deleting
 * the paragraph from page A with no error and no undo path (CODE_REVIEW §E1,
 * reproduced at SQL level).
 *
 * Chunked because PostgREST puts the `in` list in the URL and a large page
 * would otherwise blow the request-line limit.
 */
async function findForeignBlockIds(
  supabase: ReturnType<typeof createServiceSupabase>,
  pageId: string,
  ids: string[]
): Promise<Set<string>> {
  const foreign = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("blocks")
      .select("id, page_id")
      .in("id", slice);
    if (error) {
      throw new Error(`replacePageBlocks ownership check failed: ${error.message}`);
    }
    for (const row of (data ?? []) as { id: string; page_id: string }[]) {
      if (row.page_id !== pageId) foreign.add(row.id);
    }
  }
  return foreign;
}

/**
 * Replaces a page's blocks with the given set (reconciliation): upserts every
 * given row, then deletes rows for the page whose ids are not in the given set.
 * An empty `blocks` array deletes all blocks of the page.
 *
 * **A block row is owned by exactly one page and this function will never
 * re-parent one.** Any incoming id that already belongs to another page is
 * reminted to a fresh uuid and reported back in `remapped` (decision D-007).
 */
export async function replacePageBlocks(
  pageId: string,
  blocks: BlockInput[]
): Promise<ReplacePageBlocksResult> {
  const supabase = createServiceSupabase();
  const now = new Date().toISOString();
  const remapped: Record<string, string> = {};

  let effective = blocks;

  if (blocks.length > 0) {
    const foreign = await findForeignBlockIds(
      supabase,
      pageId,
      blocks.map((b) => b.id)
    );

    if (foreign.size > 0) {
      for (const id of foreign) remapped[id] = crypto.randomUUID();
      // Remap parent references too, so a pasted subtree stays internally
      // consistent once `parent_block_id` becomes real (roadmap B3).
      effective = blocks.map((b) => ({
        ...b,
        id: remapped[b.id] ?? b.id,
        parentBlockId: b.parentBlockId
          ? remapped[b.parentBlockId] ?? b.parentBlockId
          : b.parentBlockId,
      }));
      console.warn(
        `replacePageBlocks: reminted ${foreign.size} block id(s) on page ${pageId} ` +
          `that belong to another page (cross-page paste); source page untouched.`
      );
    }

    const rows = effective.map((b) => ({
      id: b.id,
      page_id: pageId,
      parent_block_id: b.parentBlockId ?? null,
      type: b.type,
      content: b.content,
      position: b.position,
      updated_at: now,
    }));
    const { error: upsertError } = await supabase
      .from("blocks")
      .upsert(rows, { onConflict: "id" });
    if (upsertError) {
      throw new Error(`replacePageBlocks upsert failed: ${upsertError.message}`);
    }
  }

  // Delete this page's rows that are not in the given id set.
  //
  // Done as an explicit id list rather than the previous `not("id","in",...)`
  // string-concatenated filter (CODE_REVIEW §E6): that built a PostgREST filter
  // by interpolating ids into a quoted list, which is both an injection shape
  // and silently wrong for any id containing a quote or comma. Scoping the
  // select to `page_id` also guarantees we can never delete another page's row.
  const keep = new Set(effective.map((b) => b.id));
  const { data: existing, error: listError } = await supabase
    .from("blocks")
    .select("id")
    .eq("page_id", pageId);
  if (listError) {
    throw new Error(`replacePageBlocks list failed: ${listError.message}`);
  }
  const toDelete = ((existing ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !keep.has(id));
  if (toDelete.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const { error: deleteError } = await supabase
        .from("blocks")
        .delete()
        .eq("page_id", pageId)
        .in("id", toDelete.slice(i, i + CHUNK));
      if (deleteError) {
        throw new Error(`replacePageBlocks delete failed: ${deleteError.message}`);
      }
    }
  }

  // Content changed, so bump the page's updated_at ("Edited <date>").
  const { error: touchError } = await supabase
    .from("pages")
    .update({ updated_at: now })
    .eq("id", pageId);
  if (touchError) {
    throw new Error(`replacePageBlocks touch failed: ${touchError.message}`);
  }

  return { remapped };
}
