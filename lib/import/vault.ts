import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import type { Segment } from "@/lib/rag/chunker";
import { buildMarkdownFile } from "@/lib/export/frontmatter";
import { resolveWithinRoot, sanitizeSegment } from "@/lib/export/paths";
import { importedRoot } from "./config";

/**
 * Read-only Markdown mirror for imported reference docs. Bodies come straight
 * from the extractor `Segment[]` (extractors already produce text) — we do NOT
 * use the block serializer (that's page/ProseMirror-specific). Everything is
 * written under `importedRoot()` (`<vault>/Imported`), a sibling of the page
 * exporter's root, so the page exporter's orphan reconcile never sees these.
 */

/** Resolve a rel path WITHIN the imported root — the containment guard, same invariant as the exporter. */
function abs(rel: string): string {
  return resolveWithinRoot(importedRoot(), rel);
}

/** Atomic write (same-dir temp + rename), rooted+guarded at `importedRoot()`. */
export async function writeImportedFileAtomic(rel: string, contents: string): Promise<void> {
  const target = abs(rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}`);
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, target);
}

/** Render extractor segments into simple Markdown: headingPath → `##` headings, then the text. */
export function segmentsToMarkdown(segments: Segment[]): string {
  const parts: string[] = [];
  let lastHeading = "";
  for (const seg of segments) {
    const heading = seg.headingPath.filter(Boolean).join(" > ");
    if (heading && heading !== lastHeading) {
      // Depth follows nesting, capped at h6.
      const level = Math.min(seg.headingPath.filter(Boolean).length + 1, 6);
      parts.push(`${"#".repeat(level)} ${heading}`);
      lastHeading = heading;
    }
    const text = seg.text.trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

/**
 * Build the mirror's rel path under `importedRoot()` from a path *relative to
 * the import base* (e.g. `projects/MosaicReel/SPEC.md`), preserving that folder
 * structure so Obsidian shows a recognizable — and disambiguated — tree. Each
 * segment is sanitized; the file is `<name>.md`. Any leading `..`/absolute
 * segments are dropped so the result always stays under the imported root.
 */
export function mirrorRelPath(relPath: string): string {
  const parts = relPath.split(/[\\/]/).filter((s) => s && s !== "." && s !== "..");
  const filename = parts.pop() ?? "Untitled";
  const dirSegments = parts.map((s) => sanitizeSegment(s)).filter(Boolean);
  const base =
    sanitizeSegment(filename.replace(/\.[^.]+$/, "")) || sanitizeSegment(filename) || "Untitled";
  return [...dirSegments, `${base}.md`].join("/");
}

/**
 * Write the read-only Markdown mirror for one imported doc. Returns the POSIX
 * rel path written (for the manifest). Frontmatter marks it imported + records
 * its source path so it's distinguishable from exported pages in the vault.
 */
export async function mirrorImportedDoc(input: {
  fileId: string;
  filename: string;
  /** Path recorded in frontmatter — the doc's stable source identity (absolute for folder imports). */
  sourcePath: string;
  /** Path relative to the import base, used for the vault folder layout (defaults to filename). */
  mirrorPath: string;
  segments: Segment[];
}): Promise<string> {
  const rel = mirrorRelPath(input.mirrorPath);
  const body = segmentsToMarkdown(input.segments);
  const contents = buildMarkdownFile(
    {
      id: input.fileId,
      title: input.filename.replace(/\.[^.]+$/, ""),
      imported: true,
      sourcePath: input.sourcePath,
    },
    body
  );
  await writeImportedFileAtomic(rel, contents);
  return rel;
}
