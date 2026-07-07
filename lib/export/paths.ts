/**
 * Pure path/name helpers for the vault mirror. No I/O — unit-testable.
 * Rel paths are POSIX ("/"), rooted at the export root (see config.ts).
 */

import path from "node:path";

/**
 * Turn a page/space title into one safe path segment. Strips characters that
 * are illegal on macOS (`/ \ : * ? " < > |`) or that break Obsidian wikilinks
 * (`# ^ [ ] |`), collapses whitespace, drops leading dots, and length-caps.
 * Returns "" when nothing usable remains (caller falls back to the page id).
 */
export function sanitizeSegment(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120)
    .trim();
}

/** A collision suffix looks like " (2)". Strip it to compare against the base name. */
export function stripCollisionSuffix(segment: string): string {
  return segment.replace(/ \(\d+\)$/, "");
}

/**
 * Resolve `base` to a segment not present in `taken`, appending " (2)", " (3)"…
 * The returned segment names BOTH the `<name>.md` file and the `<name>/` child
 * folder, so those two share one collision namespace.
 */
export function resolveSegment(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Join folder segments into a POSIX rel folder path. */
export function joinFolder(segments: string[]): string {
  return segments.filter(Boolean).join("/");
}

/** `<folder>/<segment>.md` — the page's own file. */
export function fileRel(folder: string, segment: string): string {
  return folder ? `${folder}/${segment}.md` : `${segment}.md`;
}

/** `<folder>/<segment>` — the child folder holding this page's descendants. */
export function childFolderRel(folder: string, segment: string): string {
  return folder ? `${folder}/${segment}` : segment;
}

/**
 * Resolve a rel path to an absolute path, asserting it stays under `root`.
 * The load-bearing guard behind the "only ever touch owned paths" invariant.
 */
export function resolveWithinRoot(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (back === ".." || back.startsWith(`..${path.sep}`) || path.isAbsolute(back)) {
    throw new Error(`export path escapes root: ${rel}`);
  }
  return abs;
}
