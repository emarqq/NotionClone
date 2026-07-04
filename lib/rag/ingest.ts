import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase/server";
import { getEmbeddingProvider } from "@/lib/llm/registry";
import { getPage } from "@/lib/db/pages";
import { getBlocks } from "@/lib/db/blocks";
import type { FileMeta, Page } from "@/lib/db/types";
import { segmentsFromBlocks } from "@/lib/rag/blockText";
import { chunkSegments, type Chunk } from "@/lib/rag/chunker";
import { extractFile } from "@/lib/rag/extractors";

const ATTACHMENTS_BUCKET = "attachments";

interface ChunkSource {
  sourceType: "page" | "file";
  pageId: string | null;
  fileId: string | null;
}

interface ReconcileResult {
  inserted: number;
  deleted: number;
  kept: number;
}

interface ExistingChunkRow {
  id: string;
  chunk_index: number;
  heading_path: string[] | null;
  content_hash: string;
}

/** `OLLAMA_EMBED_MODEL` default kept in sync with lib/llm/providers/ollama.ts — no provider-internals import. */
function embeddingModelName(): string {
  return process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
}

async function getSpaceName(supabase: SupabaseClient, spaceId: string): Promise<string> {
  const { data, error } = await supabase
    .from("spaces")
    .select("name")
    .eq("id", spaceId)
    .maybeSingle();
  if (error) throw new Error(`getSpaceName failed: ${error.message}`);
  return (data?.name as string | undefined) ?? "Untitled space";
}

/** "Space name > ancestor page titles > page title", walking parent_page_id to the root. */
async function buildPageBreadcrumb(supabase: SupabaseClient, page: Page): Promise<string> {
  const titles: string[] = [page.title];
  let parentId = page.parent_page_id;
  while (parentId) {
    const parent = await getPage(parentId);
    if (!parent) break;
    titles.unshift(parent.title);
    parentId = parent.parent_page_id;
  }
  const spaceName = await getSpaceName(supabase, page.space_id);
  return [spaceName, ...titles].join(" > ");
}

async function getFileById(supabase: SupabaseClient, fileId: string): Promise<FileMeta | null> {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", fileId)
    .maybeSingle();
  if (error) throw new Error(`getFileById failed: ${error.message}`);
  return (data as FileMeta) ?? null;
}

/** "Space name > ancestor page titles > page title > filename" (or "Space name > filename" for unattached files). */
async function buildFileBreadcrumb(supabase: SupabaseClient, file: FileMeta): Promise<string> {
  if (file.page_id) {
    const page = await getPage(file.page_id);
    if (page) {
      const pageBreadcrumb = await buildPageBreadcrumb(supabase, page);
      return `${pageBreadcrumb} > ${file.filename}`;
    }
  }
  const spaceName = await getSpaceName(supabase, file.space_id);
  return `${spaceName} > ${file.filename}`;
}

async function deleteAllChunksForSource(
  supabase: SupabaseClient,
  source: ChunkSource
): Promise<number> {
  const column = source.sourceType === "page" ? "page_id" : "file_id";
  const id = source.sourceType === "page" ? source.pageId : source.fileId;
  const { data, error } = await supabase
    .from("chunks")
    .delete()
    .eq(column, id)
    .select("id");
  if (error) throw new Error(`deleteAllChunksForSource failed: ${error.message}`);
  return (data ?? []).length;
}

/**
 * Diffs freshly-computed chunks against the source's existing rows by
 * content_hash: unchanged chunks are kept (only chunk_index/heading_path are
 * patched if position shifted — no re-embed), rows whose hash disappeared are
 * deleted, and only genuinely new chunks are embedded and inserted.
 */
