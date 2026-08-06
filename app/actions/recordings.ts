"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { blockTypeForNode } from "@/components/editor/blockSync";
import { getBlocks, replacePageBlocks, type BlockInput } from "@/lib/db/blocks";
import { transcriptHeader } from "@/lib/meetings/header";
import { turnsToBlocks } from "@/lib/meetings/merge";
import { patchMeta, readMeta, readTurns } from "@/lib/meetings/store";
import { positionAfter } from "@/lib/positions";
import { ingestPage } from "@/lib/rag/ingest";
import type { Json } from "@/lib/db/types";

/**
 * Server-side fallback for landing a transcript in its page.
 *
 * The preferred path is the editor transaction in deliverTranscript.ts — it
 * mints block ids, autosaves, re-indexes RAG and stays undoable. This exists
 * only for the case where the transcript finishes while that page is NOT the
 * mounted editor (the user navigated away, or the tab was reloaded).
 *
 * Bytes never come near a server action — audio goes through route handlers,
 * because server actions cap request bodies at 1 MB. This one moves a few KB of
 * already-transcribed text.
 */

/** Attach a row id to a top-level node, the way the editor's own save does. */
function withBlockId(node: Record<string, unknown>, blockId: string): Json {
  const attrs = (node.attrs as Record<string, unknown> | undefined) ?? {};
  return { ...node, attrs: { ...attrs, blockId } } as Json;
}

export async function insertTranscriptIntoPageAction(
  recordingId: string
): Promise<{ ok: boolean; turnCount?: number; error?: string }> {
  try {
    const meta = await readMeta(recordingId);
    if (meta.insertedAt) return { ok: true, turnCount: meta.turnCount ?? 0 };

    const turns = await readTurns(recordingId);
    if (!turns) return { ok: false, error: "That transcript is not ready yet." };

    const nodes = turnsToBlocks(turns, transcriptHeader(meta));

    /*
     * replacePageBlocks RECONCILES: it deletes every row of the page that is
     * absent from the array it is given. So the existing blocks must be resent
     * verbatim alongside the new ones — passing only the transcript would wipe
     * the page.
     *
     * This is also why the caller must never take this path while an editor is
     * mounted on this page: a debounced save carrying a pre-append snapshot
     * would race this write and delete the transcript (or vice versa). The
     * pageId check in deliverTranscript.ts is what enforces that, and it is not
     * the redundant-looking guard it appears to be.
     */
    const existing = await getBlocks(meta.pageId);
    const rows: BlockInput[] = existing.map((b) => ({
      id: b.id,
      type: b.type,
      content: b.content,
      position: b.position,
      parentBlockId: b.parent_block_id,
    }));

    let prev = rows.length > 0 ? rows[rows.length - 1].position : null;
    for (const node of nodes) {
      const id = crypto.randomUUID();
      const position = positionAfter(prev);
      prev = position;
      rows.push({
        id,
        type: blockTypeForNode(String(node.type)),
        content: withBlockId(node as Record<string, unknown>, id),
        position,
      });
    }

    await replacePageBlocks(meta.pageId, rows);
    await patchMeta(recordingId, { insertedAt: new Date().toISOString() });

    after(() => {
      ingestPage(meta.pageId).catch((err) =>
        console.error("[meetings] transcript re-ingest failed:", err)
      );
    });

    revalidatePath("/", "layout");
    if (meta.spaceSlug) revalidatePath(`/${meta.spaceSlug}/${meta.pageId}`);

    return { ok: true, turnCount: turns.length };
  } catch (err) {
    console.error("[meetings] server insert failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not insert the transcript.",
    };
  }
}

/** Record that the client already inserted the transcript via the editor, so
 *  the recovery sweep stops offering it. */
export async function markTranscriptInsertedAction(
  recordingId: string
): Promise<{ ok: boolean }> {
  try {
    await patchMeta(recordingId, { insertedAt: new Date().toISOString() });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
