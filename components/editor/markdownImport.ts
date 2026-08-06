"use client";

/**
 * Markdown file → blocks on the current page.
 *
 * Deliberately client-side and routed through an editor transaction rather than
 * a server action that writes rows directly. Three things fall out of that for
 * free, all of which a server-side importer would have had to reimplement:
 *
 *  - `BlockId`'s appendTransaction mints a UUID `blockId` for every inserted
 *    top-level node. A row id that isn't a UUID breaks the page's batched
 *    upsert *as a whole* (see extensions/block-id.ts), so this is not a detail.
 *  - The editor's normal debounced save persists the insert, which means one
 *    save path, fractional positions from `blocksFromDoc`, and the usual
 *    post-save hooks (RAG re-index, link sync, vault export) all still fire.
 *  - Nothing is written until the insert lands in the doc, so Cmd-Z undoes an
 *    import like any other edit.
 *
 * `markdownToDoc` is pure and framework-free; everything browser-specific
 * (file picker, /api/pages lookup, editor commands) lives here.
 */

import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

import { markdownToDoc } from "@/lib/import/markdownToDoc";
import { useImportStore } from "./importStore";

const ACCEPT = ".md,.markdown,.mdown,.markdn,.mkd,.txt,text/markdown,text/plain";

/** 5 MB. A markdown file past this is not a page, and parsing it would jank the UI. */
const MAX_BYTES = 5 * 1024 * 1024;

export interface ImportOutcome {
  fileName: string;
  /** Top-level blocks inserted. */
  blockCount: number;
  /** Lossy-conversion notes from the parser (heading clamps, flattened nesting…). */
  warnings: string[];
  /** `[[wikilinks]]` matched to a real page and turned into live mentions. */
  resolvedMentions: number;
  /** `[[wikilinks]]` with no matching page — left as plain text. */
  unresolvedMentions: string[];
}

/** Where the parsed blocks go: at the cursor, or appended to the end of the page. */
export type ImportPlacement = "cursor" | "end";

export interface PageOption {
  id: string;
  title: string;
  spaceSlug: string;
}

/**
 * Opens a native file picker. Resolves null when the user cancels.
 *
 * The input is created detached rather than rendered into the tree: both entry
 * points (slash menu, page ⋯ menu) unmount themselves the moment they're
 * activated, which would tear a rendered input out mid-dialog.
 */
