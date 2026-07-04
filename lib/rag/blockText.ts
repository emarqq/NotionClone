/**
 * Extracts RAG segments from a page's block rows. Pure/sync — no I/O, safe
 * to unit-test without "server-only". See components/editor/blockSync.ts:
 * each block row's `content` is a FULL top-level ProseMirror node (nested
 * children — table rows, task items, toggle bodies — live inside that same
 * JSON, not as separate block rows), so this walker recurses into `content`.
 */

import type { Block, Json } from "@/lib/db/types";
import type { Segment } from "@/lib/rag/chunker";

/** Byte/code-unit order, matching the fractional-index key scheme (see lib/db/pages.ts). */
function byPosition(a: Block, b: Block): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

type PMNode = { type?: string; attrs?: Record<string, Json>; content?: PMNode[]; text?: string };

function asNode(value: Json): PMNode | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as PMNode;
}

function childNodes(node: PMNode): PMNode[] {
  return Array.isArray(node.content) ? node.content.filter((c): c is PMNode => !!c) : [];
}

/** True when every child is inline (text/hardBreak) — join directly, no separator. */
function isInlineRun(children: PMNode[]): boolean {
  return (
    children.length > 0 &&
    children.every((c) => c.type === "text" || c.type === "hardBreak")
  );
}

/**
 * Recursively extracts plain text from a ProseMirror JSON node.
 * - checklist items (`taskItem`): prefixed `[x] ` / `[ ] ` from `attrs.checked`.
 * - tables: rows as tab-separated lines.
 * - code blocks: text kept verbatim (no reflowing).
 * - toggles: summary line followed by its children's text.
 * - everything else: inline runs are concatenated directly; block containers
 *   join children with newlines.
 */
function extractText(node: PMNode): string {
  const type = node.type;
  const children = childNodes(node);

  if (type === "text") return node.text ?? "";
  if (type === "hardBreak") return "\n";

  if (type === "taskItem") {
    const checked = node.attrs?.checked === true;
    const inner = children.map(extractText).join("").trim();
    return `${checked ? "[x]" : "[ ]"} ${inner}`.trimEnd();
  }
  if (type === "taskList") {
    return children.map(extractText).filter(Boolean).join("\n");
  }

  if (type === "tableRow") {
    return children.map(extractText).join("\t");
  }
  if (type === "tableCell" || type === "tableHeader") {
    return children.map(extractText).join(" ").trim();
  }
  if (type === "table") {
    return children.map(extractText).filter(Boolean).join("\n");
  }

  if (type === "codeBlock") {
    return children.map((c) => (c.type === "text" ? c.text ?? "" : extractText(c))).join("");
  }

  if (type === "toggleSummary") {
    return children.map(extractText).join("").trim();
  }
  if (type === "toggleContent") {
    return children.map(extractText).filter(Boolean).join("\n");
  }
  if (type === "toggle") {
    return children.map(extractText).filter(Boolean).join("\n");
  }

  // Generic fallback for paragraph, heading, blockquote/quote, bulletList,
  // orderedList, listItem, callout, and anything unrecognized: inline runs
  // are joined directly, block-ish containers join children with newlines.
  const parts = children.map(extractText);
  return isInlineRun(children) ? parts.join("") : parts.filter(Boolean).join("\n");
}

interface HeadingFrame {
  level: number;
  text: string;
  /** True for a leading heading that just repeats the page title (see below). */
  redundant: boolean;
}

/**
 * Walks position-ordered block rows into flat text segments, tracking a
 * heading stack (by `attrs.level`) to build each segment's `headingPath`.
 *
 * `pageTitle` is used to collapse a leading heading that merely repeats the
 * page title (a common authoring pattern — the doc's first H1 restating the
 * sidebar title): that heading is tracked for level bookkeeping but excluded
 * from `headingPath` and does not get its own segment, so it doesn't
 * duplicate the page title that `lib/rag/ingest.ts`'s breadcrumb already
 * carries (breadcrumb = "Space > ancestors > page title").
 */
export function segmentsFromBlocks(blocks: Block[], pageTitle: string): Segment[] {
  const ordered = blocks.slice().sort(byPosition);
  const segments: Segment[] = [];
  const stack: HeadingFrame[] = [];
  const normalizedTitle = pageTitle.trim().toLowerCase();

  const visiblePath = () => stack.filter((f) => !f.redundant).map((f) => f.text);

  for (const block of ordered) {
    const node = asNode(block.content);
    if (!node) continue;

    if (block.type === "heading") {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      const headingText = childNodes(node).map(extractText).join("").trim();
      const redundant =
        stack.length === 0 &&
        normalizedTitle.length > 0 &&
        headingText.toLowerCase() === normalizedTitle;

      if (headingText) {
        stack.push({ level, text: headingText, redundant });
        if (!redundant) segments.push({ headingPath: visiblePath(), text: headingText });
      } else {
        // Keep the stack coherent even for an empty heading node.
        stack.push({ level, text: "", redundant: true });
      }
      continue;
    }

    const text = extractText(node).trim();
    if (!text) continue;
    segments.push({ headingPath: visiblePath(), text });
  }

  return segments;
}
