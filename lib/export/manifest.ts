import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { manifestPath } from "./config";

export interface ManifestEntry {
  /** Stable name segment within the parent folder — names both `<seg>.md` and the `<seg>/` child folder. */
  segment: string;
  /** POSIX rel path (from the export root) of the `.md` file, e.g. "Work/Meetings/Pricing sync.md". */
  path: string;
  /** sha256 of the full file contents last written (skip-if-unchanged). */
  hash: string;
  title: string;
  archived: boolean;
}

/** pageId → entry. */
export type Manifest = Record<string, ManifestEntry>;

// ── Global serial op queue ────────────────────────────────────────────────
// after() hooks run concurrently across requests; a directory rename must not
// interleave with another hook writing into the old path, and manifest
// read-modify-write must not race. Serialize ALL export fs+manifest work here.
// Process-local (correct for this single-user, single-process app).
let chain: Promise<unknown> = Promise.resolve();

export function withExportLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// ── Load / save (atomic, same-dir temp) ───────────────────────────────────
export async function loadManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await fs.readFile(manifestPath(), "utf8")) as Manifest;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function saveManifest(manifest: Manifest): Promise<void> {
  const target = manifestPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.manifest.json.tmp-${process.pid}`);
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
  await fs.rename(tmp, target);
}

// ── Query helpers ──────────────────────────────────────────────────────────
/** Sibling segments already taken in `folder` (excluding `exceptId`) — for collision resolution. */
export function siblingSegments(
  manifest: Manifest,
  folder: string,
  exceptId: string
): Set<string> {
  const taken = new Set<string>();
  for (const [id, entry] of Object.entries(manifest)) {
    if (id === exceptId) continue;
    if (parentFolderOf(entry.path) === folder) taken.add(entry.segment);
  }
  return taken;
}

/** [id, entry] pairs whose file lives at or under `folderPrefix` (a child-folder rel path). */
export function entriesUnder(
  manifest: Manifest,
  folderPrefix: string
): [string, ManifestEntry][] {
  const prefix = `${folderPrefix}/`;
  return Object.entries(manifest).filter(([, e]) => e.path.startsWith(prefix));
}

/** The rel folder a file sits in ("Work/Meetings/x.md" → "Work/Meetings"). */
export function parentFolderOf(fileRelPath: string): string {
  const idx = fileRelPath.lastIndexOf("/");
  return idx === -1 ? "" : fileRelPath.slice(0, idx);
}
