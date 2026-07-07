"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { Check, Trash2 } from "lucide-react";

import {
  addCommentAction,
  deleteThreadAction,
  resolveThreadAction,
} from "@/app/actions/comments";
import type { CommentThreadWithMessages } from "@/lib/db/types";
import { useCommentStore } from "./commentStore";

interface Position {
  left: number;
  top: number;
}

/** Doc position of the start of `threadId`'s comment mark, if still present. */
function findThreadPos(editor: Editor, threadId: string): number | null {
  const markType = editor.state.schema.marks.comment;
  if (!markType) return null;
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type === markType && m.attrs.threadId === threadId
      )
    ) {
      found = pos;
      return false;
    }
    return undefined;
  });
  return found;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Read/reply popover for a comment thread. Opened by clicking a highlight or a
 * panel row (via commentStore.openThreadId). Anchors to the thread's mark in the
 * doc (or the top-right corner if the anchor is gone / orphaned), fetches the
 * thread from /api/comments, and offers reply / resolve / delete. Resolve and
 * delete remove the inline mark, which persists via the normal save.
 */
export default function CommentThreadPopover({
  editor,
  pageId,
}: {
  editor: Editor;
  pageId: string;
}) {
  const openThreadId = useCommentStore((s) => s.openThreadId);
  const closeThread = useCommentStore((s) => s.closeThread);
  const refreshKey = useCommentStore((s) => s.refreshKey);
  const refresh = useCommentStore((s) => s.refresh);

  const [thread, setThread] = useState<CommentThreadWithMessages | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Position at the thread's highlight (top-right fallback if the anchor is gone).
  useEffect(() => {
    if (!openThreadId) {
      setPos(null);
      return;
    }
    const at = findThreadPos(editor, openThreadId);
    try {
      if (at !== null) {
        const coords = editor.view.coordsAtPos(at);
        setPos({
          left: Math.min(coords.left, window.innerWidth - 380),
          top: Math.min(coords.bottom + 6, window.innerHeight - 280),
        });
      } else {
        setPos({ left: Math.max(16, window.innerWidth - 380), top: 120 });
      }
    } catch {
      setPos({ left: 16, top: 80 });
    }
  }, [openThreadId, editor, refreshKey]);

  // Fetch (and refetch after each mutation).
  useEffect(() => {
    if (!openThreadId) {
      setThread(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/comments?pageId=${pageId}`)
      .then((r) => r.json() as Promise<{ threads?: CommentThreadWithMessages[] }>)
      .then((data) => {
        if (cancelled) return;
        setThread(data.threads?.find((t) => t.id === openThreadId) ?? null);
      })
      .catch((err) => console.error("Failed to load comment thread:", err));
    return () => {
      cancelled = true;
    };
  }, [openThreadId, pageId, refreshKey]);

  // Emphasize the active thread's highlight while the popover is open.
  useEffect(() => {
    if (!openThreadId) return;
    const spans = editor.view.dom.querySelectorAll(
      `[data-comment-thread="${openThreadId}"]`
    );
    spans.forEach((el) => el.setAttribute("data-active", "true"));
    return () => spans.forEach((el) => el.removeAttribute("data-active"));
  }, [openThreadId, editor, thread]);

  // Close on outside pointer-down.
  useEffect(() => {
    if (!openThreadId) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        closeThread();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openThreadId, closeThread]);

  if (!openThreadId || !pos) return null;

  const submitReply = async () => {
    const body = reply.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await addCommentAction(openThreadId, body);
      setReply("");
      refresh();
    } catch (err) {
      console.error("Failed to add reply:", err);
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await resolveThreadAction(openThreadId, true);
      editor.chain().unsetComment(openThreadId).run();
      closeThread();
      refresh();
    } catch (err) {
      console.error("Failed to resolve thread:", err);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteThreadAction(openThreadId);
      editor.chain().unsetComment(openThreadId).run();
      closeThread();
      refresh();
    } catch (err) {
      console.error("Failed to delete thread:", err);
      setBusy(false);
    }
  };

  return (
    <div
      ref={boxRef}
      className="fixed z-50 flex w-[22rem] flex-col rounded-lg border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      style={{ left: pos.left, top: pos.top }}
      role="dialog"
      aria-label="Comment thread"
    >
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <span className="truncate text-xs text-neutral-400 dark:text-neutral-500">
          {thread?.orphaned
            ? "Comment (anchor removed)"
            : thread?.anchor_text
              ? `“${thread.anchor_text}”`
              : "Comment"}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title="Resolve"
            onClick={resolve}
            disabled={busy}
            className="flex items-center justify-center rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-green-600 disabled:opacity-40 dark:hover:bg-neutral-800"
          >
            <Check size={15} />
          </button>
          <button
            type="button"
            title="Delete"
            onClick={remove}
            disabled={busy}
            className="flex items-center justify-center rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-neutral-800"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto px-3 py-2">
        {thread === null ? (
          <p className="py-2 text-xs text-neutral-400">Loading…</p>
        ) : thread.comments.length === 0 ? (
          <p className="py-2 text-xs text-neutral-400">No messages.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {thread.comments.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5">
                <div className="text-xs text-neutral-400 dark:text-neutral-500">
                  {c.author ?? "You"} · {formatTime(c.created_at)}
                </div>
                <div className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-100">
                  {c.body}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-neutral-100 p-2 dark:border-neutral-800">
        <textarea
          rows={2}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submitReply();
            } else if (e.key === "Escape") {
              e.preventDefault();
              closeThread();
            }
          }}
          placeholder="Reply…"
          className="w-full resize-none rounded-md border-none bg-transparent px-2 py-1 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void submitReply()}
            disabled={!reply.trim() || busy}
            className="rounded-md bg-secondary px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
          >
            Reply
          </button>
        </div>
      </div>
    </div>
  );
}
