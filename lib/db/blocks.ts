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
 * Replaces a page's blocks with the given set (reconciliation):
 * upserts every given row, then deletes rows for the page whose ids are not
 * in the given set. An empty `blocks` array deletes all blocks of the page.
 */
export async function replacePageBlocks(
  pageId: string,
  blocks: BlockInput[]
): Promise<void> {
  const supabase = createServiceSupabase();
  const now = new Date().toISOString();

  if (blocks.length > 0) {
    const rows = blocks.map((b) => ({
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

  // Delete blocks of this page that are not in the given id set.
  let deleteQuery = supabase.from("blocks").delete().eq("page_id", pageId);
  if (blocks.length > 0) {
    const keepIds = blocks.map((b) => b.id);
    deleteQuery = deleteQuery.not(
      "id",
      "in",
      `(${keepIds.map((id) => `"${id}"`).join(",")})`
    );
  }
  const { error: deleteError } = await deleteQuery;
  if (deleteError) {
    throw new Error(`replacePageBlocks delete failed: ${deleteError.message}`);
  }

  // Content changed, so bump the page's updated_at ("Edited <date>").
  const { error: touchError } = await supabase
    .from("pages")
    .update({ updated_at: now })
    .eq("id", pageId);
  if (touchError) {
    throw new Error(`replacePageBlocks touch failed: ${touchError.message}`);
  }
}
