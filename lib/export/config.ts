import "server-only";

import os from "node:os";
import path from "node:path";

/** Default vault location (outside the repo); override with EXPORT_VAULT_DIR. */
const DEFAULT_VAULT_DIR = "~/ObsidianVault/NotionClone";
/** Subfolder inside the vault that the exporter owns exclusively (never touches sibling notes). */
const EXPORT_SUBDIR = "Notion";
/** Top-level mirror folder (under the export root) for archived pages. */
export const ARCHIVE_DIR = "Archive";

/** Expand a leading `~` (dotenv's convention) so EXPORT_VAULT_DIR can be `~/…`. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Absolute vault root. May also hold the user's own Obsidian notes — do not touch those. */
export function vaultRoot(): string {
  return path.resolve(expandHome(process.env.EXPORT_VAULT_DIR || DEFAULT_VAULT_DIR));
}

/** Absolute exporter-owned root (`<vault>/Notion`). Every mirrored page `.md` lives under here. */
export function exportRoot(): string {
  return path.join(vaultRoot(), EXPORT_SUBDIR);
}

/** Sidecar manifest, in a dotfolder Obsidian ignores. Holds page-id → path bookkeeping. */
export function manifestPath(): string {
  return path.join(vaultRoot(), ".notion-export", "manifest.json");
}

/** Set EXPORT_ENABLED=false to make every export a no-op (tests / opting out). */
export function exportEnabled(): boolean {
  return process.env.EXPORT_ENABLED !== "false";
}
