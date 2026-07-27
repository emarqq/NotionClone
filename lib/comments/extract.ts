/**
 * Extracts comment-thread anchors from a page's block rows. Pure/sync — no I/O,
 * no "server-only" — so it's unit-testable, mirroring lib/links/extract.ts.
 * Each block row's `content` is a FULL top-level ProseMirror node; a comment
 * anchor is a `comment` mark (carrying a `threadId`) on a text node nested in
 * that JSON, so this walker recurses into `content` and pairs each thread id
 * with its containing block row's `id`.
 *
 * A thread should live in exactly one block; if its marked text ever spans two
 * blocks (e.g. mid-edit), the first block encountered wins — dedupe is by
 * `threadId`, matching how reconcile treats a thread as anchored to one block.
 */

import type { Json } from "@/lib/db/types";

export interface CommentAnchor {
  threadId: string;
  blockId: string;
}

type PMMark = { type?: string; attrs?: Record<string, Json> };
type PMNode = {
  type?: string;
  attrs?: Record<string, Json>;
  marks?: PMMark[];
  content?: PMNode[];
  text?: string;
};

function asNode(value: Json): PMNode | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as PMNode;
}

function collect(node: PMNode, blockId: string, out: CommentAnchor[]): void {
  if (node.type === "text" && Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (mark?.type !== "comment") continue;
      const threadId = mark.attrs?.threadId;
      if (typeof threadId === "string" && threadId) {
        out.push({ threadId, blockId });
      }
    }
  }

  for (const child of node.content ?? []) {
    if (child) collect(child, blockId, out);
  }
}

export function extractCommentAnchors(
  blocks: { id: string; content: Json }[]
): CommentAnchor[] {
  const raw: CommentAnchor[] = [];
  for (const block of blocks) {
    const node = asNode(block.content);
    if (node) collect(node, block.id, raw);
  }

  // Dedupe by threadId — a thread maps to a single anchor block.
  const seen = new Set<string>();
  const result: CommentAnchor[] = [];
  for (const anchor of raw) {
    if (seen.has(anchor.threadId)) continue;
    seen.add(anchor.threadId);
    result.push(anchor);
  }
  return result;
}
