"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

/**
 * Computes `fixed` coordinates for a portaled dropdown/menu panel anchored to
 * a trigger element's on-screen rect — flips above the trigger when there's
 * more room there, and clamps to the viewport on every axis. Mirrors
 * PageActionsMenu's reposition logic (see components/page-actions/PageActionsMenu.tsx)
 * so every database dropdown behaves identically.
 *
 * Watches the panel's own size with a ResizeObserver (rather than taking an
 * explicit deps array) so it stays correct across dynamic content changes
 * (e.g. a rename input replacing a menu list) with no risk of stale deps.
 */
export function usePortalPosition(
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  open: boolean
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const reposition = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const GAP = 4;
      const MARGIN = 8;

      const spaceBelow = window.innerHeight - anchorRect.bottom;
      const spaceAbove = anchorRect.top;
      const openUpward =
        spaceBelow < panelRect.height + GAP + MARGIN && spaceAbove > spaceBelow;

      const top = openUpward
        ? Math.max(MARGIN, anchorRect.top - GAP - panelRect.height)
        : Math.min(
            anchorRect.bottom + GAP,
            window.innerHeight - panelRect.height - MARGIN
          );

      let left = anchorRect.left;
      left = Math.min(
        Math.max(left, MARGIN),
        window.innerWidth - panelRect.width - MARGIN
      );

      setStyle({ position: "fixed", top, left, visibility: "visible" });
    };

    reposition();
    const resizeObserver = new ResizeObserver(reposition);
    resizeObserver.observe(panel);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, anchorRef, panelRef]);

  return style;
}
