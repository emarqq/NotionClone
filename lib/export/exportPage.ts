import "server-only";

import { createHash } from "node:crypto";

import { createServiceSupabase } from "@/lib/supabase/server";
import { getAncestors, getPage, getSpaces } from "@/lib/db/pages";
import { getBlocks } from "@/lib/db/blocks";
import type { Page } from "@/lib/db/types";

import { ARCHIVE_DIR, exportEnabled } from "./config";
import { buildMarkdownFile } from "./frontmatter";
import {
  entriesUnder,
  loadManifest,
  type Manifest,
  parentFolderOf,
  saveManifest,
  siblingSegments,
  withExportLock,
} from "./manifest";
import {
  childFolderRel,
  fileRel,
  joinFolder,
  resolveSegment,
  sanitizeSegment,
  stripCollisionSuffix,
} from "./paths";
import { serializeBlocksToMarkdown } from "./serialize";
import { exists, movePath, removePath, writeFileAtomic } from "./vaultFs";

export interface ExportSummary {
  pages: number;
  written: number;
  renamed: number;
  deleted: number;
  errors: string[];
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── Path/segment assignment (unified move for rename/reparent/space/archive) ──

/** Under Archive/ iff the page or any ancestor is archived (keeps subtrees together). */
function isUnderArchive(page: Page, ancestors: Page[]): boolean {
  return page.is_archived || ancestors.some((a) => a.is_archived);
}

/** Folder rel path from ancestors' *stable manifest segments* (fallback: sanitized title). */
function computeFolder(
  manifest: Manifest,
  spaceName: string,
  ancestors: Page[],
  underArchive: boolean
): string {
  return joinFolder([
    ...(underArchive ? [ARCHIVE_DIR] : []),
    sanitizeSegment(spaceName) || "Space",
    ...ancestors.map((a) => manifest[a.id]?.segment ?? (sanitizeSegment(a.title) || a.id)),
  ]);
}

/** Keep the existing segment when the title's base is unchanged; else collision-resolve afresh. */
function computeSegment(manifest: Manifest, page: Page, folder: string): string {
  const base = sanitizeSegment(page.title) || page.id;
  const existing = manifest[page.id];
  if (existing && stripCollisionSuffix(existing.segment) === base) return existing.segment;
  return resolveSegment(base, siblingSegments(manifest, folder, page.id));
}

/**
 * If the page's desired file path changed, move its `.md` AND its `<seg>/`
 * child folder (relocating the whole descendant subtree in one op), then
 * prefix-rewrite descendant manifest paths. Returns true if it moved.
 */
async function movePageIfNeeded(
  manifest: Manifest,
  pageId: string,
  folder: string,
  segment: string
): Promise<boolean> {
  const existing = manifest[pageId];
  const newFileRel = fileRel(folder, segment);
  if (!existing || existing.path === newFileRel) return false;

  const oldChild = childFolderRel(parentFolderOf(existing.path), existing.segment);
  const newChild = childFolderRel(folder, segment);
  await movePath(existing.path, newFileRel);
  if (await exists(oldChild)) await movePath(oldChild, newChild);
  for (const [id, entry] of entriesUnder(manifest, oldChild)) {
    manifest[id] = { ...entry, path: newChild + entry.path.slice(oldChild.length) };
  }
  return true;
}

/** Assign this page's folder/segment/path (moving files if changed). Mutates `manifest`. */
async function assignInto(
  manifest: Manifest,
  page: Page,
  ancestors: Page[],
  spaceName: string
): Promise<{ underArchive: boolean; moved: boolean }> {
  const underArchive = isUnderArchive(page, ancestors);
  const folder = computeFolder(manifest, spaceName, ancestors, underArchive);
  const segment = computeSegment(manifest, page, folder);
  const moved = await movePageIfNeeded(manifest, page.id, folder, segment);
  const prev = manifest[page.id];
  manifest[page.id] = {
    segment,
    path: fileRel(folder, segment),
    hash: prev?.hash ?? "",
    title: page.title,
    archived: underArchive,
  };
  return { underArchive, moved };
}

/** Serialize + atomically write the body/frontmatter (skips if content-hash unchanged). */
async function writeBodyInto(
  manifest: Manifest,
  page: Page,
  underArchive: boolean
): Promise<boolean> {
  const blocks = await getBlocks(page.id);
  const body = serializeBlocksToMarkdown(blocks, {
    resolveWikilink: (targetId) => manifest[targetId]?.segment ?? null,
  });
  const parentSegment = page.parent_page_id ? manifest[page.parent_page_id]?.segment ?? null : null;
  const file = buildMarkdownFile(
    {
      id: page.id,
      title: page.title,
      icon: page.icon ?? undefined,
      created: page.created_at,
      updated: page.updated_at,
      parent: parentSegment ? `[[${parentSegment}]]` : undefined,
      aliases: [page.id],
      archived: underArchive || undefined,
    },
    body
  );
  const hash = sha256(file);
  const entry = manifest[page.id];
  if (entry.hash === hash) return false;
  await writeFileAtomic(entry.path, file);
  manifest[page.id] = { ...entry, hash };
  return true;
}

/** Remove a page's `.md`, its child-folder subtree, and all affected manifest entries. */
async function removeInto(manifest: Manifest, pageId: string): Promise<void> {
  const entry = manifest[pageId];
  if (!entry) return;
  const childFolder = childFolderRel(parentFolderOf(entry.path), entry.segment);
  await removePath(entry.path);
  await removePath(childFolder);
  for (const [id] of entriesUnder(manifest, childFolder)) delete manifest[id];
  delete manifest[pageId];
}

async function spaceNameMap(): Promise<Map<string, string>> {
  return new Map((await getSpaces()).map((s) => [s.id, s.name]));
}

// ── Public entry points (each takes the global export lock) ──────────────────

/**
 * Mirror one page to the vault: reconcile its path (rename/reparent/space-move/
 * archive all reduce to "desired path changed → move file+folder"), then write
 * body + frontmatter if the content changed. A missing page is treated as a
 * delete. Never throws in the after() hook path (callers `.catch`).
 */
export async function exportPage(pageId: string): Promise<void> {
  if (!exportEnabled()) return;
  await withExportLock(async () => {
    const page = await getPage(pageId);
    const manifest = await loadManifest();
    if (!page) {
      await removeInto(manifest, pageId);
      await saveManifest(manifest);
      return;
    }
    const spaceName = (await spaceNameMap()).get(page.space_id) ?? "Space";
    const ancestors = await getAncestors(pageId);
    const { underArchive } = await assignInto(manifest, page, ancestors, spaceName);
    await writeBodyInto(manifest, page, underArchive);
    await saveManifest(manifest);
  });
}

/** Remove a page (and its subtree) from the vault. */
export async function deletePageExport(pageId: string): Promise<void> {
  if (!exportEnabled()) return;
  await withExportLock(async () => {
    const manifest = await loadManifest();
    await removeInto(manifest, pageId);
    await saveManifest(manifest);
  });
}

/** Root-first ancestor chain built from an in-memory page map (avoids per-page DB walks). */
function ancestorsFromMap(byId: Map<string, Page>, page: Page): Page[] {
  const chain: Page[] = [];
  const seen = new Set<string>([page.id]);
  let cur = page.parent_page_id;
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const parent = byId.get(cur)!;
    chain.unshift(parent);
    cur = parent.parent_page_id;
  }
  return chain;
}

