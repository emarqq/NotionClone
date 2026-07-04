import "server-only";

import { randomUUID } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/server";
import { firstPosition, positionAfter, positionBetween } from "@/lib/positions";
import type { Block, Json, Page, PageTreeNode, Space } from "@/lib/db/types";

export async function getSpaces(): Promise<Space[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("spaces")
    .select("*")
    .order("position", { ascending: true });
  if (error) throw new Error(`getSpaces failed: ${error.message}`);
  return (data ?? []) as Space[];
}

export async function getSpaceBySlug(slug: string): Promise<Space | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("spaces")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`getSpaceBySlug failed: ${error.message}`);
  return (data as Space) ?? null;
}

/**
 * Fetches all non-archived pages of a space in one query and assembles the
 * nested tree in JS. Children (and roots) are sorted by fractional position.
 */
export async function getPageTree(spaceId: string): Promise<PageTreeNode[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("pages")
    .select("*")
    .eq("space_id", spaceId)
    .eq("is_archived", false);
  if (error) throw new Error(`getPageTree failed: ${error.message}`);

  const pages = (data ?? []) as Page[];
  const nodes = new Map<string, PageTreeNode>();
  for (const page of pages) {
    nodes.set(page.id, { ...page, children: [] });
  }

  const roots: PageTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_page_id
      ? nodes.get(node.parent_page_id)
      : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const byPosition = (a: PageTreeNode, b: PageTreeNode) =>
    a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
  const sortDeep = (list: PageTreeNode[]) => {
    list.sort(byPosition);
    for (const node of list) sortDeep(node.children);
  };
  sortDeep(roots);

  return roots;
}

