/**
 * Shared ProseMirror-node walking primitives for the export serializers.
 *
 * `serialize.ts` (Markdown), `serializeHtml.ts` (print-to-PDF HTML), and
 * `serializeDocx.ts` (Word) are three one-way emitters over the same shape:
 * `blocks` rows whose `content` column holds a PM JSON fragment. They differ
 * only in what they emit — the walking itself (ordering rows, narrowing a
 * `Json` value to a node, reading children, flattening to text) was
 * byte-identical in all three files. It lives here now so the three emitters
 * can't silently drift apart.
 *
 * Pure/sync — no I/O, no "server-only", no browser DOM — so it unit-tests
 * headlessly, matching the constraint the serializers already hold themselves to.
 */

import type { Block, Json } from "@/lib/db/types";

export type PMMark = { type?: string; attrs?: Record<string, Json> };

export type PMNode = {
  type?: string;
  attrs?: Record<string, Json>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
};

/**
 * Order block rows by their fractional-index `position` key.
 *
 * Compared as strings, deliberately: `position` columns are `COLLATE "C"`
 * fractional-index keys (see `lib/positions.ts`), not numbers.
 */
export function byPosition(a: Block, b: Block): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/** Narrow an untrusted `Json` value to a PM node, or null if it isn't one. */
export function asNode(value: Json): PMNode | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const n = value as PMNode;
  return typeof n.type === "string" ? n : null;
}

/** A node's child nodes, or `[]` for a leaf. */
export function childNodes(node: PMNode): PMNode[] {
  return Array.isArray(node.content) ? node.content.filter((c): c is PMNode => !!c) : [];
}

/** Flatten a node's entire subtree to plain text, dropping all marks and structure. */
export function collectText(node: PMNode): string {
  if (node.type === "text") return node.text ?? "";
  return childNodes(node).map(collectText).join("");
}
