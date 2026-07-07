"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  Copy,
  CornerUpRight,
  Link as LinkIcon,
  Pencil,
  Smile,
  Star,
  Trash2,
} from "lucide-react";
import clsx from "clsx";
import {
  archivePageAction,
  deletePageAction,
  duplicatePageAction,
  movePageToSpaceAction,
  renamePageAction,
  setPageIconAction,
  toggleFavoriteAction,
} from "@/app/actions/pages";
import IconPicker from "@/components/page-actions/IconPicker";
import { PageIcon } from "@/lib/icons";

/** The subset of space fields the menu needs (for "Move to space"). */
export interface MenuSpace {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
}

export interface PageActionsMenuProps {
  open: boolean;
  onClose: () => void;
  page: {
    id: string;
    title: string;
    icon: string | null;
    is_favorite: boolean;
  };
  spaceSlug: string;
  spaces: MenuSpace[];
  /**
   * Descendant page ids (tree context). Used to decide whether removing this
   * page should redirect the current view — i.e. the open page is a descendant.
   */
  descendantIds?: Set<string>;
  /** Whether the page has sub-pages (adjusts the delete confirmation wording). */
  hasChildren?: boolean;
  /** If provided, "Rename" triggers inline rename instead of a window prompt. */
  onRenameInline?: () => void;
  /** Panel horizontal alignment within the relative parent. */
  align?: "right-0" | "right-1";
}

/**
 * The single, shared page-actions dropdown used everywhere a three-dot menu
 * appears (in-page meta bar, sidebar tree rows, Recents/Favorites rows) so the
 * options are identical no matter where you open it.
 *
 * Renders the backdrop + positioned panel; the caller renders the trigger
 * button and must be a `relative` positioned ancestor.
 */
