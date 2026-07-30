import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { getEmbeddingProvider } from "@/lib/llm/registry";
import { expandNeighbors } from "@/lib/rag/graph";

export interface RetrievedSource {
  chunkId: string;
  sourceType: "page" | "file";
  pageId: string | null;
  fileId: string | null;
  spaceId: string;
  headingPath: string[];
  chunkIndex: number;
  content: string;
  title: string;
  score: number;
}

/** Columns shared by the hybrid_search and neighbor_search RPCs. */
interface ChunkRow {
  chunk_id: string;
  source_type: "page" | "file";
  page_id: string | null;
  file_id: string | null;
  space_id: string;
  heading_path: string[] | null;
  chunk_index: number;
  content: string;
  title: string | null;
}

interface HybridSearchRow extends ChunkRow {
  rrf_score: number;
}

interface NeighborSearchRow extends ChunkRow {
  vector_rank: number;
}

// RRF constant, matching hybrid_search's k=60. Neighbor chunks get a hop-decayed
// share of an RRF-style score so that, in practice, every direct hit outranks
// every neighbor (weakest single-arm seed ≈ 1/80 > best hop-1 neighbor ≈ 0.5/61)
// — connected context is strictly additive, never displacing semantic matches.
const RRF_K = 60;
const HOP_WEIGHT: Record<number, number> = { 1: 0.5, 2: 0.25 };
const MAX_NEIGHBOR_PAGES = 12;
const NEIGHBOR_MATCH_COUNT = 12;

function toSource(row: ChunkRow, score: number): RetrievedSource {
  return {
    chunkId: row.chunk_id,
    sourceType: row.source_type,
    pageId: row.page_id,
    fileId: row.file_id,
    spaceId: row.space_id,
    headingPath: row.heading_path ?? [],
    chunkIndex: row.chunk_index,
    content: row.content,
    title: row.title ?? "Untitled",
    score,
  };
}

/**
 * Graph expansion: from the seed hit set, walk `links` (both directions) to
 * neighbor pages, pull each neighbor page's most query-relevant chunk via the
 * neighbor_search RPC (reusing the already-computed query embedding — no
 * re-embed), score it with a hop-decayed RRF contribution, and append up to
 * `neighborBudget` of them after the seeds. Returns the seeds unchanged if there
 * are no page-sourced seeds or no reachable neighbors.
 */
async function expandRetrieval(
  queryEmbedding: number[],
  seeds: RetrievedSource[],
  opts: { spaceId: string | null; hops: 1 | 2; neighborBudget: number }
): Promise<RetrievedSource[]> {
  const seedPageIds = [
    ...new Set(
      seeds
        .filter((s) => s.sourceType === "page" && s.pageId)
        .map((s) => s.pageId as string)
    ),
  ];
  if (seedPageIds.length === 0) return seeds;

  const neighbors = await expandNeighbors(seedPageIds, {
    hops: opts.hops,
    maxPages: MAX_NEIGHBOR_PAGES,
    spaceId: opts.spaceId,
  });
  if (neighbors.size === 0) return seeds;

  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("neighbor_search", {
    query_embedding: queryEmbedding,
    page_ids: [...neighbors.keys()],
    space_filter: opts.spaceId,
    match_count: NEIGHBOR_MATCH_COUNT,
  });
  if (error) throw new Error(`neighbor_search failed: ${error.message}`);

  const seedChunkIds = new Set(seeds.map((s) => s.chunkId));
  const neighborChunks: RetrievedSource[] = [];
  for (const row of (data ?? []) as NeighborSearchRow[]) {
    // Neighbor pages exclude seed pages, so a collision here is not expected;
    // skip defensively rather than double-count or penalize a direct hit.
    if (seedChunkIds.has(row.chunk_id)) continue;
    const hop = neighbors.get(row.page_id ?? "") ?? 2;
    const score = (HOP_WEIGHT[hop] ?? HOP_WEIGHT[2]) * (1 / (RRF_K + row.vector_rank));
    neighborChunks.push(toSource(row, score));
  }

  neighborChunks.sort((a, b) => b.score - a.score);
  const kept = neighborChunks.slice(0, opts.neighborBudget);

  const merged = [...seeds, ...kept];
  merged.sort((a, b) => b.score - a.score);
  return merged;
}

/**
 * Embeds `query` and runs the `hybrid_search` RPC (FTS top-20 + vector top-20,
 * fused with RRF) for the AI chat panel and global search. When `expand` is set,
 * augments the hit set with chunks from directly-linked pages (graph RAG) —
 * `expand` off returns exactly the pure-hybrid result, so it's a clean A/B.
 */
export async function retrieve(
  query: string,
  opts?: {
    spaceId?: string | null;
    k?: number;
    expand?: boolean;
    hops?: 1 | 2;
    neighborBudget?: number;
    /**
     * The incoming request's signal. Retrieval runs *before* the first token, so
     * without this a client that gives up still leaves an embedding call running
     * — and a wedged embedder used to hang the whole chat request (BUG-4).
     */
    signal?: AbortSignal;
  }
): Promise<RetrievedSource[]> {
  const embeddingProvider = await getEmbeddingProvider();
  const [queryEmbedding] = await embeddingProvider.embed([query], opts?.signal);

  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("hybrid_search", {
    query_text: query,
    query_embedding: queryEmbedding,
    space_filter: opts?.spaceId ?? null,
    match_count: opts?.k ?? 8,
  });
  if (error) throw new Error(`retrieve failed: ${error.message}`);

  const seeds = ((data ?? []) as HybridSearchRow[]).map((row) =>
    toSource(row, row.rrf_score)
  );

  if (!opts?.expand) return seeds;

  return expandRetrieval(queryEmbedding, seeds, {
    spaceId: opts.spaceId ?? null,
    hops: opts.hops ?? 1,
    neighborBudget: opts.neighborBudget ?? 3,
  });
}
