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
