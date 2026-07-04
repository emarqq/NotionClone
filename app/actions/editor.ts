"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { replacePageBlocks, type BlockInput } from "@/lib/db/blocks";
import { renamePage } from "@/lib/db/pages";
import { ingestPage } from "@/lib/rag/ingest";

/** Re-ingests a page after its content changes; failures never break the caller. */
function scheduleIngest(pageId: string): void {
  after(() =>
    ingestPage(pageId).catch((err) =>
      console.error(`scheduleIngest failed for page ${pageId}:`, err)
    )
  );
}

/** Persists the full ordered block set of a page (reconciliation upsert+delete). */
export async function saveBlocksAction(
  pageId: string,
  blocks: BlockInput[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    await replacePageBlocks(pageId, blocks);
    scheduleIngest(pageId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Renames a page and revalidates the workspace layout so the sidebar updates. */
export async function renamePageTitleAction(
  pageId: string,
  title: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await renamePage(pageId, title.trim() || "Untitled");
    // Revalidate everything under the workspace layout (sidebar + page header).
    revalidatePath("/", "layout");
    // Title feeds chunk breadcrumbs, so re-ingest to refresh them.
    scheduleIngest(pageId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
