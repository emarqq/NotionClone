import { NextResponse } from "next/server";

import { createServiceSupabase } from "@/lib/supabase/server";
import { ingestFile, ingestPage } from "@/lib/rag/ingest";

interface IngestRequestBody {
  pageId?: string;
  fileId?: string;
  all?: boolean;
}

interface ChunkTotals {
  inserted: number;
  deleted: number;
  kept: number;
}

interface IngestSummary {
  pages: number;
  files: number;
  chunks: ChunkTotals;
  errors: string[];
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function newSummary(): IngestSummary {
  return { pages: 0, files: 0, chunks: { inserted: 0, deleted: 0, kept: 0 }, errors: [] };
}

function addChunks(totals: ChunkTotals, result: ChunkTotals): void {
  totals.inserted += result.inserted;
  totals.deleted += result.deleted;
  totals.kept += result.kept;
}

/** Re-ingests one page, recording success/failure into `summary`. Never throws. */
async function ingestOnePage(pageId: string, summary: IngestSummary): Promise<void> {
  try {
    const result = await ingestPage(pageId);
    summary.pages += 1;
    addChunks(summary.chunks, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    summary.errors.push(`page ${pageId}: ${message}`);
  }
}

/** Re-ingests one file, recording success/failure into `summary`. ingestFile itself never throws. */
async function ingestOneFile(fileId: string, summary: IngestSummary): Promise<void> {
  try {
    const result = await ingestFile(fileId);
    summary.files += 1;
    addChunks(summary.chunks, result);
    if (result.status === "failed") {
      summary.errors.push(`file ${fileId}: extraction failed`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    summary.errors.push(`file ${fileId}: ${message}`);
  }
}

/**
 * Backfill/reindex endpoint. POST `{pageId}` | `{fileId}` | `{all: true}` —
 * exactly one must be set. `all` sweeps every non-archived page and every
 * file whose extraction_status isn't 'unsupported', sequentially, so one bad
 * item never aborts the rest.
 */
export async function POST(request: Request) {
  let body: IngestRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonError("Expected a JSON body.", 400);
  }

  const targets = [body.pageId, body.fileId, body.all].filter(
    (v) => v !== undefined && v !== null && v !== false
  );
  if (targets.length !== 1) {
    return jsonError("Exactly one of pageId, fileId, or all must be set.", 400);
  }

  const summary = newSummary();

  if (body.pageId) {
    await ingestOnePage(body.pageId, summary);
    return NextResponse.json(summary);
  }

  if (body.fileId) {
    await ingestOneFile(body.fileId, summary);
    return NextResponse.json(summary);
  }

  // all: true — sweep every non-archived page and extractable file.
  const supabase = createServiceSupabase();

  const { data: pages, error: pagesError } = await supabase
    .from("pages")
    .select("id")
    .eq("is_archived", false);
  if (pagesError) {
    return jsonError(`Listing pages failed: ${pagesError.message}`, 500);
  }
  for (const { id } of (pages ?? []) as { id: string }[]) {
    await ingestOnePage(id, summary);
  }

  const { data: files, error: filesError } = await supabase
    .from("files")
    .select("id")
    .in("extraction_status", ["pending", "done", "failed"]);
  if (filesError) {
    return jsonError(`Listing files failed: ${filesError.message}`, 500);
  }
  for (const { id } of (files ?? []) as { id: string }[]) {
    await ingestOneFile(id, summary);
  }

  return NextResponse.json(summary);
}
