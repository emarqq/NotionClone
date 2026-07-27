import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { importManifestPath } from "./config";

/**
 * Import manifest: maps each imported document's source path to the `files`
 * row + content hashes it produced. This is what makes re-import idempotent:
 * unchanged bytes are skipped, and a changed doc reuses its existing `files`
 * row (whose `storage_path` is UNIQUE) instead of inserting a duplicate.
 *
 * Keyed by the absolute source path (folder import) or the upload-relative
 * path (browser upload) — whatever identifies "the same document" over time.
 */

export interface ImportManifestEntry {
  /** `files.id` of the row backing this doc. */
  fileId: string;
  /** SHA-256 of the raw file bytes — skip-if-unchanged. */
  bytesHash: string;
  /** Deterministic storage path in the `attachments` bucket. */
  storagePath: string;
  /** POSIX rel path (under `importedRoot()`) of the mirrored `.md`, if written. */
  vaultRel: string | null;
  filename: string;
}

export type ImportManifest = Record<string, ImportManifestEntry>;

export async function loadImportManifest(): Promise<ImportManifest> {
  try {
    const raw = await fs.readFile(importManifestPath(), "utf8");
    return JSON.parse(raw) as ImportManifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function saveImportManifest(manifest: ImportManifest): Promise<void> {
  const target = importManifestPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}`);
  await fs.writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.rename(tmp, target);
}
