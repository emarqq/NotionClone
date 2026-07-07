/**
 * Extracts page→page link targets from a page's block rows. Pure/sync — no
 * I/O, no "server-only" — so it's unit-testable, mirroring lib/rag/blockText.ts.
 * Each block row's `content` is a FULL top-level ProseMirror node; mentions
 * and link marks live nested inside that JSON, so this walker recurses into
 * `content` and pairs each hit with its containing block row's `id`.
 *
 * Two sources of a link (the decision the plan locked in):
 *  1. a `pageMention` atom → its `attrs.pageId`;
 *  2. a text node carrying a `link` mark whose href is an INTERNAL page path
 *     (`/{slug}/{uuid}`) → the captured pageId. Pure external URLs stay as
 *     `<a>` marks and are never tracked.
 */

import type { Json } from "@/lib/db/types";

export interface LinkTarget {
  sourceBlockId: string;
  targetPageId: string;
}

type PMMark = { type?: string; attrs?: Record<string, Json> };
type PMNode = {
  type?: string;
  attrs?: Record<string, Json>;
  marks?: PMMark[];
  content?: PMNode[];
  text?: string;
};

/** `/{slug}/{uuid}` — capture the 36-char UUID page id; ignore anything after it. */
const INTERNAL_HREF_RE = /^\/[^/]+\/([0-9a-fA-F-]{36})(?:[/?#]|$)/;

function asNode(value: Json): PMNode | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as PMNode;
}

function collect(node: PMNode, sourceBlockId: string, out: LinkTarget[]): void {
  if (node.type === "pageMention") {
    const pageId = node.attrs?.pageId;
    if (typeof pageId === "string" && pageId) {
      out.push({ sourceBlockId, targetPageId: pageId });
    }
  }

  if (node.type === "text" && Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (mark?.type !== "link") continue;
      const href = mark.attrs?.href;
      if (typeof href !== "string") continue;
      const match = INTERNAL_HREF_RE.exec(href);
      if (match) out.push({ sourceBlockId, targetPageId: match[1] });
    }
  }

  for (const child of node.content ?? []) {
    if (child) collect(child, sourceBlockId, out);
  }
}

export function extractLinkTargets(
  blocks: { id: string; content: Json }[],
  selfPageId: string
): LinkTarget[] {
  const raw: LinkTarget[] = [];
  for (const block of blocks) {
    const node = asNode(block.content);
    if (node) collect(node, block.id, raw);
  }

  // Dedupe by (sourceBlockId, targetPageId) — matches the links table's unique
  // constraint — and drop self-links.
  const seen = new Set<string>();
  const result: LinkTarget[] = [];
  for (const target of raw) {
    if (target.targetPageId === selfPageId) continue;
    const key = `${target.sourceBlockId}::${target.targetPageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}
