"use client";

import { useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import { MessageSquare, X } from "lucide-react";

import type { CommentThreadWithMessages } from "@/lib/db/types";
import { useCommentStore } from "@/components/editor/commentStore";

/**
 * Side panel listing every comment thread on the page. A floating pill toggles
 * it; each row jumps to (scrolls + opens) its thread via the store, which the
 * CommentThreadPopover consumes. Reads live from GET /api/comments, refetching
 * on every mutation (refreshKey). Mounted inside the editor so it can scroll the
 * anchor into view.
 */
export default function CommentsPanel({
  editor,
  pageId,
}: {
  editor: Editor;
  pageId: string;
}) {
  const panelOpen = useCommentStore((s) => s.panelOpen);
  const togglePanel = useCommentStore((s) => s.togglePanel);
  const openThread = useCommentStore((s) => s.openThread);
  const openThreadId = useCommentStore((s) => s.openThreadId);
  const refreshKey = useCommentStore((s) => s.refreshKey);

  const [threads, setThreads] = useState<CommentThreadWithMessages[]>([]);
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/comments?pageId=${pageId}`)
      .then((r) => r.json() as Promise<{ threads?: CommentThreadWithMessages[] }>)
      .then((data) => {
        if (!cancelled) setThreads(data.threads ?? []);
      })
      .catch((err) => console.error("Failed to load comments:", err));
    return () => {
      cancelled = true;
    };
  }, [pageId, refreshKey]);

  const activeCount = useMemo(
    () => threads.filter((t) => !t.resolved).length,
    [threads]
  );
  const resolvedCount = threads.length - activeCount;

  const visible = threads.filter((t) => (showResolved ? t.resolved : !t.resolved));

  // Nothing to surface yet → keep the chrome out of the way.
  if (threads.length === 0 && !panelOpen) return null;

  const jumpTo = (thread: CommentThreadWithMessages) => {
    const el = editor.view.dom.querySelector<HTMLElement>(
      `[data-comment-thread="${thread.id}"]`
    );
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    openThread(thread.id);
  };

  return (
    <>
      <button
        type="button"
        onClick={togglePanel}
        title="Comments"
        className="fixed bottom-6 right-6 z-40 flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-2 text-sm shadow-md hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <MessageSquare size={15} />
        {activeCount > 0 && <span className="font-medium">{activeCount}</span>}
      </button>

      {panelOpen && (
        <div className="fixed bottom-20 right-6 z-40 flex max-h-[60vh] w-80 flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
            <span className="text-sm font-medium">Comments</span>
            <button
              type="button"
              onClick={togglePanel}
              title="Close"
              className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex gap-1 px-3 py-2 text-xs">
            <button
              type="button"
              onClick={() => setShowResolved(false)}
              className={
                !showResolved
                  ? "rounded-md bg-secondary/15 px-2 py-1 font-medium text-secondary"
                  : "rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }
            >
              Open {activeCount > 0 && `(${activeCount})`}
            </button>
            <button
              type="button"
              onClick={() => setShowResolved(true)}
              className={
                showResolved
                  ? "rounded-md bg-secondary/15 px-2 py-1 font-medium text-secondary"
                  : "rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }
            >
              Resolved {resolvedCount > 0 && `(${resolvedCount})`}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {visible.length === 0 ? (
              <p className="px-2 py-3 text-xs text-neutral-400">
                {showResolved ? "No resolved comments." : "No open comments."}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {visible.map((t) => {
                  const first = t.comments[0];
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => jumpTo(t)}
                        className={
                          "flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" +
                          (t.id === openThreadId
                            ? " bg-neutral-100 dark:bg-neutral-800"
                            : "")
                        }
                      >
                        <span className="truncate text-xs text-neutral-400 dark:text-neutral-500">
                          {t.orphaned
                            ? "anchor removed"
                            : t.anchor_text
                              ? `“${t.anchor_text}”`
                              : "Comment"}
                        </span>
                        <span className="line-clamp-2 text-sm text-neutral-800 dark:text-neutral-100">
                          {first?.body ?? "(no messages)"}
                        </span>
                        {t.comments.length > 1 && (
                          <span className="text-xs text-neutral-400">
                            {t.comments.length} messages
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
