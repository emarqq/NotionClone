import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { exportRoot } from "./config";
import { resolveWithinRoot } from "./paths";

/**
 * Filesystem ops for the vault mirror. Every path is a rel path resolved WITHIN
 * the export root (see resolveWithinRoot) — the exporter never touches anything
 * outside its owned subtree. Writes are atomic (same-dir temp + rename, so a
 * failed/partial serialize can never overwrite a good file) and EXDEV-safe
 * (temp lives beside the destination, same volume).
 */

function abs(rel: string): string {
  return resolveWithinRoot(exportRoot(), rel);
}

export async function writeFileAtomic(rel: string, contents: string): Promise<void> {
  const target = abs(rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}`);
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, target);
}

/** True if the rel path exists. */
export async function exists(rel: string): Promise<boolean> {
  try {
    await fs.stat(abs(rel));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

/** Move a file or folder; missing source is a no-op. Prunes empty parents of the old location. */
export async function movePath(oldRel: string, newRel: string): Promise<void> {
  if (oldRel === newRel) return;
  const from = abs(oldRel);
  const to = abs(newRel);
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return;
  }
  await pruneEmptyDirs(path.dirname(from));
}

/** Recursively delete a file/folder (force = no error if missing). Prunes empty parents. */
export async function removePath(rel: string): Promise<void> {
  const target = abs(rel);
  await fs.rm(target, { recursive: true, force: true });
  await pruneEmptyDirs(path.dirname(target));
}

/** Remove empty directories walking up from `startDir`, stopping at the export root. */
async function pruneEmptyDirs(startDir: string): Promise<void> {
  const root = exportRoot();
  let dir = startDir;
  while (dir.startsWith(root) && dir !== root) {
    try {
      const entries = await fs.readdir(dir);
      if (entries.length > 0) break;
      await fs.rmdir(dir);
    } catch {
      break;
    }
    dir = path.dirname(dir);
  }
}
