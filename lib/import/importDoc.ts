import "server-only";

import { createHash } from "node:crypto";
import path from "node:path";

import { createServiceSupabase } from "@/lib/supabase/server";
import { createFileRecord } from "@/lib/db/files";
import { ingestFile } from "@/lib/rag/ingest";
import { extractFile } from "@/lib/rag/extractors";
import { mirrorImportedDoc } from "./vault";
import { SUPPORTED_IMPORT_EXTENSIONS } from "./config";
import type { ImportManifest, ImportManifestEntry } from "./manifest";

const ATTACHMENTS_BUCKET = "attachments";

export type ImportDocStatus = "imported" | "unchanged" | "unsupported" | "failed";

export interface ImportDocResult {
  filename: string;
  sourcePath: string;
  status: ImportDocStatus;
  fileId?: string;
  vaultRel?: string | null;
  chunks?: { inserted: number; deleted: number; kept: number };
  error?: string;
}

function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Deterministic storage path so re-import overwrites the same object (source path → stable folder). */
function storagePathFor(sourcePath: string, filename: string): string {
  const safe = (filename.split(/[\\/]/).pop() ?? "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 200) || "file";
  return `imported/${sha256(sourcePath)}/${safe}`;
}

/**
 * Import one document as read-only reference context:
 *   upload bytes → (reuse) files row → ingestFile (extract/chunk/embed/dedup)
 *   → mirror Markdown into the vault.
 *
 * `manifest` is read AND mutated in place (the caller loads once and saves once
 * after a batch). Re-import with unchanged bytes short-circuits to "unchanged".
 * This is the seam for a future editable-page importer: it would branch here
 * after extraction to also create pages/blocks instead of (or beside) the mirror.
 */
export async function importDoc(
  input: {
    bytes: Uint8Array;
    filename: string;
    /** Absolute path (folder import) or upload-relative path — the doc's stable identity + frontmatter source. */
    sourcePath: string;
    /** Path relative to the import base, for the vault mirror's folder layout. Defaults to filename. */
    mirrorPath?: string;
    mimeType: string;
    spaceId: string;
  },
  manifest: ImportManifest
): Promise<ImportDocResult> {
  const { bytes, filename, sourcePath, mimeType, spaceId } = input;
  const mirrorPath = input.mirrorPath ?? filename;
  const base: Pick<ImportDocResult, "filename" | "sourcePath"> = { filename, sourcePath };

  try {
    const bytesHash = sha256(bytes);
    const existing = manifest[sourcePath];
    if (existing && existing.bytesHash === bytesHash) {
      return { ...base, status: "unchanged", fileId: existing.fileId, vaultRel: existing.vaultRel };
    }

    const storagePath = existing?.storagePath ?? storagePathFor(sourcePath, filename);
    const supabase = createServiceSupabase();
    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(storagePath, Buffer.from(bytes), { contentType: mimeType, upsert: true });
    if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);

    // Reuse the existing files row (storage_path is UNIQUE) or create one.
    let fileId = existing?.fileId;
    if (!fileId) {
      const record = await createFileRecord({
        spaceId,
        pageId: null,
        storagePath,
        filename,
        mimeType,
        sizeBytes: bytes.byteLength,
        extractionStatus: "pending",
      });
      fileId = record.id;
    }

    // Extract + chunk + embed + dedup (sets files.extraction_status).
    const ingest = await ingestFile(fileId);

    // Mirror a read-only Markdown copy into the vault. Independent of ingest:
    // a mirror failure must not fail the import, and vice-versa.
    let vaultRel: string | null = existing?.vaultRel ?? null;
    try {
      const segments = await extractFile(bytes, mimeType, filename);
      if (segments) {
        vaultRel = await mirrorImportedDoc({ fileId, filename, sourcePath, mirrorPath, segments });
      }
    } catch (err) {
      console.error(`import mirror failed for ${sourcePath}:`, err);
    }

    const entry: ImportManifestEntry = { fileId, bytesHash, storagePath, vaultRel, filename };
    manifest[sourcePath] = entry;

    const status: ImportDocStatus =
      ingest.status === "done" ? "imported" : ingest.status === "unsupported" ? "unsupported" : "failed";
    return {
      ...base,
      status,
      fileId,
      vaultRel,
      chunks: { inserted: ingest.inserted, deleted: ingest.deleted, kept: ingest.kept },
    };
  } catch (err) {
    console.error(`importDoc failed for ${sourcePath}:`, err);
    return { ...base, status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Extension check used by the folder walk (kept beside importDoc for cohesion). */
export function isSupportedImportFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return (SUPPORTED_IMPORT_EXTENSIONS as readonly string[]).includes(ext);
}