/**
 * Full backfill + reconcile. Two phases so every `[[wikilink]]` resolves to an
 * exact target basename: (1) assign every page's path/segment (moving files),
 * (2) serialize + write bodies against the now-complete manifest. Then delete
 * orphans — only manifest-tracked ids whose page no longer exists (never any
 * untracked file the user may own).
 */
export async function reconcileAll(): Promise<ExportSummary> {
  const summary: ExportSummary = { pages: 0, written: 0, renamed: 0, deleted: 0, errors: [] };
  if (!exportEnabled()) return summary;

  return withExportLock(async () => {
    const supabase = createServiceSupabase();
    const manifest = await loadManifest();
    const spaces = await spaceNameMap();

    const { data, error } = await supabase.from("pages").select("*");
    if (error) throw new Error(`reconcileAll list pages failed: ${error.message}`);
    const allPages = (data ?? []) as Page[];
    const byId = new Map(allPages.map((p) => [p.id, p]));

    const depth = (p: Page) => ancestorsFromMap(byId, p).length;
    const ordered = allPages.slice().sort((a, b) => depth(a) - depth(b));

    // Phase 1 — assign paths/segments (+ moves), parents before children.
    for (const page of ordered) {
      try {
        const { moved } = await assignInto(
          manifest,
          page,
          ancestorsFromMap(byId, page),
          spaces.get(page.space_id) ?? "Space"
        );
        if (moved) summary.renamed += 1;
      } catch (e) {
        summary.errors.push(`assign ${page.id}: ${errMsg(e)}`);
      }
    }

    // Phase 2 — serialize + write bodies.
    for (const page of ordered) {
      try {
        const underArchive = manifest[page.id]?.archived ?? false;
        if (await writeBodyInto(manifest, page, underArchive)) summary.written += 1;
        summary.pages += 1;
      } catch (e) {
        summary.errors.push(`write ${page.id}: ${errMsg(e)}`);
      }
    }

    // Orphans — manifest-tracked pages that no longer exist in the DB.
    for (const id of Object.keys(manifest)) {
      if (byId.has(id)) continue;
      try {
        await removeInto(manifest, id);
        summary.deleted += 1;
      } catch (e) {
        summary.errors.push(`orphan ${id}: ${errMsg(e)}`);
      }
    }

    await saveManifest(manifest);
    return summary;
  });
}
