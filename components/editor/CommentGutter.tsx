"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { MessageSquarePlus } from "lucide-react";

import { useCommentStore } from "./commentStore";

interface Hover {
  blockId: string;
  left: number;
  top: number;
}

/**
 * Left-margin "comment on this block" affordance. There's no existing block
 * hover/drag-handle infra (MoveBlock is keyboard-only), so this tracks the
 * hovered top-level block via its data-block-id and floats a comment icon in
 * the gutter. Clicking it selects the block's text range and opens the composer
 * — the whole-block counterpart to the bubble-menu / ⌘⇧M text-range affordance.
 */
export default function CommentGutter({ editor }: { editor: Editor }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const cancelHide = () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
    const onMove = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.(
        "[data-block-id]"
      ) as HTMLElement | null;
      if (!el || !dom.contains(el)) return;
      const blockId = el.getAttribute("data-block-id");
      if (!blockId) return;
      const rect = el.getBoundingClientRect();
      cancelHide();
      setHover((prev) =>
        prev && prev.blockId === blockId
          ? prev
          : { blockId, left: Math.max(4, rect.left - 28), top: rect.top }
      );
    };
    const onLeave = () => {
      hideTimer.current = setTimeout(() => setHover(null), 200);
    };
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseleave", onLeave);
    return () => {
      cancelHide();
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseleave", onLeave);
    };
  }, [editor]);

  if (!hover) return null;

  const commentBlock = () => {
    let range: { from: number; to: number } | null = null;
    editor.state.doc.forEach((node, pos) => {
      if (range) return;
      if (node.attrs?.blockId === hover.blockId) {
        range = { from: pos + 1, to: pos + node.nodeSize - 1 };
      }
    });
    setHover(null);
    // openComposer no-ops on an empty range (nothing to anchor to).
    if (range) useCommentStore.getState().openComposer(editor, range);
  };

  return (
    <button
      type="button"
      title="Comment on this block"
      onMouseEnter={() => {
        if (hideTimer.current) {
          clearTimeout(hideTimer.current);
          hideTimer.current = null;
        }
      }}
      onMouseLeave={() => setHover(null)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={commentBlock}
      className="fixed z-40 flex size-6 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      style={{ left: hover.left, top: hover.top }}
    >
      <MessageSquarePlus size={15} />
    </button>
  );
}
