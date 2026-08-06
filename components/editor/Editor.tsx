"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import clsx from "clsx";

import type { Block } from "@/lib/db/types";
import { saveBlocksAction } from "@/app/actions/editor";
import { blocksFromDoc, docFromBlocks } from "./blockSync";
import { EDITOR_EXTENSIONS } from "./editorExtensions";
import SlashMenu from "./SlashMenu";
import MentionMenu from "./MentionMenu";
import LinkEditor from "./LinkEditor";
import CommentComposer from "./CommentComposer";
import CommentGutter from "./CommentGutter";
import CommentThreadPopover from "./CommentThreadPopover";
import { useCommentStore } from "./commentStore";
import CommentsPanel from "@/components/comments/CommentsPanel";
import AIToolsMenu from "./AIToolsMenu";
import AIProposalCard from "./AIProposalCard";
import ImportStatusToast from "./ImportStatusToast";
import { useImportStore } from "./importStore";
import "./editor.css";

const SAVE_DEBOUNCE_MS = 1500;

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export default function Editor({
  pageId,
  initialBlocks,
  breadcrumb,
}: {
  pageId: string;
  initialBlocks: Block[];
  breadcrumb?: string;
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const router = useRouter();

  const docRef = useRef<PMNode | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while a save request is in flight. Guarantees at most one at a time. */
  const savingRef = useRef(false);
  /** Monotonic id of the newest save; older responses are ignored. */
  const saveSeqRef = useRef(0);
  /** Latest `flush`, so the in-flight completion handler never calls a stale one. */
  const flushRef = useRef<() => void>(() => {});
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  // Build the initial doc once from the server-loaded rows.
  const initialDoc = useMemo(
    () => docFromBlocks(initialBlocks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /**
   * Rewrites `blockId` attrs the server reminted because they belonged to
   * another page (cross-page paste — see D-007). Without this the editor keeps
   * sending the stolen id, the server reminds again on every save, and the row
   * churns a new uuid each time (detaching comment anchors as it goes).
   *
   * Dispatched outside the undo history and tagged so `onUpdate` does not treat
   * it as a user edit.
   */
  const applyBlockIdRemap = useCallback((remap: Record<string, string>) => {
    const ed = editorRef.current;
    if (!ed || ed.isDestroyed) return;
    const { state } = ed;
    const tr = state.tr;
    let changed = false;
    // Top level only, deliberately. `blocksFromDoc` persists one row per
    // top-level node, so the server can only ever remint a top-level id — and a
    // walk over `descendants` would also rewrite a *nested* node that happened to
    // carry the same id (possible right after a duplicating paste). That nested
    // attr lives inside its parent's `content` JSON, and since this transaction
    // is tagged so `onUpdate` ignores it, the change would never be marked dirty
    // and never be saved: an edit silently lost.
    state.doc.forEach((node, offset) => {
      const id: unknown = node.attrs?.blockId;
      if (typeof id === "string" && remap[id]) {
        tr.setNodeAttribute(offset, "blockId", remap[id]);
        changed = true;
      }
    });
    if (!changed) return;
    tr.setMeta("addToHistory", false);
    tr.setMeta("blockIdRemap", true);
    ed.view.dispatch(tr);
    // Keep the snapshot we compare against in sync with the doc we just edited.
    docRef.current = ed.state.doc;
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current || !docRef.current) return;
    // A save is already in flight. Do not start a second one: `replacePageBlocks`
    // is a whole-document replace with a delete pass, so if the older request
    // landed last it would delete blocks that exist only in the newer snapshot —
    // i.e. silently destroy text the user just typed (CODE_REVIEW §E3).
    // The in-flight save re-runs this on completion.
    if (savingRef.current) return;

    const snapshot = docRef.current;
    // Serialize BEFORE claiming the in-flight slot. `blocksFromDoc` is
    // synchronous and can throw (it walks the doc, JSON round-trips it and
    // generates fractional positions); if it threw after `savingRef` was set,
    // the flag would never be cleared and every later flush would return at the
    // guard above — the editor would silently stop saving forever while the
    // indicator sat on "Saving…".
    let blocks: ReturnType<typeof blocksFromDoc>;
    try {
      blocks = blocksFromDoc(snapshot);
    } catch {
      setSaveState("error");
      return;
    }

    savingRef.current = true;
    const seq = ++saveSeqRef.current;
    setSaveState("saving");

    // Whether to immediately re-flush edits that arrived mid-save. Only on
    // success: rescheduling after a failure produced an unbounded 0 ms retry loop
    // against the database for as long as the failure lasted (dirty is no longer
    // cleared on failure, so the condition stayed true forever) — and it outlived
    // unmount, because nothing cancels a timer set after cleanup has run.
    let succeeded = false;

    saveBlocksAction(pageId, blocks)
      .then((result) => {
        // A newer save superseded this one; its response is authoritative.
        // Unreachable while `savingRef` serializes saves — kept as belt and
        // braces, since the cost of being wrong here is deleted text.
        if (seq !== saveSeqRef.current) return;
        if (!result.ok) {
          setSaveState("error");
          return;
        }
        succeeded = true;
        // Clear `dirty` only if nothing changed since we took the snapshot —
        // it must be cleared on *completion*, never on save start.
        if (docRef.current === snapshot) dirtyRef.current = false;
        if (result.remapped) {
          // Never let a remap failure report a save that actually succeeded as an
          // error — the write landed; only the local attr rewrite did not.
          try {
            applyBlockIdRemap(result.remapped);
          } catch {
            /* next save re-mints; the row is safe either way */
          }
        }
        setSaveState(dirtyRef.current ? "pending" : "saved");
      })
      .catch(() => {
        if (seq === saveSeqRef.current) setSaveState("error");
      })
      .finally(() => {
        savingRef.current = false;
        // Edits arrived while we were saving — persist them now, rather than
        // waiting for a keystroke that may never come. On failure we deliberately
        // wait for the next edit instead of retrying in a loop.
        if (succeeded && dirtyRef.current) {
          // Clear first: `scheduleSave` may have installed a debounce timer while
          // we were in flight, and overwriting the handle would orphan that timer
          // — it would still fire, and unmount cleanup could no longer cancel it.
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => flushRef.current(), 0);
        }
      });
  }, [pageId, applyBlockIdRemap]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const scheduleSave = useCallback(
    (doc: PMNode) => {
      docRef.current = doc;
      dirtyRef.current = true;
      setSaveState("pending");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  // Flush pending changes on unmount and (best-effort) on tab close.
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);

  const editor = useEditor({
    immediatelyRender: false,
    // Defined in ./editorExtensions so the schema can be built without React
    // (tests validate generated content against it).
    extensions: EDITOR_EXTENSIONS,
    content: initialDoc,
    editorProps: {
      attributes: {
        class: "editor-prose focus:outline-none",
        "data-page-id": pageId,
      },
      // Client-side navigation when a page mention is clicked (the atom's
      // href is a real /slug/id path, so preventDefault the native nav).
      handleClickOn: (_view, _pos, node, _nodePos, event) => {
        if (node.type.name === "pageMention") {
          const { spaceSlug, pageId: targetId } = node.attrs as {
            spaceSlug: string | null;
            pageId: string | null;
          };
          if (spaceSlug && targetId) {
            event.preventDefault();
            router.push(`/${spaceSlug}/${targetId}`);
            return true;
          }
        }
        // Clicking commented text opens its thread popover. Detect via the
        // rendered span (handleClickOn passes the block node for plain marked
        // text, so node.marks wouldn't carry the comment mark).
        const commentEl = (event.target as HTMLElement | null)?.closest?.(
          "[data-comment-thread]"
        );
        const threadId = commentEl?.getAttribute("data-comment-thread");
        if (threadId) {
          event.preventDefault();
          useCommentStore.getState().openThread(threadId);
          return true;
        }
        return false;
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith("image/")
        );
        if (files.length === 0) return false;
        event.preventDefault();
        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("pageId", pageId);
          fetch("/api/files", { method: "POST", body: formData })
            .then((res) => {
              if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
              return res.json() as Promise<{ id: string }>;
            })
            .then(({ id }) => {
              const { schema } = view.state;
              const node = schema.nodes.image.create({ src: `/api/files/${id}` });
              view.dispatch(view.state.tr.replaceSelectionWith(node));
            })
            .catch((err) => console.error("Image paste failed:", err));
        }
        return true;
      },
    },
    onUpdate: ({ editor: e, transaction }) => {
      // Our own block-id rewrite is not a user edit; re-marking the doc dirty
      // here would queue a redundant save on every remap.
      if (transaction.getMeta("blockIdRemap")) return;
      scheduleSave(e.state.doc);
    },
  });

  // In an effect, not during render: assigning a ref while rendering is a render
  // side effect, and a discarded/interrupted render would leave the ref pointing
  // at an instance that was never committed. Every consumer
  // (`applyBlockIdRemap`) only runs from a post-commit microtask, so this is
  // strictly equivalent and safe under a concurrent renderer.
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Publish this editor (with its pageId) so PageActionsMenu's "Import
  // Markdown" item can reach it — and so a menu opened on a *different* page's
  // sidebar row can tell that it must not.
  useEffect(() => {
    if (!editor) return;
    useImportStore.getState().register(editor, pageId);
    return () => useImportStore.getState().unregister(pageId);
  }, [editor, pageId]);

  const label =
    saveState === "pending" || saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Save failed — retrying on next edit"
          : "";

  return (
    <>
      <div className="relative">
        <div
          className={clsx(
            "pointer-events-none absolute -top-6 right-0 text-xs transition-opacity",
            saveState === "error"
              ? "text-red-500"
              : "text-neutral-400 dark:text-neutral-500",
            label ? "opacity-100" : "opacity-0"
          )}
          aria-live="polite"
        >
          {label}
        </div>
        <EditorContent editor={editor} />
        {editor && (
          <>
            <SlashMenu editor={editor} breadcrumb={breadcrumb} />
            <MentionMenu editor={editor} pageId={pageId} />
            <LinkEditor editor={editor} />
            <CommentComposer editor={editor} pageId={pageId} />
            <CommentGutter editor={editor} />
            <CommentThreadPopover editor={editor} pageId={pageId} />
            <CommentsPanel editor={editor} pageId={pageId} />
            <AIProposalCard editor={editor} />
          </>
        )}
        <ImportStatusToast />
      </div>
      {/*
        AIToolsMenu (Tiptap's BubbleMenu) always renders a placeholder <div>
        that tippy.js physically reparents to document.body outside React's
        tracking. If it shared a DOM parent with SlashMenu/AIProposalCard —
        elements that mount/unmount conditionally — React sometimes picks
        that reparented, no-longer-a-child node as an insertBefore anchor
        when those siblings toggle, throwing "Failed to execute
        'insertBefore' on 'Node': ... is not a child of this node." Keeping
        it outside the div above, in its own sibling slot, means React never
        needs that node as a reconciliation anchor for the toggling elements.

        The dedicated wrapper <div> matters too: the reparented placeholder
        must not be a TOP-LEVEL host node of this component, or React's
        deletion pass calls removeChild on it directly and crashes with
        "Failed to execute 'removeChild'" when Editor is swapped out in place
        (e.g. "Turn into database" re-rendering the same route via
        router.refresh()). The wrapper stays where React put it, so deletion
        removes the wrapper and never touches the reparented node inside.
      */}
      <div>{editor && <AIToolsMenu editor={editor} breadcrumb={breadcrumb} />}</div>
    </>
  );
}
