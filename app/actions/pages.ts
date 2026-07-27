"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  archivePage,
  createPage,
  createSpace,
  deletePage,
  duplicatePage,
  getChildren,
  getPage,
  movePage,
  movePageToSpace,
  renamePage,
  setPageCover,
  setPageCoverPosition,
  setPageIcon,
  toggleFavorite,
  touchLastViewed,
} from "@/lib/db/pages";
import { deleteFileByStoragePath } from "@/lib/db/files";
import type { Page, Space } from "@/lib/db/types";
import { ingestPage } from "@/lib/rag/ingest";
import {
  scheduleDelete,
  scheduleExport,
  scheduleExportRename,
} from "@/lib/export/schedule";

/** Creates a new space (top-level section like School/Work) and returns it. */
export async function createSpaceAction(
  name: string,
  icon?: string | null
): Promise<Space> {
  const space = await createSpace({ name, icon });
  revalidatePath("/", "layout");
  return space;
}

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
  scheduleExport(page.id);
  return page;
}

export async function renamePageAction(
  id: string,
  title: string
): Promise<Page> {
  const page = await renamePage(id, title.trim() || "Untitled");
  revalidatePath("/", "layout");
  scheduleExportRename(id);
  return page;
}

export async function archivePageAction(id: string): Promise<void> {
  await archivePage(id);
  revalidatePath("/", "layout");
  // Unified reconcile relocates the page (and its subtree) under Archive/.
  scheduleExport(id);
}

/** Permanently deletes a page and its subtree. Irreversible. */
export async function deletePageAction(id: string): Promise<void> {
  await deletePage(id);
  revalidatePath("/", "layout");
  scheduleDelete(id);
}

export async function movePageAction(input: {
  id: string;
  newParentPageId: string | null;
  afterPageId?: string | null;
}): Promise<Page> {
  const page = await movePage(input);
  revalidatePath("/", "layout");
  // Reparent changes the vault folder path + the page's `parent` wikilink.
  scheduleExport(page.id);
  return page;
}

export async function setPageIconAction(
  id: string,
  icon: string | null
): Promise<Page> {
  const page = await setPageIcon(id, icon);
  revalidatePath("/", "layout");
  scheduleExport(page.id);
  return page;
}

/**
 * Sets (or clears, via `storagePath: null`) the cover image — `storagePath`
 * is the `files.storage_path` returned by the existing `/api/files` upload
 * pipeline. Best-effort deletes the previous cover's storage object + row so
 * replacing/removing a cover doesn't leak storage.
 */
export async function setPageCoverAction(
  id: string,
  storagePath: string | null
): Promise<Page> {
  const previous = await getPage(id);
  const page = await setPageCover(id, storagePath);
  if (previous?.cover_url && previous.cover_url !== storagePath) {
    await deleteFileByStoragePath(previous.cover_url);
  }
  revalidatePath("/", "layout");
  return page;
}

export async function setPageCoverPositionAction(
  id: string,
  position: number
): Promise<Page> {
  const clamped = Math.min(100, Math.max(0, Math.round(position)));
  const page = await setPageCoverPosition(id, clamped);
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
  scheduleExport(page.id);
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
  // The unified path-reconcile moves the moved page's file + child folder (and
  // thus the whole subtree) to the new space; descendants need no re-serialize.
  scheduleExport(id);
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
