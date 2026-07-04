"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Archive,
  Check,
  Copy,
  CornerUpRight,
  Link as LinkIcon,
  MoreHorizontal,
  Star,
} from "lucide-react";
import clsx from "clsx";
import type { Page } from "@/lib/db/types";
import {
  archivePageAction,
  duplicatePageAction,
  movePageToSpaceAction,
  toggleFavoriteAction,
  touchLastViewedAction,
} from "@/app/actions/pages";

export interface PageMetaBarProps {
  page: Page;
  spaceSlug: string;
  spaces: { id: string; slug: string; name: string; icon: string | null }[];
}

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
}: PageMetaBarProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [favorite, setFavorite] = useState(page.is_favorite);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const otherSpaces = spaces.filter((s) => s.slug !== spaceSlug);

  const edited = new Date(page.updated_at);
  const editedLabel = edited.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

  const handleDuplicate = () => {
    setMenuOpen(false);
    startTransition(async () => {
      const copy = await duplicatePageAction(page.id);
      router.push(`/${spaceSlug}/${copy.id}`);
    });
  };

  const handleMoveToSpace = (target: { id: string; slug: string }) => {
    setMenuOpen(false);
    startTransition(async () => {
      await movePageToSpaceAction(page.id, target.id);
      router.push(`/${target.slug}/${page.id}`);
    });
  };

  const handleArchive = () => {
    setMenuOpen(false);
    if (!window.confirm(`Archive "${page.title}"?`)) return;
    startTransition(async () => {
      await archivePageAction(page.id);
      router.push(`/${spaceSlug}`);
    });
  };

  return (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-neutral-200/80 bg-white/90 px-6 py-1.5 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
      {/* Breadcrumb-lite */}
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link
          href={`/${spaceSlug}`}
          className="shrink-0 truncate text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          {currentSpace?.name ?? spaceSlug}
        </Link>
        <span
          className="shrink-0 text-neutral-300 dark:text-neutral-600"
          aria-hidden
        >
          ›
        </span>
        <span className="min-w-0 truncate text-neutral-700 dark:text-neutral-300">
          {page.title || "Untitled"}
        </span>
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
        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              <MenuItem onClick={handleDuplicate}>
                <Copy size={13} className="shrink-0" />
                Duplicate
              </MenuItem>
              {otherSpaces.map((space) => (
                <MenuItem
                  key={space.id}
                  onClick={() => handleMoveToSpace(space)}
                >
                  <CornerUpRight size={13} className="shrink-0" />
                  <span className="truncate">
                    Move to {space.icon ? `${space.icon} ` : ""}
                    {space.name}
                  </span>
                </MenuItem>
              ))}
              <MenuItem danger onClick={handleArchive}>
                <Archive size={13} className="shrink-0" />
                Archive
              </MenuItem>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  onClick,
  danger = false,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800",
        danger
          ? "text-red-600 dark:text-red-400"
          : "text-neutral-700 dark:text-neutral-200"
      )}
    >
      {children}
    </button>
  );
}
