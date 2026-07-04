"use client";

import { useState, useTransition } from "react";
import clsx from "clsx";
import type { PageTreeNode } from "@/lib/db/types";
import { movePageAction } from "@/app/actions/pages";
import { canDrop, dragState } from "./dnd";
import PageRow from "./PageRow";

export interface PageTreeProps {
  nodes: PageTreeNode[];
  depth: number;
  /** Parent page of this sibling list (null = space root). */
  parentId: string | null;
  spaceId: string;
  spaceSlug: string;
  activePageId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onExpand: (id: string) => void;
}

/**
 * Recursive sibling list. Renders a thin drop zone before the first row
 * (drop = place first under `parentId`) and one after each row's subtree
 * (drop = place as sibling directly after that row).
 */
export default function PageTree(props: PageTreeProps) {
  const {
    nodes,
    depth,
    parentId,
    spaceId,
    spaceSlug,
    activePageId,
    expandedIds,
    onToggle,
    onExpand,
  } = props;

  return (
    <div>
      <DropZone
        spaceId={spaceId}
        parentId={parentId}
        afterId={null}
        depth={depth}
        onExpand={onExpand}
      />
      {nodes.map((node) => (
        <div key={node.id}>
          <PageRow
            node={node}
            depth={depth}
            spaceId={spaceId}
            spaceSlug={spaceSlug}
            isActive={node.id === activePageId}
            activePageId={activePageId}
            expanded={expandedIds.has(node.id)}
            onToggle={onToggle}
            onExpand={onExpand}
          />
          {expandedIds.has(node.id) && node.children.length > 0 && (
            <div
              className="border-l border-neutral-200/70 dark:border-neutral-800/70"
              style={{ marginLeft: depth * 12 + 12 }}
            >
              <PageTree
                nodes={node.children}
                depth={depth + 1}
                parentId={node.id}
                spaceId={spaceId}
                spaceSlug={spaceSlug}
                activePageId={activePageId}
                expandedIds={expandedIds}
                onToggle={onToggle}
                onExpand={onExpand}
              />
            </div>
          )}
          <DropZone
            spaceId={spaceId}
            parentId={parentId}
            afterId={node.id}
            depth={depth}
            onExpand={onExpand}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Thin between-rows drop target. Zero net height (negative margins) so the
 * tree looks unchanged; shows a blue bar while a valid drag hovers over it.
 */
function DropZone({
  spaceId,
  parentId,
  afterId,
  depth,
  onExpand,
}: {
  spaceId: string;
  parentId: string | null;
  afterId: string | null;
  depth: number;
  onExpand: (id: string) => void;
}) {
  const [over, setOver] = useState(false);
  const [, startTransition] = useTransition();

  const isValidTarget = () =>
    canDrop(spaceId, parentId) && (afterId === null || canDrop(spaceId, afterId));

  return (
    <div
      style={{ marginLeft: depth * 12 + 8 }}
      className={clsx(
        "relative z-10 -my-0.5 h-1 rounded-full",
        over && "bg-blue-500/80"
      )}
      onDragOver={(e) => {
        if (isValidTarget()) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!isValidTarget()) return;
        const drag = dragState.current;
        dragState.current = null;
        if (!drag) return;
        startTransition(async () => {
          await movePageAction({
            id: drag.pageId,
            newParentPageId: parentId,
            afterPageId: afterId,
          });
          if (parentId) onExpand(parentId);
        });
      }}
    />
  );
}
