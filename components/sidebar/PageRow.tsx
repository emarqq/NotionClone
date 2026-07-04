"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import clsx from "clsx";
import type { PageTreeNode } from "@/lib/db/types";
import {
  archivePageAction,
  createPageAction,
  movePageAction,
  renamePageAction,
  setPageIconAction,
} from "@/app/actions/pages";
import { canDrop, collectDescendantIds, dragState } from "./dnd";

const HOVER_BTN_CLASS =
  "flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/70 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200";

export interface PageRowProps {
  node: PageTreeNode;
  depth: number;
  spaceId: string;
  spaceSlug: string;
  isActive: boolean;
  activePageId: string | null;
  expanded: boolean;
  onToggle: (id: string) => void;
  onExpand: (id: string) => void;
}

/** A single sidebar page row: link, expand chevron, hover actions, DnD handlers. */
export default function PageRow({
  node,
  depth,
  spaceId,
  spaceSlug,
  isActive,
  activePageId,
  expanded,
  onToggle,
  onExpand,
}: PageRowProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [isPending, startTransition] = useTransition();

  const hasChildren = node.children.length > 0;

  const commitRename = (value: string) => {
    setRenaming(false);
    const title = value.trim();
    if (!title || title === node.title) return;
    startTransition(async () => {
      await renamePageAction(node.id, title);
    });
  };

  const handleNewChild = () => {
    setMenuOpen(false);
    startTransition(async () => {
      const page = await createPageAction(spaceId, spaceSlug, node.id);
      onExpand(node.id);
      router.push(`/${spaceSlug}/${page.id}`);
    });
  };

  const handleArchive = () => {
    setMenuOpen(false);
    if (!window.confirm(`Archive "${node.title}"?`)) return;
    const containsActive =
      activePageId !== null &&
      (activePageId === node.id ||
        collectDescendantIds(node).has(activePageId));
    startTransition(async () => {
      await archivePageAction(node.id);
      if (containsActive) router.push(`/${spaceSlug}`);
    });
  };

  const handleChangeIcon = () => {
    setMenuOpen(false);
    const value = window.prompt(
      "Page icon (an emoji; leave empty to clear):",
      node.icon ?? ""
    );
    if (value === null) return;
    const icon = value.trim() || null;
    startTransition(async () => {
      await setPageIconAction(node.id, icon);
    });
  };

  return (
    <div
      className={clsx(
        "group/row relative flex items-center gap-1 rounded-md py-1 pr-1 text-sm",
        isActive
          ? "bg-neutral-200/80 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
          : "text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/70",
        dragOver &&
          "bg-blue-100/70 ring-1 ring-inset ring-blue-500 dark:bg-blue-900/30",
        isPending && "opacity-60"
      )}
      style={{ paddingLeft: depth * 12 + 4 }}
      draggable={!renaming}
      onDragStart={(e) => {
        dragState.current = {
          pageId: node.id,
          spaceId,
          descendantIds: collectDescendantIds(node),
        };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", node.id);
      }}
      onDragEnd={() => {
        dragState.current = null;
      }}
      onDragOver={(e) => {
        if (canDrop(spaceId, node.id)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const drag = dragState.current;
        dragState.current = null;
        if (
          !drag ||
          drag.spaceId !== spaceId ||
          drag.pageId === node.id ||
          drag.descendantIds.has(node.id)
        ) {
          return;
        }
        startTransition(async () => {
          // Dropping on a row nests the dragged page as its first child.
          await movePageAction({ id: drag.pageId, newParentPageId: node.id });
          onExpand(node.id);
        });
      }}
    >
      <button
        type="button"
        onClick={() => onToggle(node.id)}
        aria-label={expanded ? "Collapse" : "Expand"}
        className={clsx(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/70 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200",
          !hasChildren && "invisible"
        )}
      >
        <ChevronRight
          size={12}
          className={clsx("transition-transform", expanded && "rotate-90")}
        />
      </button>
      <span className="w-4 shrink-0 text-center text-sm leading-none">
        {node.icon ?? "📄"}
      </span>
      {renaming ? (
        <input
          autoFocus
          defaultValue={node.title}
          className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-1 text-sm text-neutral-900 outline-none dark:bg-neutral-900 dark:text-neutral-100"
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur(); // commit via onBlur (single commit path)
            } else if (e.key === "Escape") {
              e.currentTarget.value = node.title; // revert; onBlur becomes a no-op
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => commitRename(e.currentTarget.value)}
        />
      ) : (
        <Link
          href={`/${spaceSlug}/${node.id}`}
          draggable={false}
          className="min-w-0 flex-1 truncate"
        >
          {node.title}
        </Link>
      )}
      {!renaming && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
          <button
            type="button"
            title="New child page"
            aria-label="New child page"
            className={HOVER_BTN_CLASS}
            onClick={handleNewChild}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            title="More actions"
            aria-label="More actions"
            className={HOVER_BTN_CLASS}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={13} />
          </button>
        </div>
      )}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-1 top-full z-30 mt-0.5 w-40 rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
            <MenuItem
              onClick={() => {
                setMenuOpen(false);
                setRenaming(true);
              }}
            >
              Rename
            </MenuItem>
            <MenuItem onClick={handleChangeIcon}>Change icon</MenuItem>
            <MenuItem danger onClick={handleArchive}>
              Archive
            </MenuItem>
          </div>
        </>
      )}
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
        "block w-full px-3 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800",
        danger
          ? "text-red-600 dark:text-red-400"
          : "text-neutral-700 dark:text-neutral-200"
      )}
    >
      {children}
    </button>
  );
}
