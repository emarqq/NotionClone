"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronRight, MoreHorizontal, Plus, Table2 } from "lucide-react";
import clsx from "clsx";
import type { PageTreeNode } from "@/lib/db/types";
import { createPageAction, movePageAction, renamePageAction } from "@/app/actions/pages";
import PageActionsMenu, { type MenuSpace } from "@/components/page-actions/PageActionsMenu";
import { DefaultPageIcon, PageIcon } from "@/lib/icons";
import { canDrop, collectDescendantIds, dragState } from "./dnd";

const HOVER_BTN_CLASS =
  "flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/70 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-neutral-200";

export interface PageRowProps {
  node: PageTreeNode;
  spaceId: string;
  spaceSlug: string;
  spaces: MenuSpace[];
  isActive: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
  onExpand: (id: string) => void;
}

/** A single sidebar page row: link, expand chevron, hover actions, DnD handlers. */
export default function PageRow({
  node,
  spaceId,
  spaceSlug,
  spaces,
  isActive,
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
  // Database pages render as tree leaves: no expand affordance, no nested
  // children — rows live in the table view instead.
  const showChevron = hasChildren && !node.is_database;

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
      router.push(`/${spaceSlug}/${page.id}?focusTitle=1`);
    });
  };

  return (
    <div
      className={clsx(
        "group/row relative flex items-center gap-1 rounded-md py-1 pr-1 text-sm",
        isActive
          ? "bg-secondary/10 font-medium text-neutral-900 dark:bg-secondary/15 dark:text-neutral-100"
          : "text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/70",
        dragOver &&
          "bg-secondary/10 ring-1 ring-inset ring-secondary dark:bg-secondary/20",
        isPending && "opacity-60"
      )}
      style={{ paddingLeft: 4 }}
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
          !showChevron && "invisible"
        )}
      >
        <ChevronRight
          size={12}
          className={clsx("transition-transform", expanded && "rotate-90")}
        />
      </button>
      <span className="flex w-4 shrink-0 items-center justify-center leading-none">
        <PageIcon
          icon={node.icon}
          size={14}
          fallback={
            node.is_database ? (
              <Table2 size={14} className="text-neutral-400 dark:text-neutral-500" />
            ) : (
              <DefaultPageIcon size={14} />
            )
          }
        />
      </span>
      {renaming ? (
        <input
          autoFocus
          defaultValue={node.title}
          className="min-w-0 flex-1 rounded border border-secondary bg-white px-1 text-sm text-neutral-900 outline-none dark:bg-neutral-900 dark:text-neutral-100"
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
          {!node.is_database && (
            <button
              type="button"
              title="New child page"
              aria-label="New child page"
              className={HOVER_BTN_CLASS}
              onClick={handleNewChild}
            >
              <Plus size={13} />
            </button>
          )}
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
      <PageActionsMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        page={node}
        spaceSlug={spaceSlug}
        spaces={spaces}
        descendantIds={collectDescendantIds(node)}
        hasChildren={hasChildren}
        onRenameInline={() => setRenaming(true)}
        align="right-1"
      />
    </div>
  );
}