export function pickMarkdownFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.style.display = "none";
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    // Fires on dismissal in Chromium/Electron. Without it a cancelled dialog
    // would leave this promise (and the "Importing…" status) pending forever.
    input.addEventListener("cancel", () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/** Fetch the page list once, for `[[wikilink]]` → pageMention resolution. */
async function loadPages(): Promise<PageOption[]> {
  try {
    const res = await fetch("/api/pages");
    if (!res.ok) return [];
    const data = (await res.json()) as { pages?: PageOption[] };
    return data.pages ?? [];
  } catch {
    return []; // Resolution is best-effort: unresolved links degrade to text.
  }
}

/**
 * Replaces every `pageMention` placeholder the parser emitted (pageId: null)
 * with either a live mention or plain `[[label]]` text.
 *
 * An unresolved mention MUST NOT stay a pageMention node: it's an inline atom
 * whose href would be "#", it would render as a dead link, and the backlink
 * extractor keys off pageId. Text is the honest representation.
 */
export function resolveMentions(
  nodes: JSONContent[],
  pages: PageOption[],
  stats: { resolved: number; unresolved: string[] }
): JSONContent[] {
  // Exact title first, case-insensitive as a fallback; first match wins.
  const byTitle = new Map<string, PageOption>();
  const byLowerTitle = new Map<string, PageOption>();
  for (const p of pages) {
    if (!byTitle.has(p.title)) byTitle.set(p.title, p);
    const lower = p.title.toLowerCase();
    if (!byLowerTitle.has(lower)) byLowerTitle.set(lower, p);
  }

  const walk = (list: JSONContent[]): JSONContent[] =>
    list.map((node) => {
      if (node.type === "pageMention") {
        const label = String(node.attrs?.label ?? "").trim();
        const target = String(node.attrs?.target ?? label).trim();
        const hit =
          byTitle.get(target) ??
          byLowerTitle.get(target.toLowerCase()) ??
          byTitle.get(label) ??
          byLowerTitle.get(label.toLowerCase());
        if (hit) {
          stats.resolved += 1;
          return {
            type: "pageMention",
            attrs: { pageId: hit.id, label: label || hit.title, spaceSlug: hit.spaceSlug },
          };
        }
        stats.unresolved.push(target || label);
        return { type: "text", text: `[[${label || target}]]` };
      }
      return node.content ? { ...node, content: walk(node.content) } : node;
    });

  return walk(nodes);
}

/**
 * Inserts top-level blocks, returning the number inserted.
 *
 * "cursor" never splits the block the caret sits in: it replaces it when it's
 * an empty paragraph (the usual case — the slash menu just deleted "/import"
 * from an otherwise empty line, and leaving that stray empty block behind
 * would be sloppy), and otherwise inserts *after* the enclosing top-level
 * node. Splitting a list item or table cell around imported content would
 * produce a schema-valid but nonsensical page.
 */
export function resolveInsertTarget(
  doc: PMNode,
  selectionFrom: number,
  placement: ImportPlacement
): number | { from: number; to: number } {
  const docEnd = doc.content.size;

  if (placement === "end") {
    // Pages almost always end with a trailing empty paragraph (and a brand-new
    // page is nothing but one). Appending after it would leave a blank block
    // wedged between the old content and the import, and on an empty page the
    // whole file would start on line 2. Consume it instead.
    const last = doc.lastChild;
    if (last && last.type.name === "paragraph" && last.content.size === 0) {
      return { from: docEnd - last.nodeSize, to: docEnd };
    }
    return docEnd;
  }

  const $from = doc.resolve(Math.min(Math.max(selectionFrom, 0), docEnd));
  if ($from.depth < 1) return docEnd;
  const top = $from.node(1);
  return top.type.name === "paragraph" && top.content.size === 0
    ? { from: $from.before(1), to: $from.after(1) }
    : $from.after(1);
}

function insertBlocks(
  editor: Editor,
  content: JSONContent[],
  placement: ImportPlacement
): number {
  if (content.length === 0) return 0;
  const target = resolveInsertTarget(
    editor.state.doc,
    editor.state.selection.from,
    placement
  );
  editor.chain().focus().insertContentAt(target, content).run();
  return content.length;
}

/**
 * Full flow: pick a file → parse → resolve wikilinks → insert.
 * Returns null if the user cancelled. Throws with a user-facing message on a
 * file that can't be read or parsed.
 */
export async function importMarkdownIntoEditor(
  editor: Editor,
  placement: ImportPlacement,
  onProgress?: (fileName: string) => void
): Promise<ImportOutcome | null> {
  const file = await pickMarkdownFile();
  if (!file) return null;

  if (file.size > MAX_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — too large to import (limit 5 MB).`
    );
  }
  onProgress?.(file.name);

  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error(`Could not read "${file.name}".`);
  }

  const parsed = markdownToDoc(text);
  let content = parsed.doc.content ?? [];
  if (content.length === 0) {
    throw new Error(`"${file.name}" has no importable content.`);
  }

  const stats = { resolved: 0, unresolved: [] as string[] };
  if (parsed.wikilinks.length > 0) {
    content = resolveMentions(content, await loadPages(), stats);
  }

  // The editor can be torn down while the picker/fetch was open (navigation).
  if (editor.isDestroyed) return null;

  const blockCount = insertBlocks(editor, content, placement);

  return {
    fileName: file.name,
    blockCount,
    warnings: parsed.warnings,
    resolvedMentions: stats.resolved,
    unresolvedMentions: Array.from(new Set(stats.unresolved)),
  };
}

/**
 * The entry points' single call: runs the import and reports every outcome
 * through the status banner. Never throws — a rejected promise from a menu
 * click handler would be an unhandled rejection with no user-visible signal.
 */
export async function runMarkdownImport(
  editor: Editor,
  placement: ImportPlacement
): Promise<void> {
  const { setStatus } = useImportStore.getState();
  try {
    const outcome = await importMarkdownIntoEditor(editor, placement, (fileName) =>
      setStatus({ kind: "importing", fileName })
    );
    // Cancelled picker (or an editor torn down mid-pick): no banner at all.
    setStatus(outcome ? { kind: "done", outcome } : null);
  } catch (err) {
    setStatus({
      kind: "error",
      message: err instanceof Error ? err.message : "Import failed.",
    });
  }
}
