import { NextResponse, after } from "next/server";

import {
  createFileRecord,
  getSignedUrl,
  listFilesForPage,
} from "@/lib/db/files";
import { getPage } from "@/lib/db/pages";
import { createServiceSupabase } from "@/lib/supabase/server";
import { ingestFile } from "@/lib/rag/ingest";
import type { FileMeta } from "@/lib/db/types";

const ATTACHMENTS_BUCKET = "attachments";
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

/** FileMeta enriched with a fresh signed URL for the client. */
export type FileWithUrl = FileMeta & { url: string };

/** Mime types the extraction pipeline can handle (pdf/docx/xlsx/text/markdown). */
function extractionStatusFor(mimeType: string): "pending" | "unsupported" {
  const extractable =
    mimeType === "application/pdf" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "text/markdown" ||
    mimeType.startsWith("text/");
  return extractable ? "pending" : "unsupported";
}

/** Keeps the basename readable while stripping path separators and oddities. */
function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 200) || "file";
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError("Expected multipart/form-data body.", 400);
    }

    const file = formData.get("file");
    const pageId = formData.get("pageId");

    if (!(file instanceof File)) {
      return jsonError("Missing 'file' field in form data.", 400);
    }
    if (typeof pageId !== "string" || pageId.length === 0) {
      return jsonError("Missing 'pageId' field in form data.", 400);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return jsonError("File exceeds the 50 MB size limit.", 413);
    }

    const page = await getPage(pageId);
    if (!page) {
      return jsonError(`Page ${pageId} not found.`, 400);
    }

    const filename = sanitizeFilename(file.name || "file");
    const mimeType = file.type || "application/octet-stream";
    const storagePath = `${page.space_id}/${pageId}/${crypto.randomUUID()}-${filename}`;

    const supabase = createServiceSupabase();
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    if (uploadError) {
      return jsonError(`Storage upload failed: ${uploadError.message}`, 500);
    }

    let record: FileMeta;
    try {
      record = await createFileRecord({
        spaceId: page.space_id,
        pageId,
        storagePath,
        filename,
        mimeType,
        sizeBytes: file.size,
        extractionStatus: extractionStatusFor(mimeType),
      });
    } catch (error) {
      // Best-effort cleanup so no orphaned object lingers in storage.
      await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .remove([storagePath])
        .catch(() => {});
      throw error;
    }

    // Extraction/embedding never blocks the upload response.
    after(() =>
      ingestFile(record.id).catch((err) =>
        console.error(`ingestFile failed for file ${record.id}:`, err)
      )
    );

    const url = await getSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
    const body: FileWithUrl = { ...record, url };
    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return jsonError(message, 500);
  }
}

export async function GET(request: Request) {
  try {
    const pageId = new URL(request.url).searchParams.get("pageId");
    if (!pageId) {
      return jsonError("Missing 'pageId' query parameter.", 400);
    }

    const records = await listFilesForPage(pageId);
    const files: FileWithUrl[] = await Promise.all(
      records.map(async (record) => ({
        ...record,
        url: await getSignedUrl(record.storage_path, SIGNED_URL_TTL_SECONDS),
      }))
    );
    return NextResponse.json({ files });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list files.";
    return jsonError(message, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return jsonError("Missing 'id' query parameter.", 400);
    }

    const supabase = createServiceSupabase();
    const { data, error: fetchError } = await supabase
      .from("files")
      .select("id, storage_path")
      .eq("id", id)
      .maybeSingle();
    if (fetchError) {
      return jsonError(`Lookup failed: ${fetchError.message}`, 500);
    }
    if (!data) {
      return jsonError(`File ${id} not found.`, 404);
    }

    const { error: removeError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .remove([data.storage_path as string]);
    if (removeError) {
      return jsonError(
        `Storage removal failed: ${removeError.message}`,
        500
      );
    }

    const { error: deleteError } = await supabase
      .from("files")
      .delete()
      .eq("id", id);
    if (deleteError) {
      return jsonError(`Row deletion failed: ${deleteError.message}`, 500);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed.";
    return jsonError(message, 500);
  }
}
