import type { PageTreeNode } from "@/lib/db/types";

/** Info about the page currently being dragged in the sidebar. */
export interface DragInfo {
  pageId: string;
  spaceId: string;
  /** Ids of every descendant of the dragged page (drops into these are invalid). */
  descendantIds: Set<string>;
}

/**
 * Module-scoped drag state shared by all sidebar client components.
 * HTML5 DnD hides dataTransfer payloads during dragover, so we track the
 * dragged page here to validate drop targets while hovering.
 */
export const dragState: { current: DragInfo | null } = { current: null };

/** Collects the ids of every descendant of `node` (not including `node` itself). */
export function collectDescendantIds(
  node: PageTreeNode,
  into: Set<string> = new Set()
): Set<string> {
  for (const child of node.children) {
    into.add(child.id);
    collectDescendantIds(child, into);
  }
  return into;
}

/**
 * Whether the current drag may be dropped on the given target.
 * `targetPageId` is null for space-root targets (space header / root drop zones).
 * Same-space only; a page can never be dropped on itself or its own descendant.
 */
export function canDrop(
  targetSpaceId: string,
  targetPageId: string | null
): boolean {
  const drag = dragState.current;
  if (!drag) return false;
  if (drag.spaceId !== targetSpaceId) return false;
  if (targetPageId === null) return true;
  if (targetPageId === drag.pageId) return false;
  if (drag.descendantIds.has(targetPageId)) return false;
  return true;
}