export default function PageActionsMenu({
  open,
  onClose,
  page,
  spaceSlug,
  spaces,
  descendantIds,
  hasChildren = false,
  onRenameInline,
  align = "right-0",
}: PageActionsMenuProps) {
  const router = useRouter();
  const params = useParams<{ pageId?: string }>();
  const [, startTransition] = useTransition();
  // `window.prompt` never shows anything in the Electron desktop shell (it's
  // one of the few dialog APIs Chromium doesn't implement there), so rename
  // uses this in-menu text field instead wherever there's no dedicated
  // inline-rename UI.
  const [editMode, setEditMode] = useState<"rename" | "icon" | null>(null);
  const [editValue, setEditValue] = useState("");

  // The panel is portaled to <body> and positioned with `fixed` coordinates
  // computed from the trigger's on-screen rect, so it can flip above the
  // trigger (and clamp horizontally) instead of being clipped by the
  // sidebar's scroll container or the bottom of the viewport.
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    top: 0,
    left: 0,
    visibility: "hidden",
  });

  useEffect(() => {
    if (!open) setEditMode(null);
  }, [open]);

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
        : Math.min(
            anchorRect.bottom + GAP,
            window.innerHeight - panelRect.height - MARGIN
          );

      let left = anchorRect.right - rightInset - panelRect.width;
      left = Math.min(
        Math.max(left, MARGIN),
        window.innerWidth - panelRect.width - MARGIN
      );

      setStyle({ position: "fixed", top, left, visibility: "visible" });
    };

    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, align, editMode, spaces, spaceSlug]);

  if (!open) return null;

  const activePageId = typeof params.pageId === "string" ? params.pageId : null;
  const otherSpaces = spaces.filter((s) => s.slug !== spaceSlug);

  // If the page being removed is the one currently open (or an ancestor of it),
  // navigate back to the space root so we don't sit on a dead page.
  const removingAffectsView =
    activePageId !== null &&
    (activePageId === page.id || (descendantIds?.has(activePageId) ?? false));
  const redirectAfterRemove = () => {
    if (removingAffectsView) router.push(`/${spaceSlug}`);
  };

  const handleRename = () => {
    if (onRenameInline) {
      onClose();
      onRenameInline();
      return;
    }
    setEditValue(page.title);
    setEditMode("rename");
  };

  const handleChangeIcon = () => {
    setEditMode("icon");
  };

  const submitEdit = (value: string) => {
    if (editMode === "rename") {
      const title = value.trim();
      if (title && title !== page.title) {
        startTransition(async () => {
          await renamePageAction(page.id, title);
        });
      }
    }
    setEditMode(null);
    onClose();
  };

  const handleSelectIcon = (icon: string | null) => {
    startTransition(async () => {
      await setPageIconAction(page.id, icon);
    });
    setEditMode(null);
    onClose();
  };

  const handleCopyLink = async () => {
    onClose();
    const url = `${window.location.origin}/${spaceSlug}/${page.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard unavailable (permissions / insecure context) — ignore.
    }
  };

  const handleToggleFavorite = () => {
    onClose();
    startTransition(async () => {
      await toggleFavoriteAction(page.id, !page.is_favorite);
      router.refresh();
    });
  };

  const handleDuplicate = () => {
    onClose();
    startTransition(async () => {
      const copy = await duplicatePageAction(page.id);
      router.push(`/${spaceSlug}/${copy.id}`);
    });
  };

  const handleMoveToSpace = (target: MenuSpace) => {
    onClose();
    startTransition(async () => {
      await movePageToSpaceAction(page.id, target.id);
      router.push(`/${target.slug}/${page.id}`);
    });
  };

  const handleArchive = () => {
    onClose();
    if (!window.confirm(`Archive "${page.title}"?`)) return;
    startTransition(async () => {
      await archivePageAction(page.id);
      redirectAfterRemove();
    });
  };

  const handleDelete = () => {
    onClose();
    const extra = hasChildren ? " and all of its sub-pages" : "";
    if (
      !window.confirm(
        `Delete "${page.title}"${extra} permanently? This can't be undone.`,
      )
    )
      return;
    startTransition(async () => {
      await deletePageAction(page.id);
      redirectAfterRemove();
    });
  };

  // The icon picker is wider/taller than a typical trigger row (sidebar rows
  // especially), so instead of anchoring it to the trigger like the rest of
  // this menu, float it as a centered overlay above everything — sidebar and
  // main page alike — rather than fitting it into whatever cramped space is
  // beside the trigger.
  if (editMode === "icon") {
    return (
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/20"
        onClick={() => setEditMode(null)}
      >
        <div
          className="w-80 rounded-md border border-neutral-200 bg-white p-2 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
          onClick={(e) => e.stopPropagation()}
        >
          <IconPicker
            value={page.icon}
            onSelect={handleSelectIcon}
            onClear={() => handleSelectIcon(null)}
            onClose={() => setEditMode(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Zero-size, invisible stand-in for the trigger's row bounds — the
          portaled panel below measures this to compute its fixed position. */}
      <div ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden />
      {createPortal(
        <>
          <div className="fixed inset-0 z-20" onClick={onClose} />
          <div
            ref={panelRef}
            style={style}
            className={clsx(
              "z-30 rounded-md border border-neutral-200 bg-white text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900",
              editMode === "rename" ? "w-56 p-2" : "w-56 py-1",
            )}
          >
            {editMode === "rename" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitEdit(editValue);
                }}
              >
                <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  Page title
                </label>
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditMode(null);
                  }}
                  className="mb-2 w-full rounded border border-neutral-200 bg-white px-2 py-1 text-sm outline-none focus:border-neutral-400 dark:border-neutral-700 dark:bg-neutral-800 dark:focus:border-neutral-500"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditMode(null)}
                    className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90"
                  >
                    Save
                  </button>
                </div>
              </form>
            ) : (
              <>
                <MenuItem onClick={handleRename}>
                  <Pencil size={13} className="shrink-0" />
                  Rename
                </MenuItem>
                <MenuItem onClick={handleChangeIcon}>
                  <Smile size={13} className="shrink-0" />
                  Change icon
                </MenuItem>
                <MenuItem onClick={handleCopyLink}>
                  <LinkIcon size={13} className="shrink-0" />
                  Copy link
                </MenuItem>
                <MenuItem onClick={handleToggleFavorite}>
                  <Star
                    size={13}
                    className="shrink-0"
                    fill={page.is_favorite ? "currentColor" : "none"}
                  />
                  {page.is_favorite ? "Remove from favorites" : "Add to favorites"}
                </MenuItem>
                <MenuItem onClick={handleDuplicate}>
                  <Copy size={13} className="shrink-0" />
                  Duplicate
                </MenuItem>
                {otherSpaces.map((space) => (
                  <MenuItem key={space.id} onClick={() => handleMoveToSpace(space)}>
                    <CornerUpRight size={13} className="shrink-0" />
                    <span className="flex min-w-0 items-center gap-1 truncate">
                      Move to
                      {space.icon && <PageIcon icon={space.icon} size={13} />}
                      <span className="truncate">{space.name}</span>
                    </span>
                  </MenuItem>
                ))}
                <div className="my-1 border-t border-neutral-200 dark:border-neutral-800" />
                <MenuItem onClick={handleArchive}>
                  <Archive size={13} className="shrink-0" />
                  Archive
                </MenuItem>
                <MenuItem danger onClick={handleDelete}>
                  <Trash2 size={13} className="shrink-0" />
                  Delete
                </MenuItem>
              </>
            )}
          </div>
        </>,
        document.body
      )}
    </>
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
          : "text-neutral-700 dark:text-neutral-200",
      )}
    >
      {children}
    </button>
  );
}
