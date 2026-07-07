"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";

import { createThreadAction } from "@/app/actions/comments";
import { useCommentStore } from "./commentStore";

interface Position {
  left: number;
  top: number;
}

/** Stable blockId of the top-level block containing `pos` (see block-id.ts). */
function blockIdAt(editor: Editor, pos: number): string | null {
  try {
    const $pos = editor.state.doc.resolve(pos);
    const node = $pos.depth >= 1 ? $pos.node(1) : null;
    const id = node?.attrs?.blockId;
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

/**
 * "Add comment" composer: a fixed popup at the selection (mirrors LinkEditor)
 * with a message box. On submit it creates the thread + first message, then
 * applies the `comment` mark to the snapshotted range so the highlight persists
 * via the normal debounced save. Cancelling writes nothing (no orphan thread).
 */
export default function CommentComposer({
  editor,
  pageId,
}: {
  editor: Editor;
  pageId: string;
}) {
  const composer = useCommentStore((s) => s.composer);
  const closeComposer = useCommentStore((s) => s.closeComposer);
  const openThread = useCommentStore((s) => s.openThread);
  const refresh = useCommentStore((s) => s.refresh);
  const [value, setValue] = useState("");
  const [pos, setPos] = useState<Position | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!composer) {
      setPos(null);
      return;
    }
    setValue("");
    setSubmitting(false);
    try {
      const coords = editor.view.coordsAtPos(composer.from);
      setPos({
        left: Math.min(coords.left, window.innerWidth - 340),
        top: Math.min(coords.bottom + 6, window.innerHeight - 180),
      });
    } catch {
      setPos({ left: 16, top: 80 });
    }
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [composer, editor]);

  // Dismiss on outside pointer-down. A textarea can't use blur-to-close because
  // clicking the submit button would blur it first.
  useEffect(() => {
    if (!composer) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        closeComposer();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [composer, closeComposer]);

  if (!composer || !pos) return null;

  const cancel = () => {
    closeComposer();
    editor.chain().focus().run();
  };

  const submit = async () => {
    const body = value.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      const blockId = blockIdAt(editor, composer.from);
      const { threadId } = await createThreadAction(
        pageId,
        blockId,
        composer.text,
        body
      );
      editor
        .chain()
        .focus()
        .setTextSelection({ from: composer.from, to: composer.to })
        .setComment(threadId)
        .run();
      closeComposer();
      refresh();
      openThread(threadId);
    } catch (err) {
      console.error("Failed to create comment:", err);
      setSubmitting(false);
    }
  };

  return (
    <div
      ref={boxRef}
      className="fixed z-50 flex w-80 flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label="Add comment"
    >
      <textarea
        ref={inputRef}
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        placeholder="Add a comment…"
        className="w-full resize-none rounded-md border-none bg-transparent px-2 py-1 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={cancel}
          className="rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!value.trim() || submitting}
          className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          Comment
        </button>
      </div>
    </div>
  );
}
