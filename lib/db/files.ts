import "server-only";

import { createServiceSupabase } from "@/lib/supabase/server";
import type { FileMeta } from "@/lib/db/types";

const ATTACHMENTS_BUCKET = "attachments";

export interface NewFileRecord {
  spaceId: string;
  pageId?: string | null;
  blockId?: string | null;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractionStatus?: string;
}

export async function createFileRecord(meta: NewFileRecord): Promise<FileMeta> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("files")
    .insert({
      space_id: meta.spaceId,
      page_id: meta.pageId ?? null,
      block_id: meta.blockId ?? null,
      storage_path: meta.storagePath,
      filename: meta.filename,
      mime_type: meta.mimeType,
      size_bytes: meta.sizeBytes,
      ...(meta.extractionStatus !== undefined
        ? { extraction_status: meta.extractionStatus }
        : {}),
    })
    .select("*")
    .single();
  if (error) throw new Error(`createFileRecord failed: ${error.message}`);
  return data as FileMeta;
}

export async function getFileById(id: string): Promise<FileMeta | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getFileById failed: ${error.message}`);
  return (data as FileMeta) ?? null;
}

export async function listFilesForPage(pageId: string): Promise<FileMeta[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("page_id", pageId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listFilesForPage failed: ${error.message}`);
  return (data ?? []) as FileMeta[];
}

/**
 * Best-effort removal of a file's storage object + row by storage path, used
 * to clean up a replaced/removed page cover. Never throws — callers treat
 * this as cleanup, not a critical-path operation.
 */
export async function deleteFileByStoragePath(storagePath: string): Promise<void> {
  const supabase = createServiceSupabase();
  try {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([storagePath]);
    await supabase.from("files").delete().eq("storage_path", storagePath);
  } catch {
    // Cleanup only — an orphaned object/row here is harmless.
  }
}

/** Creates a signed URL for a file in the 'attachments' bucket. */
export async function getSignedUrl(
  storagePath: string,
  expiresIn: number = 3600
): Promise<string> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error) throw new Error(`getSignedUrl failed: ${error.message}`);
  if (!data?.signedUrl) {
    throw new Error(`getSignedUrl failed: no signed URL returned for ${storagePath}`);
  }
  return data.signedUrl;
}
