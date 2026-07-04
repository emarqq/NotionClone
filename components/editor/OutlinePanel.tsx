"use client";

import { useEffect, useState } from "react";
import { List } from "lucide-react";
import clsx from "clsx";
import { SCROLL_CONTAINER_ID } from "@/components/tabs/store";

const OPEN_STORAGE_KEY = "kh-outline-open";
const RESCAN_DEBOUNCE_MS = 300;
const EDITOR_POLL_MS = 200;

interface OutlineEntry {
  id: string;
  text: string;
  level: 1 | 2 | 3;
}

function entriesEqual(a: OutlineEntry[], b: OutlineEntry[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (e, i) => e.id === b[i].id && e.text === b[i].text && e.level === b[i].level
  );
}

/**
 * Auto-generated table of contents for the current page, driven entirely by
 * the rendered editor DOM (headings carry data-block-id). Fixed on the right,
 * hidden below the xl breakpoint, and renders nothing when there are no
 * headings.
 */
export default function OutlinePanel({ pageId }: { pageId: string }) {
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  // Restore collapse state (default open). localStorage is client-only.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPEN_STORAGE_KEY);
      if (stored !== null) setOpen(stored !== "false");
    } catch {
      // Storage unavailable — keep default.
    }
  }, []);

  const toggleOpen = () => {
    setOpen((prev) => {
      try {
        window.localStorage.setItem(OPEN_STORAGE_KEY, String(!prev));
      } catch {
        // Ignore storage failures.
      }
      return !prev;
    });
  };

  // Scan headings + re-scan on editor mutations (debounced).
  useEffect(() => {
    setEntries([]);
    setActiveId(null);

    const container = document.getElementById(SCROLL_CONTAINER_ID);
    if (!container) return;

    let observer: MutationObserver | null = null;
    let pollTimer: number | null = null;
    let debounceTimer: number | null = null;

    const scan = () => {
      const headings = container.querySelectorAll<HTMLElement>(
        ".ProseMirror h1, .ProseMirror h2, .ProseMirror h3"
      );
      const next: OutlineEntry[] = [];
      headings.forEach((el) => {
        const id = el.getAttribute("data-block-id");
        if (!id) return;
        next.push({
          id,
          text: (el.textContent ?? "").trim(),
          level: Number(el.tagName.charAt(1)) as 1 | 2 | 3,
        });
      });
      setEntries((prev) => (entriesEqual(prev, next) ? prev : next));
    };

    const attach = (): boolean => {
      const editorEl = container.querySelector(".ProseMirror");
      if (!editorEl) return false;
      scan();
      observer = new MutationObserver(() => {
        if (debounceTimer !== null) window.clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(scan, RESCAN_DEBOUNCE_MS);
      });
      observer.observe(editorEl, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      return true;
    };

    // Tiptap renders client-side after hydration; poll until it exists.
    if (!attach()) {
      pollTimer = window.setInterval(() => {
        if (attach() && pollTimer !== null) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
      }, EDITOR_POLL_MS);
    }

    return () => {
      observer?.disconnect();
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    };
  }, [pageId]);

  // Active-section highlight: topmost visible heading wins.
  useEffect(() => {
    if (entries.length === 0) return;
    const container = document.getElementById(SCROLL_CONTAINER_ID);
    if (!container) return;

    const targets = entries
      .map((entry) =>
        container.querySelector(`[data-block-id="${CSS.escape(entry.id)}"]`)
      )
      .filter((el): el is Element => el !== null);
    if (targets.length === 0) return;

    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (records) => {
        for (const record of records) {
          const id = record.target.getAttribute("data-block-id");
          if (!id) continue;
          if (record.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // Entries are in document order, so the first visible one is topmost.
        const topmost = entries.find((entry) => visible.has(entry.id));
        if (topmost) setActiveId(topmost.id);
      },
      { root: container, threshold: 0 }
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [entries]);

  const scrollToHeading = (id: string) => {
    const container = document.getElementById(SCROLL_CONTAINER_ID);
    const el = container?.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (entries.length === 0) return null;

  return (
    <div className="fixed right-4 top-24 z-10 hidden flex-col items-end xl:flex">
      <button
        type="button"
        title={open ? "Hide outline" : "Show outline"}
        aria-label={open ? "Hide outline" : "Show outline"}
        aria-expanded={open}
        onClick={toggleOpen}
        className={clsx(
          "flex h-6 w-6 items-center justify-center rounded",
          open
            ? "bg-neutral-200/70 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            : "text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        )}
      >
        <List size={14} />
      </button>
      {open && (
        <nav
          aria-label="Page outline"
          className="mt-1 max-h-[calc(100vh-10rem)] w-52 overflow-y-auto rounded-md border border-neutral-200 bg-white/95 py-1.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-950/95"
        >
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              title={entry.text || "Untitled"}
              onClick={() => scrollToHeading(entry.id)}
              style={{ paddingLeft: 12 + (entry.level - 1) * 12 }}
              className={clsx(
                "block w-full truncate py-1 pr-3 text-left text-xs",
                entry.id === activeId
                  ? "font-medium text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              )}
            >
              {entry.text || "Untitled"}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