export async function getPage(id: string): Promise<Page | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("pages")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getPage failed: ${error.message}`);
  return (data as Page) ?? null;
}

/**
 * Compares fractional-index keys byte-wise (code-unit order), matching how
 * fractional-indexing defines ordering. Do NOT sort these keys in Postgres:
 * the database's locale collation orders e.g. 'Zz' AFTER 'a0', while the
 * fractional-index scheme (and JS `<`) orders 'Zz' BEFORE 'a0'.
 */
const byPositionKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Fetches the direct, non-archived children of a page, sorted by position. */
export async function getChildren(parentPageId: string): Promise<Page[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("pages")
    .select("*")
    .eq("parent_page_id", parentPageId)
    .eq("is_archived", false);
  if (error) throw new Error(`getChildren failed: ${error.message}`);
  return ((data ?? []) as Page[]).sort((a, b) =>
    byPositionKey(a.position, b.position)
  );
}

/**
 * Walks `parent_page_id` up to the root and returns the ancestor chain,
 * root-first (excludes `pageId` itself). Empty array for a top-level page.
 * A cycle guard prevents an infinite loop if data is ever malformed.
 */
export async function getAncestors(pageId: string): Promise<Page[]> {
  const chain: Page[] = [];
  const seen = new Set<string>([pageId]);

  let parentId = (await getPage(pageId))?.parent_page_id ?? null;
  while (parentId && !seen.has(parentId)) {
    const parent = await getPage(parentId);
    if (!parent) break;
    seen.add(parent.id);
    chain.unshift(parent);
    parentId = parent.parent_page_id;
  }
  return chain;
}

/** Fetches the last (highest) position among a page's siblings. */
async function getLastSiblingPosition(
  spaceId: string,
  parentPageId: string | null
): Promise<string | null> {
  const supabase = createServiceSupabase();
  let query = supabase
    .from("pages")
    .select("position")
    .eq("space_id", spaceId)
    .eq("is_archived", false);
  query = parentPageId
    ? query.eq("parent_page_id", parentPageId)
    : query.is("parent_page_id", null);

  const { data, error } = await query;
  if (error) throw new Error(`getLastSiblingPosition failed: ${error.message}`);
  const positions = (data ?? []).map((row) => row.position as string);
  if (positions.length === 0) return null;
  return positions.reduce((max, p) => (byPositionKey(p, max) > 0 ? p : max));
}

export async function createPage(input: {
  spaceId: string;
  parentPageId?: string | null;
  title?: string;
}): Promise<Page> {
  const supabase = createServiceSupabase();
  const parentPageId = input.parentPageId ?? null;
  const lastPosition = await getLastSiblingPosition(input.spaceId, parentPageId);
  const position =
    lastPosition === null ? firstPosition() : positionAfter(lastPosition);

  const { data, error } = await supabase
    .from("pages")
    .insert({
      space_id: input.spaceId,
      parent_page_id: parentPageId,
      title: input.title ?? "Untitled",
      position,
    })
    .select("*")
    .single();
  if (error) throw new Error(`createPage failed: ${error.message}`);
  return data as Page;
}

export async function renamePage(id: string, title: string): Promise<Page> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("pages")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`renamePage failed: ${error.message}`);
  return data as Page;
}

export async function setPageIcon(
  id: string,
  icon: string | null
): Promise<Page> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("pages")
    .update({ icon, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`setPageIcon failed: ${error.message}`);
  return data as Page;
}

export async function archivePage(id: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("pages")
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`archivePage failed: ${error.message}`);
}

/**
 * Moves a page under `newParentPageId` (null = space root).
 * If `afterPageId` is given, the page is placed directly after that sibling;
 * otherwise it is placed first among the new siblings.
 */
export async function movePage(input: {
  id: string;
  newParentPageId: string | null;
  afterPageId?: string | null;
}): Promise<Page> {
  const supabase = createServiceSupabase();

  const page = await getPage(input.id);
  if (!page) throw new Error(`movePage failed: page ${input.id} not found`);

  // Fetch new siblings (excluding the page being moved). Sorted in JS —
  // DB collation does not match fractional-index key order (see byPositionKey).
  let query = supabase
    .from("pages")
    .select("id, position")
    .eq("space_id", page.space_id)
    .eq("is_archived", false)
    .neq("id", input.id);
  query = input.newParentPageId
    ? query.eq("parent_page_id", input.newParentPageId)
    : query.is("parent_page_id", null);

  const { data: siblingsData, error: siblingsError } = await query;
  if (siblingsError) {
    throw new Error(`movePage failed: ${siblingsError.message}`);
  }
  const siblings = ((siblingsData ?? []) as Pick<Page, "id" | "position">[])
    .slice()
    .sort((a, b) => byPositionKey(a.position, b.position));

  let position: string;
  if (input.afterPageId) {
    const index = siblings.findIndex((s) => s.id === input.afterPageId);
    if (index === -1) {
      throw new Error(
        `movePage failed: afterPageId ${input.afterPageId} is not a sibling under the target parent`
      );
    }
    const prev = siblings[index];
    const next = siblings[index + 1] ?? null;
    position = positionBetween(prev.position, next?.position ?? null);
  } else {
    // Place first among the new siblings.
    position = positionBetween(null, siblings[0]?.position ?? null);
  }

  const { data, error } = await supabase
    .from("pages")
    .update({
      parent_page_id: input.newParentPageId,
      position,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw new Error(`movePage failed: ${error.message}`);
  return data as Page;
}

export async function toggleFavorite(
  id: string,
  isFavorite: boolean
): Promise<Page> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("pages")
    .update({ is_favorite: isFavorite })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`toggleFavorite failed: ${error.message}`);
  return data as Page;
}

/**
 * Fire-and-forget bump of `last_viewed_at`. Never throws — a failed view
 * touch must not break page rendering. Does not bump `updated_at` (the
 * pages trigger ignores pure view/favorite metadata changes).
 */
export async function touchLastViewed(id: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("pages")
    .update({ last_viewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.error(`touchLastViewed failed for page ${id}: ${error.message}`);
  }
}

/** Favorite pages across all spaces (not archived), ordered by title. */
export async function getFavorites(): Promise<Page[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("pages")
    .select("*")
    .eq("is_favorite", true)
    .eq("is_archived", false)
    .order("title", { ascending: true });
  if (error) throw new Error(`getFavorites failed: ${error.message}`);
  return (data ?? []) as Page[];
}

/** Recently viewed pages across all spaces (not archived), newest first. */
export async function getRecents(limit = 12): Promise<Page[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("pages")
    .select("*")
    .eq("is_archived", false)
    .not("last_viewed_at", "is", null)
    .order("last_viewed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`getRecents failed: ${error.message}`);
  return (data ?? []) as Page[];
}

/** Returns `content` with `attrs.blockId` replaced, when that attr exists. */
function withBlockIdAttr(content: Json, blockId: string): Json {
  if (
    content === null ||
    typeof content !== "object" ||
    Array.isArray(content)
  ) {
    return content;
  }
  const attrs = content.attrs;
  if (attrs === null || typeof attrs !== "object" || Array.isArray(attrs)) {
    return content;
  }
  return { ...content, attrs: { ...attrs, blockId } };
}

/**
 * Duplicates a page: copies the page row (title + " (copy)", never favorite,
 * positioned directly after the original among its siblings) and all of its
 * block rows under fresh block ids (including the editor's
 * `content.attrs.blockId` and `parent_block_id` references).
 * Shallow: child pages are NOT copied.
 */
export async function duplicatePage(id: string): Promise<Page> {
  const supabase = createServiceSupabase();

  const original = await getPage(id);
  if (!original) {
    throw new Error(`duplicatePage failed: page ${id} not found`);
  }

  // Place the copy between the original and its next sibling (JS-sorted, see
  // byPositionKey). positionBetween(orig, null) === positionAfter(orig).
  let siblingQuery = supabase
    .from("pages")
    .select("id, position")
    .eq("space_id", original.space_id)
    .eq("is_archived", false)
    .neq("id", id);
  siblingQuery = original.parent_page_id
    ? siblingQuery.eq("parent_page_id", original.parent_page_id)
    : siblingQuery.is("parent_page_id", null);
  const { data: siblingsData, error: siblingsError } = await siblingQuery;
  if (siblingsError) {
    throw new Error(`duplicatePage failed: ${siblingsError.message}`);
  }
  const nextSibling = ((siblingsData ?? []) as Pick<Page, "id" | "position">[])
    .filter((s) => byPositionKey(s.position, original.position) > 0)
    .sort((a, b) => byPositionKey(a.position, b.position))[0];
  const position = positionBetween(
    original.position,
    nextSibling?.position ?? null
  );

  const { data: copyData, error: copyError } = await supabase
    .from("pages")
    .insert({
      space_id: original.space_id,
      parent_page_id: original.parent_page_id,
      title: `${original.title} (copy)`,
      icon: original.icon,
      position,
      is_favorite: false,
    })
    .select("*")
    .single();
  if (copyError) throw new Error(`duplicatePage failed: ${copyError.message}`);
  const copy = copyData as Page;

  const { data: blocksData, error: blocksError } = await supabase
    .from("blocks")
    .select("*")
    .eq("page_id", id);
  if (blocksError) {
    throw new Error(`duplicatePage failed: ${blocksError.message}`);
  }
  const blocks = (blocksData ?? []) as Block[];

  if (blocks.length > 0) {
    // Fresh uuid per block, applied consistently to parent_block_id links
    // and the editor's content.attrs.blockId.
    const newIds = new Map(blocks.map((b) => [b.id, randomUUID()]));
    const rows = blocks.map((b) => {
      const newId = newIds.get(b.id)!;
      return {
        id: newId,
        page_id: copy.id,
        parent_block_id: b.parent_block_id
          ? newIds.get(b.parent_block_id) ?? null
          : null,
        type: b.type,
        content: withBlockIdAttr(b.content, newId),
        position: b.position,
      };
    });
    const { error: insertError } = await supabase.from("blocks").insert(rows);
    if (insertError) {
      throw new Error(`duplicatePage failed: ${insertError.message}`);
    }
  }

  return copy;
}

/**
 * Moves a page to the top level of `targetSpaceId` (after the last existing
 * top-level page there) and re-points `space_id` on all descendant pages and
 * on the `files` rows of the moved subtree so storage metadata stays
 * consistent. Returns the moved page plus its descendant ids so callers can
 * re-ingest the whole subtree (space/breadcrumb changed for all of them).
 */
export async function movePageToSpace(
  id: string,
  targetSpaceId: string
): Promise<{ page: Page; descendantIds: string[] }> {
  const supabase = createServiceSupabase();

  const page = await getPage(id);
  if (!page) {
    throw new Error(`movePageToSpace failed: page ${id} not found`);
  }

  // Collect the subtree in JS (archived descendants included so nothing is
  // left behind in the old space).
  const { data: spacePages, error: spacePagesError } = await supabase
    .from("pages")
    .select("id, parent_page_id")
    .eq("space_id", page.space_id);
  if (spacePagesError) {
    throw new Error(`movePageToSpace failed: ${spacePagesError.message}`);
  }
  const childrenByParent = new Map<string, string[]>();
  for (const row of (spacePages ?? []) as Pick<
    Page,
    "id" | "parent_page_id"
  >[]) {
    if (!row.parent_page_id) continue;
    const list = childrenByParent.get(row.parent_page_id) ?? [];
    list.push(row.id);
    childrenByParent.set(row.parent_page_id, list);
  }
  const descendantIds: string[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const childId of childrenByParent.get(current) ?? []) {
      descendantIds.push(childId);
      stack.push(childId);
    }
  }

  const lastPosition = await getLastSiblingPosition(targetSpaceId, null);
  const position =
    lastPosition === null ? firstPosition() : positionAfter(lastPosition);

  const { data, error } = await supabase
    .from("pages")
    .update({
      space_id: targetSpaceId,
      parent_page_id: null,
      position,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(`movePageToSpace failed: ${error.message}`);

  if (descendantIds.length > 0) {
    const { error: descendantsError } = await supabase
      .from("pages")
      .update({ space_id: targetSpaceId })
      .in("id", descendantIds);
    if (descendantsError) {
      throw new Error(`movePageToSpace failed: ${descendantsError.message}`);
    }
  }

  // Keep storage metadata consistent with the pages that own the files.
  const { error: filesError } = await supabase
    .from("files")
    .update({ space_id: targetSpaceId })
    .in("page_id", [id, ...descendantIds]);
  if (filesError) {
    throw new Error(`movePageToSpace failed: ${filesError.message}`);
  }

  return { page: data as Page, descendantIds };
}
