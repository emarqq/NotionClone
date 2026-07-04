import { generateKeyBetween } from "@/lib/positions";
import type { Block, BlockType, Json } from "@/lib/db/types";
import type { BlockInput } from "@/lib/db/blocks";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

/** Top-level ProseMirror node type → blocks.type column value. */
export const NODE_TYPE_TO_BLOCK_TYPE: Record<string, BlockType> = {
  heading: "heading",
  bulletList: "bullet_list",
  orderedList: "ordered_list",
  taskList: "checklist_item",
  table: "table",
  codeBlock: "code",
  blockquote: "quote",
  horizontalRule: "divider",
  image: "image",
  callout: "callout",
  toggle: "toggle",
};

export function blockTypeForNode(nodeTypeName: string): BlockType {
  return NODE_TYPE_TO_BLOCK_TYPE[nodeTypeName] ?? "paragraph";
}

/** Node types the editor schema understands (used to skip foreign rows on load). */
const EDITOR_NODE_TYPES = new Set([
  "paragraph",
  ...Object.keys(NODE_TYPE_TO_BLOCK_TYPE),
]);

const EMPTY_PARAGRAPH: JSONContent = { type: "paragraph" };

/**
 * Builds the initial ProseMirror doc JSON from position-ordered block rows.
 * Each row's `content` is a full top-level node JSON. Rows whose content is
 * not a known node type (e.g. file_embed) are skipped. Empty page → one
 * empty paragraph.
 */
export function docFromBlocks(rows: Block[]): JSONContent {
  const content = rows
    .map((r) => r.content)
    .filter(
      (c): c is Exclude<Json, null> & JSONContent =>
        typeof c === "object" &&
        c !== null &&
        !Array.isArray(c) &&
        typeof c.type === "string" &&
        EDITOR_NODE_TYPES.has(c.type)
    );
  return {
    type: "doc",
    content: content.length > 0 ? content : [EMPTY_PARAGRAPH],
  };
}

/**
 * Walks the doc's top-level nodes into BlockInput rows. Position keys are
 * regenerated as a deterministic sequential chain (a0, a1, …), so unchanged
 * ordering writes identical values on every save.
 */
export function blocksFromDoc(doc: PMNode): BlockInput[] {
  const blocks: BlockInput[] = [];
  let prev: string | null = null;
  doc.forEach((node) => {
    const position = generateKeyBetween(prev, null);
    prev = position;
    blocks.push({
      id:
        typeof node.attrs.blockId === "string" && node.attrs.blockId
          ? node.attrs.blockId
          : crypto.randomUUID(),
      type: blockTypeForNode(node.type.name),
      content: node.toJSON() as Json,
      position,
    });
  });
  return blocks;
}
