"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ChevronRight, PanelRight, Plus } from "lucide-react";
import clsx from "clsx";
import type { Page } from "@/lib/db/types";
import { createPageAction, getChildrenAction } from "@/app/actions/pages";
import { useAiPanelStore } from "@/components/ai-panel/store";
import OutlinePanel from "@/components/editor/OutlinePanel";

const OPEN_STORAGE_KEY = "kh-contents-open";
const PANEL_WIDTH = 240;
const EDGE_GAP = 16;

export interface ContentsPanelProps {
  page: Page;
  spaceId: string;
  spaceSlug: string;
  /** Immediate parent page, or null when `page` is a space-root page. */
  parent: { id: string; title: string; icon: string | null } | null;
  /** Direct, non-archived children of `page` (already fetched server-side). */
  initialChildren: Page[];
}

/**
 * Right-rail "Contents" navigator for the current page: an upward escape
 * hatch to the parent page, the page's sub-pages (lazily expandable one level
 * at a time), a "+ New sub-page" row, and the existing heading outline.
 * Fixed to the viewport edge (like the outline it replaces) but offset by the
 * AI panel's width so the two never overlap; hidden below the xl breakpoint.
 */
export default function ContentsPanel({
  page,
  spaceId,
  spaceSlug,
  parent,
  initialChildren,
}: ContentsPanelProps) {
  const router = useRouter();
  const aiPanelOpen = useAiPanelStore((s) => s.open);
  const aiPanelWidth = useAiPanelStore((s) => s.width);
  const [open, setOpen] = useState(true);
  const [, startTransition] = useTransition();

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
        // Ignore persistence failures.
      }
      return !prev;
    });
  };

  const handleNewSubPage = () => {
    startTransition(async () => {
      const created = await createPageAction(spaceId, spaceSlug, page.id);
      router.push(`/${spaceSlug}/${created.id}`);
    });
  };

  const rightOffset = EDGE_GAP + (aiPanelOpen ? aiPanelWidth : 0);

  return (
    <div
      className="fixed top-24 z-10 hidden flex-col items-end xl:flex"
      style={{ right: rightOffset }}
    >
      <button
        type="button"
        title={open ? "Hide contents" : "Show contents"}
        aria-label={open ? "Hide contents" : "Show contents"}
        aria-expanded={open}
        onClick={toggleOpen}
        className={clsx(
          "flex h-6 w-6 items-center justify-center rounded",
          open
            ? "bg-neutral-200/70 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            : "text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        )}
      >
        <PanelRight size={14} />
      </button>
      {open && (
        <div
          className="mt-1 flex max-h-[calc(100vh-8rem)] flex-col gap-3 overflow-y-auto rounded-md border border-neutral-200 bg-white/95 py-2 shadow-sm dark:border-neutral-800 dark:bg-neutral-950/95"
          style={{ width: PANEL_WIDTH }}
        >
          {parent && (
            <Link
              href={`/${spaceSlug}/${parent.id}`}
              title={parent.title}
              className="flex min-w-0 items-center gap-1 px-3 text-xs text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
            >
              <span aria-hidden>‹</span>
              <span className="min-w-0 truncate">
                {parent.icon ? `${parent.icon} ` : ""}
                {parent.title || "Untitled"}
              </span>
            </Link>
          )}

          <section>
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-600">
              Sub-pages
            </p>
            <SubPageTree spaceSlug={spaceSlug} pages={initialChildren} depth={0} />
            <button
              type="button"
              onClick={handleNewSubPage}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[13px] text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
            >
              <Plus size={12} /> New sub-page
            </button>
          </section>

          <section className="border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-600">
              On this page
            </p>
            <OutlinePanel pageId={page.id} />
          </section>
        </div>
      )}
    </div>
  );
}

function SubPageTree({
  spaceSlug,
  pages,
  depth,
}: {
  spaceSlug: string;
  pages: Page[];
  depth: number;
}) {
  if (pages.length === 0 && depth === 0) {
    return (
      <p className="px-3 py-1 text-[13px] italic text-neutral-400 dark:text-neutral-600">
        No sub-pages
      </p>
    );
  }
  return (
    <ul>
      {pages.map((page) => (
        <SubPageRow key={page.id} spaceSlug={spaceSlug} page={page} depth={depth} />
      ))}
    </ul>
  );
}

function SubPageRow({
  spaceSlug,
  page,
  depth,
}: {
  spaceSlug: string;
  page: Page;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Page[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    if (!expanded && children === null) {
      setLoading(true);
      try {
        const kids = await getChildrenAction(page.id);
        setChildren(kids);
      } finally {
        setLoading(false);
      }
    }
    setExpanded((prev) => !prev);
  };

  return (
    <li>
      <div
        className="group/subrow flex items-center gap-1 rounded py-1 pr-2 text-[13px] text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        <button
          type="button"
          onClick={handleToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <ChevronRight
            size={11}
            className={clsx("transition-transform", expanded && "rotate-90")}
          />
        </button>
        <span className="w-4 shrink-0 text-center leading-none">
          {page.icon ?? "📄"}
        </span>
        <Link
          href={`/${spaceSlug}/${page.id}`}
          className="min-w-0 flex-1 truncate"
        >
          {page.title || "Untitled"}
        </Link>
      </div>
      {expanded && (
        <>
          {loading && (
            <p
              className="py-1 text-[12px] text-neutral-400 dark:text-neutral-600"
              style={{ paddingLeft: 12 + (depth + 1) * 12 }}
            >
              Loading…
            </p>
          )}
          {!loading && children && children.length > 0 && (
            <SubPageTree spaceSlug={spaceSlug} pages={children} depth={depth + 1} />
          )}
          {!loading && children && children.length === 0 && (
            <p
              className="py-1 text-[12px] italic text-neutral-400 dark:text-neutral-600"
              style={{ paddingLeft: 12 + (depth + 1) * 12 }}
            >
              No sub-pages
            </p>
          )}
        </>
      )}
    </li>
  );
}
