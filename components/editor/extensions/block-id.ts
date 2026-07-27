import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

/** Node types that can appear at the top level of the doc. */
const BLOCK_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "codeBlock",
  "blockquote",
  "horizontalRule",
  "image",
  "callout",
  "toggle",
];

/**
 * `blocks.id` is a Postgres `uuid` column, and blocksFromDoc() uses a node's
 * blockId verbatim as that primary key. A `data-block-id` that isn't a UUID
 * therefore makes the page's single batched upsert fail *as a whole* — so one
 * pasted block from an external editor silently breaks saving for EVERY block
 * on the page, indefinitely, until that block is deleted (the UI only shows a
 * generic "Save failed"). Anything not matching this is treated as absent, so
 * appendTransaction below mints a fresh id instead.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global `blockId` attribute (rendered as data-block-id) on all block node
 * types, plus a plugin that assigns crypto.randomUUID() to any TOP-LEVEL node
 * that is missing one or duplicates another (e.g. after a split or paste),
 * via an appended transaction.
 */
export const BlockId = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => {
              const id = element.getAttribute("data-block-id");
              return id && UUID_RE.test(id) ? id : null;
            },
            renderHTML: (attributes) =>
              attributes.blockId
                ? { "data-block-id": attributes.blockId }
                : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockIdAssign"),
        appendTransaction: (_transactions, _oldState, newState) => {
          let tr: Transaction | null = null;
          const seen = new Set<string>();
          newState.doc.forEach((node, offset) => {
            // Only touch node types that declare the attribute.
            if (!node.type.spec.attrs || !("blockId" in node.type.spec.attrs)) {
              return;
            }
            const id = node.attrs.blockId as string | null;
            if (!id || seen.has(id)) {
              tr = tr ?? newState.tr;
              tr.setNodeMarkup(offset, undefined, {
                ...node.attrs,
                blockId: crypto.randomUUID(),
              });
            } else {
              seen.add(id);
            }
          });
          if (tr) (tr as Transaction).setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});
