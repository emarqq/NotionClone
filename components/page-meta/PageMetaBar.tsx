"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Download, Link as LinkIcon, MoreHorizontal, Star } from "lucide-react";
import clsx from "clsx";
import type { Page } from "@/lib/db/types";
import { formatShortDate } from "@/lib/format";
import {
  toggleFavoriteAction,
  touchLastViewedAction,
} from "@/app/actions/pages";
import PageActionsMenu from "@/components/page-actions/PageActionsMenu";
import ExportMenu from "@/components/page-actions/ExportMenu";

export interface PageMetaBarProps {
  page: Page;
  spaceSlug: string;
  spaces: { id: string; slug: string; name: string; icon: string | null }[];
  /** Ancestor chain, root-first, excluding `page` itself. */
  ancestors: Page[];
}

interface Crumb {
  key: string;
  title: string;
  /** null = current page (not a link). */
  href: string | null;
}

const MAX_VISIBLE_CRUMBS = 4;

const ICON_BTN_CLASS =
  "flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

/**
 * Slim metadata bar shown above the page title: breadcrumb, edited date,
 * favorite toggle, copy-link, and an overflow menu (duplicate / move / archive).
 * Also records the visit (touchLastViewedAction) so the page shows in Recents.
 */
export default function PageMetaBar({
  page,
  spaceSlug,
  spaces,
  ancestors,
}: PageMetaBarProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [favorite, setFavorite] = useState(page.is_favorite);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [crumbMenuOpen, setCrumbMenuOpen] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt server state after refreshes / navigation.
  useEffect(() => {
    setFavorite(page.is_favorite);
  }, [page.id, page.is_favorite]);

  // Record the visit (feeds Recents). Fire-and-forget.
  useEffect(() => {
    void touchLastViewedAction(page.id).catch(() => {});
  }, [page.id]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const currentSpace = spaces.find((s) => s.slug === spaceSlug);

  // Full ancestor breadcrumb: Space › ancestor pages › current page.
  const crumbs: Crumb[] = [
    { key: "space", title: currentSpace?.name ?? spaceSlug, href: `/${spaceSlug}` },
    ...ancestors.map((a) => ({
      key: a.id,
      title: a.title || "Untitled",
      href: `/${spaceSlug}/${a.id}`,
    })),
    { key: page.id, title: page.title || "Untitled", href: null },
  ];
  const showEllipsis = crumbs.length > MAX_VISIBLE_CRUMBS;
  const headCrumb = crumbs[0];
  const tailCrumbs = showEllipsis ? crumbs.slice(-3) : crumbs.slice(1);
  const hiddenCrumbs = showEllipsis ? crumbs.slice(1, -3) : [];

  const edited = new Date(page.updated_at);
  const editedLabel = formatShortDate(edited);
  const editedFull = edited.toLocaleString("en-US");

  const handleToggleFavorite = () => {
    const next = !favorite;
    setFavorite(next);
    startTransition(async () => {
      try {
        await toggleFavoriteAction(page.id, next);
        router.refresh();
      } catch {
        setFavorite(!next);
      }
    });
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — ignore.
    }
  };

  return (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-neutral-200/80 bg-white/90 px-6 py-1.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
      {/* Breadcrumb: space › ancestor pages › current page */}
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link
          href={headCrumb.href!}
          className="shrink-0 truncate text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          {headCrumb.title}
        </Link>
        {showEllipsis && (
          <>
            <BreadcrumbSep />
            <div className="relative shrink-0">
              <button
                type="button"
                title="Show hidden pages"
                aria-label="Show hidden ancestor pages"
                aria-expanded={crumbMenuOpen}
                onClick={() => setCrumbMenuOpen((open) => !open)}
                className="rounded px-1 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-200"
              >
                …
              </button>
              {crumbMenuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setCrumbMenuOpen(false)}
                  />
                  <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
                    {hiddenCrumbs.map((crumb) => (
                      <Link
                        key={crumb.key}
                        href={crumb.href!}
                        onClick={() => setCrumbMenuOpen(false)}
                        className="block truncate px-3 py-1 text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        {crumb.title}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}
        {tailCrumbs.map((crumb) => (
          <span key={crumb.key} className="flex min-w-0 shrink items-center gap-1.5">
            <BreadcrumbSep />
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="shrink truncate text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              >
                {crumb.title}
              </Link>
            ) : (
              <span className="min-w-0 truncate text-neutral-700 dark:text-neutral-300">
                {crumb.title}
              </span>
            )}
          </span>
        ))}
      </div>

      {/* Actions */}
      <div className="relative flex shrink-0 items-center gap-1">
        <span
          className="mr-1 text-xs text-neutral-400 dark:text-neutral-500"
          title={editedFull}
          suppressHydrationWarning
        >
          Edited {editedLabel}
        </span>
        <button
          type="button"
          title={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={favorite}
          onClick={handleToggleFavorite}
          className={clsx(
            ICON_BTN_CLASS,
            favorite &&
              "text-yellow-500 hover:text-yellow-600 dark:text-yellow-400 dark:hover:text-yellow-300"
          )}
        >
          <Star size={14} fill={favorite ? "currentColor" : "none"} />
        </button>
        <div className="relative">
          <button
            type="button"
            title="Export page"
            aria-label="Export page"
            aria-expanded={exportMenuOpen}
            onClick={() => setExportMenuOpen((open) => !open)}
            className={ICON_BTN_CLASS}
          >
            <Download size={14} />
          </button>
          <ExportMenu
            open={exportMenuOpen}
            onClose={() => setExportMenuOpen(false)}
            pageId={page.id}
            align="right-1"
          />
        </div>
        <button
          type="button"
          title={copied ? "Copied" : "Copy link"}
          aria-label="Copy link"
          onClick={handleCopyLink}
          className={clsx(
            ICON_BTN_CLASS,
            copied && "text-green-600 dark:text-green-400"
          )}
        >
          {copied ? <Check size={14} /> : <LinkIcon size={14} />}
        </button>
        <button
          type="button"
          title="More actions"
          aria-label="More actions"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className={ICON_BTN_CLASS}
        >
          <MoreHorizontal size={14} />
        </button>
        <PageActionsMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          page={page}
          spaceSlug={spaceSlug}
          spaces={spaces}
          align="right-0"
        />
      </div>
    </div>
  );
}

function BreadcrumbSep() {
  return (
    <span className="shrink-0 text-neutral-300 dark:text-neutral-600" aria-hidden>
      ›
    </span>
  );
}
