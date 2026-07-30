"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { replacePageBlocks, type BlockInput } from "@/lib/db/blocks";
import { renamePage } from "@/lib/db/pages";
import { reconcilePageLinks } from "@/lib/db/links";
import { reconcilePageComments } from "@/lib/db/comments";
import { ingestPage } from "@/lib/rag/ingest";
import { scheduleExport, scheduleExportRename } from "@/lib/export/schedule";

/** Re-ingests a page after its content changes; failures never break the caller. */
function scheduleIngest(pageId: string): void {
  after(() =>
    ingestPage(pageId).catch((err) =>
      console.error(`scheduleIngest failed for page ${pageId}:`, err)
    )
  );
}

/** Re-derives a page's outgoing backlinks after its content changes; never breaks the caller. */
function scheduleLinkSync(pageId: string): void {
  after(() =>
    reconcilePageLinks(pageId).catch((err) =>
      console.error(`scheduleLinkSync failed for page ${pageId}:`, err)
    )
  );
}

/** Re-syncs a page's comment-thread anchors after its content changes; never breaks the caller. */
function scheduleCommentSync(pageId: string): void {
  after(() =>
    reconcilePageComments(pageId).catch((err) =>
      console.error(`scheduleCommentSync failed for page ${pageId}:`, err)
    )
  );
}

/**
 * Persists the full ordered block set of a page (reconciliation upsert+delete).
 *
 * `remapped` is non-empty when a block arrived carrying an id owned by another
 * page — a cross-page copy-paste. The server reminted those ids rather than
 * stealing the rows (D-007); the editor must write the new ids back into its
 * `blockId` attrs, or every subsequent save will remint again and churn the row.
 */
export async function saveBlocksAction(
  pageId: string,
  blocks: BlockInput[]
): Promise<{ ok: boolean; error?: string; remapped?: Record<string, string> }> {
  try {
    const { remapped } = await replacePageBlocks(pageId, blocks);
    scheduleIngest(pageId);
    scheduleLinkSync(pageId);
    scheduleCommentSync(pageId);
    scheduleExport(pageId);
    return Object.keys(remapped).length > 0
      ? { ok: true, remapped }
      : { ok: true };
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
    // Title drives the vault filename + child folder + inbound [[wikilinks]].
    scheduleExportRename(pageId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
