"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  archivePage,
  createPage,
  deletePage,
  duplicatePage,
  getChildren,
  movePage,
  movePageToSpace,
  renamePage,
  setPageIcon,
  toggleFavorite,
  touchLastViewed,
} from "@/lib/db/pages";
import type { Page } from "@/lib/db/types";
import { ingestPage } from "@/lib/rag/ingest";

/**
 * Creates a page (optionally under a parent) and returns it so the client
 * can navigate to `/${spaceSlug}/${page.id}`.
 */
export async function createPageAction(
  spaceId: string,
  spaceSlug: string,
  parentPageId?: string | null
): Promise<Page> {
  const page = await createPage({
    spaceId,
    parentPageId: parentPageId ?? null,
  });
  revalidatePath("/", "layout");
  revalidatePath(`/${spaceSlug}`);
  return page;
}

export async function renamePageAction(
  id: string,
  title: string
): Promise<Page> {
  const page = await renamePage(id, title.trim() || "Untitled");
  revalidatePath("/", "layout");
  return page;
}

export async function archivePageAction(id: string): Promise<void> {
  await archivePage(id);
  revalidatePath("/", "layout");
}

/** Permanently deletes a page and its subtree. Irreversible. */
export async function deletePageAction(id: string): Promise<void> {
  await deletePage(id);
  revalidatePath("/", "layout");
}

export async function movePageAction(input: {
  id: string;
  newParentPageId: string | null;
  afterPageId?: string | null;
}): Promise<Page> {
  const page = await movePage(input);
  revalidatePath("/", "layout");
  return page;
}

export async function setPageIconAction(
  id: string,
  icon: string | null
): Promise<Page> {
  const page = await setPageIcon(id, icon);
  revalidatePath("/", "layout");
  return page;
}

export async function toggleFavoriteAction(
  id: string,
  isFavorite: boolean
): Promise<Page> {
  const page = await toggleFavorite(id, isFavorite);
  revalidatePath("/", "layout");
  return page;
}

/** Shallow-duplicates a page (blocks copied, child pages not). */
export async function duplicatePageAction(id: string): Promise<Page> {
  const page = await duplicatePage(id);
  revalidatePath("/", "layout");
  return page;
}

/** Moves a page (and its whole subtree) to the top level of another space. */
export async function movePageToSpaceAction(
  id: string,
  targetSpaceId: string
): Promise<Page> {
  const { page, descendantIds } = await movePageToSpace(id, targetSpaceId);
  revalidatePath("/", "layout");
  // space_id and breadcrumbs changed for the moved page and its whole
  // subtree, so re-ingest all of them (hash diff makes this cheap).
  after(() => {
    for (const pageId of [id, ...descendantIds]) {
      ingestPage(pageId).catch((err) =>
        console.error(`movePageToSpaceAction re-ingest failed for page ${pageId}:`, err)
      );
    }
  });
  return page;
}

/**
 * Fetches a page's direct, non-archived children — used to lazily expand one
 * level at a time in the right-rail contents navigator (avoids shipping a
 * whole subtree up front).
 */
export async function getChildrenAction(pageId: string): Promise<Page[]> {
  return getChildren(pageId);
}

/** Records that a page was just viewed (drives Recents). Never throws. */
export async function touchLastViewedAction(id: string): Promise<void> {
  await touchLastViewed(id);
  revalidatePath("/", "layout");
}
