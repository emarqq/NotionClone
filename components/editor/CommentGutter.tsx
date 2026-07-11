"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { MessageSquarePlus } from "lucide-react";

import { useCommentStore } from "./commentStore";
import { SCROLL_CONTAINER_ID } from "../tabs/store";

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
  // True while the scroll container is actively moving — suppresses the icon
  // so it doesn't sit frozen over a block that has since scrolled away.
  const isScrolling = useRef(false);
  const scrollSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement;
    const cancelHide = () => {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };
    const onMove = (e: MouseEvent) => {
      if (isScrolling.current) return;
      const el = (e.target as HTMLElement | null)?.closest?.(
        "[data-block-id]"
      ) as HTMLElement | null;
      if (!el || !dom.contains(el)) return;
      const blockId = el.getAttribute("data-block-id");
      if (!blockId) return;
      const rect = el.getBoundingClientRect();
      cancelHide();
      // Bulleted/numbered lists reserve a marker column via `padding-left`
      // (see editor.css) — the disc/number renders inside that padding, to the
      // right of the list's rect.left. But the element carrying data-block-id
      // is the paragraph *inside* the list item (`li > p`), not the `<ul>`/
      // `<ol>` — so detect list membership via the enclosing list element and
      // read ITS marker column, then offset the icon left by that width so it
      // clears the marker. Task lists are the exception (their checkbox is laid
      // out in normal flow with a small padding), so they're excluded. Reading
      // the computed padding keeps this correct for future nested-list changes.
      const listEl = el.closest("li")?.parentElement as HTMLElement | null;
      const isMarkerList =
        !!listEl &&
        (listEl.tagName === "UL" || listEl.tagName === "OL") &&
        listEl.getAttribute("data-type") !== "taskList";
      const markerWidth = isMarkerList
        ? parseFloat(getComputedStyle(listEl).paddingLeft) || 24
        : 0;
      setHover((prev) =>
        prev && prev.blockId === blockId
          ? prev
          : {
              blockId,
              left: Math.max(4, rect.left - 28 - markerWidth),
              top: rect.top,
            }
      );
    };
    const onLeave = () => {
      hideTimer.current = setTimeout(() => setHover(null), 200);
    };
    // Hide immediately while the page scrolls (the fixed-position icon is
    // computed from a viewport rect captured on mousemove, so it goes stale
    // the instant the block it's pinned to moves). Reappears either from the
    // next mousemove over a block, or once scrolling settles for ~150ms with
    // the cursor already in place — mirrors the throttle+timeout pattern in
    // components/tabs/TabSync.tsx.
    const onScroll = () => {
      isScrolling.current = true;
      cancelHide();
      setHover(null);
      if (scrollSettleTimer.current) clearTimeout(scrollSettleTimer.current);
      scrollSettleTimer.current = setTimeout(() => {
        isScrolling.current = false;
        scrollSettleTimer.current = null;
      }, 150);
    };
    // Scroll events don't bubble, so either listen on the actual scroll
    // container or, if it isn't mounted yet, fall back to a capture-phase
    // window listener (see PageActionsMenu's reposition-on-scroll handler).
    const scrollEl = document.getElementById(SCROLL_CONTAINER_ID);
    if (scrollEl) {
      scrollEl.addEventListener("scroll", onScroll, { passive: true });
    } else {
      window.addEventListener("scroll", onScroll, {
        capture: true,
        passive: true,
      });
    }
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseleave", onLeave);
    return () => {
      cancelHide();
      if (scrollSettleTimer.current) clearTimeout(scrollSettleTimer.current);
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseleave", onLeave);
      if (scrollEl) {
        scrollEl.removeEventListener("scroll", onScroll);
      } else {
        window.removeEventListener("scroll", onScroll, true);
      }
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
