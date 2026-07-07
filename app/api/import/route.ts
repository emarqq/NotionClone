import { NextResponse } from "next/server";

import fs from "node:fs/promises";
import path from "node:path";

import { expandHome } from "@/lib/export/config";
import { defaultSourceDir, mimeForFilename } from "@/lib/import/config";
import { getOrCreateImportedSpace } from "@/lib/import/space";
import { importDoc, isSupportedImportFile, type ImportDocResult } from "@/lib/import/importDoc";
import { loadImportManifest, saveImportManifest, type ImportManifest } from "@/lib/import/manifest";

export const runtime = "nodejs";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB — matches the attachment uploader.

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Summary tally over a batch of imported docs. */
interface ImportSummary {
  space: { id: string; name: string; slug: string };
  imported: number;
  unchanged: number;
  unsupported: number;
  failed: number;
  skipped: number;
  chunks: { inserted: number; deleted: number; kept: number };
  results: ImportDocResult[];
  errors: string[];
}

function emptySummary(space: ImportSummary["space"]): ImportSummary {
  return {
    space,
    imported: 0,
    unchanged: 0,
    unsupported: 0,
    failed: 0,
    skipped: 0,
    chunks: { inserted: 0, deleted: 0, kept: 0 },
    results: [],
    errors: [],
  };
}

function tally(summary: ImportSummary, result: ImportDocResult): void {
  summary.results.push(result);
  summary[result.status] += 1;
  if (result.chunks) {
    summary.chunks.inserted += result.chunks.inserted;
    summary.chunks.deleted += result.chunks.deleted;
    summary.chunks.kept += result.chunks.kept;
  }
  if (result.error) summary.errors.push(`${result.sourcePath}: ${result.error}`);
}

/** Recursively collect supported files under `dir` (absolute paths). */
async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // skip dotfiles/dirs
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && isSupportedImportFile(entry.name)) out.push(full);
    }
  }
  await walk(dir);
  return out;
}

async function importFromFolder(dirInput: string | undefined): Promise<NextResponse> {
  const dir = path.resolve(expandHome(dirInput?.trim() || defaultSourceDir()));
  let stat;
  try {
    stat = await fs.stat(dir);
  } catch {
    return jsonError(`Source folder not found: ${dir}`, 400);
  }
  if (!stat.isDirectory()) return jsonError(`Not a folder: ${dir}`, 400);

  const space = await getOrCreateImportedSpace();
  const summary = emptySummary({ id: space.id, name: space.name, slug: space.slug });
  const manifest: ImportManifest = await loadImportManifest();

  const files = await collectFiles(dir);
  for (const absPath of files) {
    try {
      const fileStat = await fs.stat(absPath);
      if (fileStat.size > MAX_FILE_SIZE_BYTES) {
        summary.skipped += 1;
        summary.errors.push(`${absPath}: exceeds 50 MB limit (skipped)`);
        continue;
      }
      const bytes = new Uint8Array(await fs.readFile(absPath));
      const filename = path.basename(absPath);
      const result = await importDoc(
        { bytes, filename, sourcePath: absPath, mimeType: mimeForFilename(filename), spaceId: space.id },
        manifest
      );
      tally(summary, result);
    } catch (err) {
      summary.failed += 1;
      summary.errors.push(`${absPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await saveImportManifest(manifest);
  return NextResponse.json(summary);
}

async function importFromUpload(formData: FormData): Promise<NextResponse> {
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return jsonError("No files in upload.", 400);

  const space = await getOrCreateImportedSpace();
  const summary = emptySummary({ id: space.id, name: space.name, slug: space.slug });
  const manifest: ImportManifest = await loadImportManifest();

  for (const file of files) {
    const filename = file.name || "file";
    if (!isSupportedImportFile(filename)) {
      summary.skipped += 1;
      summary.errors.push(`${filename}: unsupported file type (skipped)`);
      continue;
    }
    try {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        summary.skipped += 1;
        summary.errors.push(`${filename}: exceeds 50 MB limit (skipped)`);
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      // webkitRelativePath (folder upload) keeps the source tree; fall back to the name.
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      const sourcePath = rel && rel.length > 0 ? rel : filename;
      const result = await importDoc(
        {
          bytes,
          filename,
          sourcePath,
          mimeType: file.type || mimeForFilename(filename),
          spaceId: space.id,
        },
        manifest
      );
      tally(summary, result);
    } catch (err) {
      summary.failed += 1;
      summary.errors.push(`${filename}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await saveImportManifest(manifest);
  return NextResponse.json(summary);
}

/**
 * Import external documents as read-only reference context. Two modes by
 * content-type:
 *   - application/json { dir?: string }  → recursively import a local folder
 *     (defaults to IMPORT_SOURCE_DIR).
 *   - multipart/form-data (files[])      → import uploaded files/folder.
 * Imports run sequentially to avoid hammering the embedding provider.
 */
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      return await importFromUpload(formData);
    }
    let body: { dir?: string } = {};
    try {
      body = (await request.json()) as { dir?: string };
    } catch {
      // Empty/invalid JSON → import the default source dir.
    }
    return await importFromFolder(body.dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    return jsonError(message, 500);
  }
}
