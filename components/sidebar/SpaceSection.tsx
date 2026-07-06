"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { CalendarPlus, Plus } from "lucide-react";
import clsx from "clsx";
import type { PageTreeNode, Space } from "@/lib/db/types";
import { movePageAction } from "@/app/actions/pages";
import type { MenuSpace } from "@/components/page-actions/PageActionsMenu";
import { PageIcon } from "@/lib/icons";
import { canDrop, dragState } from "./dnd";
import NewMeetingNoteButton from "./NewMeetingNoteButton";
import NewPageButton from "./NewPageButton";
import PageTree from "./PageTree";

/** Ids of the ancestors of `targetId` (root-first), or null if not in the tree. */
function findAncestorIds(
  nodes: PageTreeNode[],
  targetId: string,
  trail: string[] = []
): string[] | null {
  for (const node of nodes) {
    if (node.id === targetId) return trail;
    const found = findAncestorIds(node.children, targetId, [...trail, node.id]);
    if (found) return found;
  }
  return null;
}

/**
 * One sidebar section: space header (link, root drop target, new-page button)
 * plus the client page tree. Owns the expand/collapse state for its tree.
 */
export default function SpaceSection({
  space,
  spaces,
  tree,
}: {
  space: Space;
  spaces: MenuSpace[];
  tree: PageTreeNode[];
}) {
  const params = useParams<{ spaceSlug?: string; pageId?: string }>();
  const activePageId = typeof params.pageId === "string" ? params.pageId : null;

  // Collapsed by default, except the ancestors of the active page.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    if (activePageId) {
      for (const id of findAncestorIds(tree, activePageId) ?? []) {
        initial.add(id);
      }
    }
    return initial;
  });
  const [headerDragOver, setHeaderDragOver] = useState(false);
  const [, startTransition] = useTransition();

  // Keep the active page's ancestors expanded as navigation happens.
  useEffect(() => {
    if (!activePageId) return;
    const ancestors = findAncestorIds(tree, activePageId);
    if (!ancestors || ancestors.length === 0) return;
    setExpandedIds((prev) => {
      if (ancestors.every((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ancestors) next.add(id);
      return next;
    });
  }, [activePageId, tree]);

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  return (
    <section>
      <div
        className={clsx(
          "group/space flex items-center gap-1 rounded-md px-2 py-1",
          headerDragOver && "bg-blue-100/70 ring-1 ring-inset ring-blue-500 dark:bg-blue-900/30"
        )}
        onDragOver={(e) => {
          // Drop on the header = move to this space's top level.
          if (canDrop(space.id, null)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setHeaderDragOver(true);
          }
        }}
        onDragLeave={() => setHeaderDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setHeaderDragOver(false);
          const drag = dragState.current;
          dragState.current = null;
          if (!drag || drag.spaceId !== space.id) return;
          startTransition(async () => {
            await movePageAction({ id: drag.pageId, newParentPageId: null });
          });
        }}
      >
        <Link
          href={`/${space.slug}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <PageIcon icon={space.icon} size={14} className="shrink-0" />
          <span className="truncate">{space.name}</span>
        </Link>
        <NewPageButton
          spaceId={space.id}
          spaceSlug={space.slug}
          title={`New page in ${space.name}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-200 hover:text-neutral-700 group-hover/space:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Plus size={14} />
        </NewPageButton>
        <NewMeetingNoteButton
          spaceId={space.id}
          spaceSlug={space.slug}
          title="New meeting note"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-200 hover:text-neutral-700 group-hover/space:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <CalendarPlus size={14} />
        </NewMeetingNoteButton>
      </div>
      <PageTree
        nodes={tree}
        depth={0}
        parentId={null}
        spaceId={space.id}
        spaceSlug={space.slug}
        spaces={spaces}
        activePageId={activePageId}
        expandedIds={expandedIds}
        onToggle={toggle}
        onExpand={expand}
      />
      {tree.length === 0 && (
        <p className="px-2 py-1 text-xs italic text-neutral-400 dark:text-neutral-600">
          No pages yet
        </p>
      )}
    </section>
  );
}
