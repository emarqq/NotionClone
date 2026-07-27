"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, FileType, Notebook } from "lucide-react";
import clsx from "clsx";
import { pageExportUrl } from "@/lib/export/clientUrls";

export interface ExportMenuProps {
  open: boolean;
  onClose: () => void;
  pageId: string;
  /** Panel horizontal alignment within the relative parent. */
  align?: "right-0" | "right-1";
}

/**
 * Dropdown for the page toolbar's "Export" button — Markdown/Word download
 * links plus a "Print / Save as PDF" action. Positioning mirrors
 * `PageActionsMenu` (portaled + `fixed`, repositioned from the trigger's
 * bounding rect) so it isn't clipped by the sticky meta bar.
 */
export default function ExportMenu({ open, onClose, pageId, align = "right-0" }: ExportMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    if (!open) return;

    const reposition = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const GAP = 4;
      const MARGIN = 8;
      const rightInset = align === "right-1" ? 4 : 0;

      const spaceBelow = window.innerHeight - anchorRect.bottom;
      const spaceAbove = anchorRect.top;
      const openUpward =
        spaceBelow < panelRect.height + GAP + MARGIN && spaceAbove > spaceBelow;

      const top = openUpward
        ? Math.max(MARGIN, anchorRect.top - GAP - panelRect.height)
        : Math.min(anchorRect.bottom + GAP, window.innerHeight - panelRect.height - MARGIN);

      let left = anchorRect.right - rightInset - panelRect.width;
      left = Math.min(Math.max(left, MARGIN), window.innerWidth - panelRect.width - MARGIN);

      setStyle({ position: "fixed", top, left, visibility: "visible" });
    };

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, align]);

  if (!open) return null;

  const handlePdf = () => {
    onClose();
    window.open(pageExportUrl(pageId, "pdf"), "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <div ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden />
      {createPortal(
        <>
          <div className="fixed inset-0 z-20" onClick={onClose} />
          <div
            ref={panelRef}
            style={style}
            className={clsx(
              "z-30 w-52 rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            )}
          >
            <a
              href={pageExportUrl(pageId, "markdown")}
              download
              onClick={onClose}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <FileText size={13} className="shrink-0" />
              Export as Markdown
            </a>
            <a
              href={pageExportUrl(pageId, "docx")}
              download
              onClick={onClose}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <Notebook size={13} className="shrink-0" />
              Export as Word (.docx)
            </a>
            <button
              type="button"
              onClick={handlePdf}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <FileType size={13} className="shrink-0" />
              Export as PDF
            </button>
          </div>
        </>,
        document.body
      )}
    </>
  );
}