async function reconcileChunks(
  supabase: SupabaseClient,
  source: ChunkSource,
  spaceId: string,
  chunks: Chunk[]
): Promise<ReconcileResult> {
  const column = source.sourceType === "page" ? "page_id" : "file_id";
  const id = source.sourceType === "page" ? source.pageId : source.fileId;

  const { data: existingData, error: existingError } = await supabase
    .from("chunks")
    .select("id, chunk_index, heading_path, content_hash")
    .eq(column, id);
  if (existingError) throw new Error(`reconcileChunks failed: ${existingError.message}`);
  const existingRows = (existingData ?? []) as ExistingChunkRow[];

  const availableByHash = new Map<string, ExistingChunkRow[]>();
  for (const row of existingRows) {
    const list = availableByHash.get(row.content_hash) ?? [];
    list.push(row);
    availableByHash.set(row.content_hash, list);
  }

  const matchedIds = new Set<string>();
  const toInsert: Chunk[] = [];
  const toPatch: { id: string; chunkIndex: number; headingPath: string[] }[] = [];

  for (const chunk of chunks) {
    const queue = availableByHash.get(chunk.contentHash);
    const existing = queue?.shift();
    if (existing) {
      matchedIds.add(existing.id);
      const headingChanged =
        JSON.stringify(existing.heading_path ?? []) !== JSON.stringify(chunk.headingPath);
      if (existing.chunk_index !== chunk.chunkIndex || headingChanged) {
        toPatch.push({ id: existing.id, chunkIndex: chunk.chunkIndex, headingPath: chunk.headingPath });
      }
    } else {
      toInsert.push(chunk);
    }
  }

  const staleIds = existingRows.filter((row) => !matchedIds.has(row.id)).map((row) => row.id);
  if (staleIds.length > 0) {
    const { error } = await supabase.from("chunks").delete().in("id", staleIds);
    if (error) throw new Error(`reconcileChunks delete failed: ${error.message}`);
  }

  for (const patch of toPatch) {
    const { error } = await supabase
      .from("chunks")
      .update({ chunk_index: patch.chunkIndex, heading_path: patch.headingPath })
      .eq("id", patch.id);
    if (error) throw new Error(`reconcileChunks patch failed: ${error.message}`);
  }

  if (toInsert.length > 0) {
    const embeddingProvider = await getEmbeddingProvider();
    const embeddings = await embeddingProvider.embed(toInsert.map((c) => c.content));
    const embeddingModel = `${embeddingProvider.id}:${embeddingModelName()}`;

    const rows = toInsert.map((chunk, index) => ({
      source_type: source.sourceType,
      page_id: source.pageId,
      file_id: source.fileId,
      space_id: spaceId,
      chunk_index: chunk.chunkIndex,
      heading_path: chunk.headingPath,
      content: chunk.content,
      content_hash: chunk.contentHash,
      token_count: chunk.tokenCount,
      embedding: embeddings[index],
      embedding_model: embeddingModel,
    }));
    const { error } = await supabase.from("chunks").insert(rows);
    if (error) throw new Error(`reconcileChunks insert failed: ${error.message}`);
  }

  return { inserted: toInsert.length, deleted: staleIds.length, kept: matchedIds.size };
}

/** (Re-)ingests a page's blocks into `chunks`. Empty page (no blocks) deletes all its chunks. */
export async function ingestPage(pageId: string): Promise<ReconcileResult> {
  const supabase = createServiceSupabase();
  const page = await getPage(pageId);
  if (!page) throw new Error(`ingestPage failed: page ${pageId} not found`);

  const blocks = await getBlocks(pageId);
  const segments = segmentsFromBlocks(blocks, page.title);
  const chunks = segments.length > 0 ? chunkSegments(segments, await buildPageBreadcrumb(supabase, page)) : [];

  return reconcileChunks(supabase, { sourceType: "page", pageId, fileId: null }, page.space_id, chunks);
}

/**
 * Downloads a file's bytes from Storage and (re-)ingests its extracted text.
 * Never throws: extraction/download failures are caught and reported via the
 * returned `status` (also persisted to `files.extraction_status`).
 */
export async function ingestFile(
  fileId: string
): Promise<ReconcileResult & { status: "done" | "failed" | "unsupported" }> {
  const supabase = createServiceSupabase();
  try {
    const file = await getFileById(supabase, fileId);
    if (!file) throw new Error(`file ${fileId} not found`);

    const { data: blob, error: downloadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .download(file.storage_path);
    if (downloadError || !blob) {
      throw new Error(`download failed: ${downloadError?.message ?? "no data"}`);
    }
    const data = new Uint8Array(await blob.arrayBuffer());

    const segments = await extractFile(data, file.mime_type, file.filename);
    if (segments === null) {
      const deleted = await deleteAllChunksForSource(supabase, {
        sourceType: "file",
        pageId: null,
        fileId,
      });
      await supabase.from("files").update({ extraction_status: "unsupported" }).eq("id", fileId);
      return { inserted: 0, deleted, kept: 0, status: "unsupported" };
    }

    const chunks =
      segments.length > 0
        ? chunkSegments(segments, await buildFileBreadcrumb(supabase, file))
        : [];
    const result = await reconcileChunks(
      supabase,
      { sourceType: "file", pageId: null, fileId },
      file.space_id,
      chunks
    );
    await supabase.from("files").update({ extraction_status: "done" }).eq("id", fileId);
    return { ...result, status: "done" };
  } catch (err) {
    console.error(`ingestFile failed for ${fileId}:`, err);
    try {
      await supabase.from("files").update({ extraction_status: "failed" }).eq("id", fileId);
    } catch {
      // Best-effort status update; the caught error above is still reported via `status`.
    }
    return { inserted: 0, deleted: 0, kept: 0, status: "failed" };
  }
}
