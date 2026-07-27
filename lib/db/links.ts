import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { getBlocks } from "@/lib/db/blocks";
import { getSpaces } from "@/lib/db/pages";
import { extractLinkTargets } from "@/lib/links/extract";
import type { Page } from "@/lib/db/types";

interface ExistingLinkRow {
  id: string;
  source_block_id: string | null;
  target_page_id: string;
}

const linkKey = (blockId: string | null, targetPageId: string) =>
  `${blockId ?? ""}::${targetPageId}`;

/**
 * Re-derives a page's outgoing links from its current blocks (mirrors
 * lib/rag/ingest.ts's reconcileChunks): read blocks → extract targets →
 * filter to still-existing pages (a mention to a since-deleted page would
 * trip the FK) → diff against existing rows by (source_block_id,
 * target_page_id) → delete the stale, insert the new. Idempotent: an
 * unchanged page writes nothing. Cascade FKs already remove rows when a
 * block/page is deleted, so we only reconcile blocks that still exist.
 */
export async function reconcilePageLinks(pageId: string): Promise<void> {
  const supabase = createServiceSupabase();

  const blocks = await getBlocks(pageId);
  const desired = extractLinkTargets(
    blocks.map((b) => ({ id: b.id, content: b.content })),
    pageId
  );

  // Guard against inserting a target that no longer exists (FK violation).
  const targetIds = [...new Set(desired.map((d) => d.targetPageId))];
  let validTargets = new Set<string>();
  if (targetIds.length > 0) {
    const { data, error } = await supabase
      .from("pages")
      .select("id")
      .in("id", targetIds)
      .eq("is_archived", false);
    if (error) {
      throw new Error(`reconcilePageLinks target check failed: ${error.message}`);
    }
    validTargets = new Set((data ?? []).map((r) => r.id as string));
  }
  const desiredValid = desired.filter((d) => validTargets.has(d.targetPageId));

  const { data: existingData, error: existingError } = await supabase
    .from("links")
    .select("id, source_block_id, target_page_id")
    .eq("source_page_id", pageId);
  if (existingError) {
    throw new Error(`reconcilePageLinks read failed: ${existingError.message}`);
  }
  const existing = (existingData ?? []) as ExistingLinkRow[];

  const desiredKeys = new Set(
    desiredValid.map((d) => linkKey(d.sourceBlockId, d.targetPageId))
  );
  const existingKeys = new Set(
    existing.map((e) => linkKey(e.source_block_id, e.target_page_id))
  );

  const staleIds = existing
    .filter((e) => !desiredKeys.has(linkKey(e.source_block_id, e.target_page_id)))
    .map((e) => e.id);
  if (staleIds.length > 0) {
    const { error } = await supabase.from("links").delete().in("id", staleIds);
    if (error) {
      throw new Error(`reconcilePageLinks delete failed: ${error.message}`);
    }
  }

  const toInsert = desiredValid.filter(
    (d) => !existingKeys.has(linkKey(d.sourceBlockId, d.targetPageId))
  );
  if (toInsert.length > 0) {
    const rows = toInsert.map((d) => ({
      source_page_id: pageId,
      source_block_id: d.sourceBlockId,
      target_page_id: d.targetPageId,
    }));
    const { error } = await supabase.from("links").insert(rows);
    if (error) {
      throw new Error(`reconcilePageLinks insert failed: ${error.message}`);
    }
  }
}

/**
 * Distinct source pages that link to `pageId` (one entry per source page even
 * if it links from several blocks), non-archived, sorted by title. `spaceSlug`
 * is resolved in JS to match getAllPages's join style.
 */
export async function getBacklinks(pageId: string): Promise<
  { pageId: string; title: string; spaceSlug: string; icon: string | null }[]
> {
  const supabase = createServiceSupabase();

  const { data, error } = await supabase
    .from("links")
    .select("source_page_id")
    .eq("target_page_id", pageId)
    .neq("source_page_id", pageId);
  if (error) throw new Error(`getBacklinks failed: ${error.message}`);

  const sourceIds = [
    ...new Set((data ?? []).map((r) => r.source_page_id as string)),
  ];
  if (sourceIds.length === 0) return [];

  const [{ data: pagesData, error: pagesError }, spaces] = await Promise.all([
    supabase
      .from("pages")
      .select("id, title, icon, space_id")
      .in("id", sourceIds)
      .eq("is_archived", false),
    getSpaces(),
  ]);
  if (pagesError) throw new Error(`getBacklinks failed: ${pagesError.message}`);

  const slugById = new Map(spaces.map((s) => [s.id, s.slug]));
  return ((pagesData ?? []) as Pick<Page, "id" | "title" | "icon" | "space_id">[])
    .map((p) => ({
      pageId: p.id,
      title: p.title,
      icon: p.icon,
      spaceSlug: slugById.get(p.space_id) ?? "",
    }))
    .filter((p) => p.spaceSlug)
    .sort((a, b) => a.title.localeCompare(b.title));
}
