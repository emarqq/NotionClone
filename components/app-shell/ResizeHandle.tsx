"use client";

import { useCallback, useRef } from "react";
import clsx from "clsx";

export interface ResizeHandleProps {
  /** Which edge of the panel this handle sits on and drags from. */
  side: "left" | "right";
  /** Current panel width in px (read at drag-start, not on every move). */
  getWidth: () => number;
  onResize: (width: number) => void;
  onDragChange?: (dragging: boolean) => void;
}

/**
 * A thin draggable strip pinned to one edge of a panel. Dragging updates the
 * panel width live via `onResize`; width math is delta-based off the value
 * captured at mousedown, so it stays correct regardless of clamping.
 */
export default function ResizeHandle({
  side,
  getWidth,
  onResize,
  onDragChange,
}: ResizeHandleProps) {
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragState.current = { startX: e.clientX, startWidth: getWidth() };
      onDragChange?.(true);

      const prevCursor = document.body.style.cursor;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handleMove = (moveEvent: PointerEvent) => {
        const drag = dragState.current;
        if (!drag) return;
        const delta = moveEvent.clientX - drag.startX;
        const nextWidth =
          side === "left" ? drag.startWidth + delta : drag.startWidth - delta;
        onResize(nextWidth);
      };

      const handleUp = () => {
        dragState.current = null;
        onDragChange?.(false);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevUserSelect;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [getWidth, onResize, onDragChange, side]
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      className={clsx(
        "group/handle relative w-1 shrink-0 cursor-col-resize select-none",
        side === "left" ? "-ml-0.5" : "-mr-0.5"
      )}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/handle:bg-neutral-300 dark:group-hover/handle:bg-neutral-600" />
    </div>
  );
}
