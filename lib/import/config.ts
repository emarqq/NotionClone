import "server-only";

import path from "node:path";

import { vaultRoot, expandHome } from "@/lib/export/config";

/**
 * Config for the document importer (lib/import/). Imported reference docs are
 * chunked into `chunks` (reusing ingestFile) AND mirrored into the vault as
 * read-only Markdown. Their mirror lives under a sibling of the page-export
 * root so the page exporter's orphan reconcile never touches it.
 */

/** Default folder to import from — where the user's project docs live. Override with IMPORT_SOURCE_DIR. */
const DEFAULT_SOURCE_DIR = "~/OS/brain-docs";
/** Top-level vault folder the importer owns exclusively (sibling of `<vault>/Notion`). */
const IMPORTED_SUBDIR = "Imported";

/** Absolute default source directory shown in the import UI (env-overridable, `~` expanded). */
export function defaultSourceDir(): string {
  return path.resolve(expandHome(process.env.IMPORT_SOURCE_DIR || DEFAULT_SOURCE_DIR));
}

/** Absolute importer-owned vault root (`<vault>/Imported`). Every imported `.md` lives under here. */
export function importedRoot(): string {
  return path.join(vaultRoot(), IMPORTED_SUBDIR);
}

/** Sidecar manifest (dotfolder Obsidian ignores) — source path → imported-file bookkeeping. */
export function importManifestPath(): string {
  return path.join(vaultRoot(), ".notion-import", "manifest.json");
}

/** File extensions the importer will pick up during a folder walk (mirrors extractFile's dispatch). */
export const SUPPORTED_IMPORT_EXTENSIONS = [".pdf", ".docx", ".xlsx", ".txt", ".md"] as const;

/** Best-effort MIME for a filename, used when reading raw bytes off disk (extractFile also falls back on extension). */
export function mimeForFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".md":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}
