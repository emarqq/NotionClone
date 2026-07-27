import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Page ids directly linked to any of `pageIds`, in BOTH directions:
 * outbound (links.source_page_id ∈ pageIds → target) and inbound
 * (links.target_page_id ∈ pageIds → source). Links are stored as a single
 * directional row per mention, so a full neighborhood needs both queries.
 */
async function linkedPageIds(
  supabase: SupabaseClient,
  pageIds: string[]
): Promise<Set<string>> {
  const [outbound, inbound] = await Promise.all([
    supabase.from("links").select("target_page_id").in("source_page_id", pageIds),
    supabase.from("links").select("source_page_id").in("target_page_id", pageIds),
  ]);
  if (outbound.error) {
    throw new Error(`expandNeighbors outbound failed: ${outbound.error.message}`);
  }
  if (inbound.error) {
    throw new Error(`expandNeighbors inbound failed: ${inbound.error.message}`);
  }

  const ids = new Set<string>();
  for (const row of outbound.data ?? []) ids.add(row.target_page_id as string);
  for (const row of inbound.data ?? []) ids.add(row.source_page_id as string);
  return ids;
}

/**
 * Narrows candidate page ids to ones that still exist, are non-archived, and —
 * when a space is scoped — belong to that space (keeps expansion inside the
 * user's chosen search scope). Returned sorted for deterministic capping.
 */
async function validPageIds(
  supabase: SupabaseClient,
  candidateIds: string[],
  spaceId: string | null
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  let query = supabase
    .from("pages")
    .select("id")
    .in("id", candidateIds)
    .eq("is_archived", false);
  if (spaceId) query = query.eq("space_id", spaceId);

  const { data, error } = await query;
  if (error) {
    throw new Error(`expandNeighbors page filter failed: ${error.message}`);
  }
  return (data ?? []).map((r) => r.id as string).sort();
}

/**
 * Graph expansion for RAG retrieval: given the pages of the initial hit set,
 * returns the pages reachable along `links` edges (both directions) tagged by
 * hop distance, so the retriever can pull their chunks and decay their score by
 * hop. Mirrors lib/db/links.ts's getBacklinks pattern (query links → Set →
 * batch-hydrate pages). Bounded by `maxPages` (total across hops) to guard
 * against context bloat. Seed pages themselves are always excluded.
 */
export async function expandNeighbors(
  seedPageIds: string[],
  opts: { hops?: 1 | 2; maxPages?: number; spaceId?: string | null } = {}
): Promise<Map<string, number>> {
  const hops = opts.hops ?? 1;
  const maxPages = opts.maxPages ?? 12;
  const spaceId = opts.spaceId ?? null;

  const byHop = new Map<string, number>();
  if (seedPageIds.length === 0 || maxPages <= 0) return byHop;

  const supabase = createServiceSupabase();
  const seedSet = new Set(seedPageIds);

  // --- hop 1: direct neighbors of the seed pages ---
  const hop1Raw = await linkedPageIds(supabase, seedPageIds);
  const hop1Candidates = [...hop1Raw].filter((id) => !seedSet.has(id));
  const hop1Valid = await validPageIds(supabase, hop1Candidates, spaceId);
  for (const id of hop1Valid) {
    if (byHop.size >= maxPages) break;
    byHop.set(id, 1);
  }

  // --- hop 2 (opt-in): neighbors of the hop-1 pages, minus seeds and hop-1 ---
  if (hops >= 2 && byHop.size < maxPages) {
    const hop1Ids = [...byHop.keys()];
    if (hop1Ids.length > 0) {
      const hop2Raw = await linkedPageIds(supabase, hop1Ids);
      const hop2Candidates = [...hop2Raw].filter(
        (id) => !seedSet.has(id) && !byHop.has(id)
      );
      const hop2Valid = await validPageIds(supabase, hop2Candidates, spaceId);
      for (const id of hop2Valid) {
        if (byHop.size >= maxPages) break;
        byHop.set(id, 2);
      }
    }
  }

  return byHop;
}
