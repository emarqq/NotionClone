import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import { getEmbeddingProvider } from "@/lib/llm/registry";

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

interface HybridSearchRow {
  chunk_id: string;
  source_type: "page" | "file";
  page_id: string | null;
  file_id: string | null;
  space_id: string;
  heading_path: string[] | null;
  chunk_index: number;
  content: string;
  title: string | null;
  rrf_score: number;
}

/**
 * Embeds `query` and runs the `hybrid_search` RPC (FTS top-20 + vector top-20,
 * fused with RRF) for the AI chat panel and global search.
 */
export async function retrieve(
  query: string,
  opts?: { spaceId?: string | null; k?: number }
): Promise<RetrievedSource[]> {
  const embeddingProvider = await getEmbeddingProvider();
  const [queryEmbedding] = await embeddingProvider.embed([query]);

  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("hybrid_search", {
    query_text: query,
    query_embedding: queryEmbedding,
    space_filter: opts?.spaceId ?? null,
    match_count: opts?.k ?? 8,
  });
  if (error) throw new Error(`retrieve failed: ${error.message}`);

  return ((data ?? []) as HybridSearchRow[]).map((row) => ({
    chunkId: row.chunk_id,
    sourceType: row.source_type,
    pageId: row.page_id,
    fileId: row.file_id,
    spaceId: row.space_id,
    headingPath: row.heading_path ?? [],
    chunkIndex: row.chunk_index,
    content: row.content,
    title: row.title ?? "Untitled",
    score: row.rrf_score,
  }));
}
