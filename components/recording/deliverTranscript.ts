"use client";

import {
  insertTranscriptIntoPageAction,
  markTranscriptInsertedAction,
} from "@/app/actions/recordings";
import { resolveInsertTarget } from "@/components/editor/markdownImport";
import { useImportStore } from "@/components/editor/importStore";
import { turnsToBlocks } from "@/lib/meetings/merge";
import type { LabeledTurn } from "@/lib/meetings/types";

/**
 * Land a finished transcript in the page the recording was started from.
 *
 * Two paths, and the choice between them is load-bearing:
 *
 *  1. The editor is mounted on that exact page → insert as one transaction. The
 *     BlockId extension mints UUID row ids, the editor's normal 1500 ms debounced
 *     save persists it, the post-save hooks (RAG re-index, link sync, vault
 *     export) all fire, and Cmd-Z undoes the whole transcript. This is the same
 *     contract markdown import relies on.
 *
 *  2. Anything else (navigated away, different page open, editor destroyed) →
 *     the server action, which re-sends every existing block alongside the new
 *     ones because replacePageBlocks reconciles.
 *
 * Taking path 2 while an editor IS mounted on the page would race that editor's
 * debounced save and lose data, which is why the check is an exact pageId match
 * and not merely "is there an editor".
 */
export async function deliverTranscript(
  recordingId: string,
  pageId: string,
  turns: LabeledTurn[],
  header: string
): Promise<{ ok: boolean; viaServer: boolean; error?: string }> {
  const { editor, pageId: mountedPageId } = useImportStore.getState();

  if (editor && !editor.isDestroyed && mountedPageId === pageId) {
    try {
      const nodes = turnsToBlocks(turns, header);
      const target = resolveInsertTarget(
        editor.state.doc,
        editor.state.selection.from,
        "end"
      );
      editor.chain().focus().insertContentAt(target, nodes).run();
      await markTranscriptInsertedAction(recordingId);
      return { ok: true, viaServer: false };
    } catch (err) {
      // Fall through to the server path rather than losing the transcript.
      console.error("[meetings] editor insert failed, falling back:", err);
    }
  }

  const result = await insertTranscriptIntoPageAction(recordingId);
  return { ok: result.ok, viaServer: true, error: result.error };
}
