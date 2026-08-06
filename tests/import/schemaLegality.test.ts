/**
 * Proves the Markdown importer can only ever produce documents the REAL editor
 * accepts, and that they survive the trip to `blocks` rows and back.
 *
 * Why this exists beyond markdownToDoc.test.ts: those tests assert node shapes
 * against the spec, but a shape can match the spec and still be schema-illegal
 * (a `taskItem` holding a blockquote, a `listItem` whose first child isn't a
 * paragraph, a `toggle` missing its summary). ProseMirror rejects such content
 * at insert time, and `blocksFromDoc` -> `replacePageBlocks` sends the page's
 * rows in ONE batched upsert — so a single invalid block breaks saving for the
 * entire page, showing only a generic "Save failed". The schema here is built
 * from the same EDITOR_EXTENSIONS array Editor.tsx passes to useEditor, so it
 * cannot drift from what actually runs.
 *
 * `Node.check()` is the assertion that matters: it throws on any content that
 * violates a node's content expression or attr types.
 */

import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";

import { EDITOR_EXTENSIONS } from "@/components/editor/editorExtensions";
import { blocksFromDoc, docFromBlocks } from "@/components/editor/blockSync";
import { markdownToDoc } from "@/lib/import/markdownToDoc";
import type { Block } from "@/lib/db/types";

const schema = getSchema(EDITOR_EXTENSIONS);

/** Parse Markdown and instantiate it in the real schema, checking every node. */
function parseIntoSchema(markdown: string): PMNode {
  const { doc } = markdownToDoc(markdown);
  // Strip the transient parser-only `target` attr the way the UI does before
  // insertion (components/editor/markdownImport.ts): the PageMention schema
  // declares only pageId/label/spaceSlug.
  const stripped = JSON.parse(
    JSON.stringify(doc, (key, value) => (key === "target" ? undefined : value))
  );
  const node = PMNode.fromJSON(schema, stripped);
  node.check(); // throws on any illegal content/attrs, at any depth
  return node;
}

/** Every construct the importer supports, in one document. */
const KITCHEN_SINK = `---
title: Everything
---

# Heading one

Text with **bold**, *italic*, ~~strike~~, ==highlight==, <u>underline</u>,
\`inline code\`, a [link](https://example.com) and a [[Wiki Target|alias]].

## Lists

- bullet
  - nested bullet
- bullet two

1. one
2. two
   1. nested ordered

- [ ] todo
- [x] done

## Quotes

> plain quote
> second line

> [!note] 🔥
> callout body

> [!warning] Careful
> warning body

> [!note]+ open toggle
> open body

> [!note]- closed toggle
> closed body

## Code

\`\`\`ts
const x: number = 1; // \`backticks\` inside
\`\`\`

## Table

| a | b |
| --- | --- |
| 1 | pipe \\| here |

---

![alt text](https://example.com/i.png)

##### Level five clamps

Paragraph with a hard break
after it.
`;

describe("importer output is legal in the real editor schema", () => {
  it("accepts the kitchen-sink document", () => {
    expect(() => parseIntoSchema(KITCHEN_SINK)).not.toThrow();
  });

  it("only produces top-level node types the editor registers as blocks", () => {
    const doc = parseIntoSchema(KITCHEN_SINK);
    // Mirrors BLOCK_TYPES in components/editor/extensions/block-id.ts — the
    // types blockSync can map to a `blocks.type` value.
    const allowed = new Set([
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
    ]);
    const seen: string[] = [];
    doc.forEach((n) => seen.push(n.type.name));
    expect(seen.length).toBeGreaterThan(15);
    expect(seen.filter((t) => !allowed.has(t))).toEqual([]);
  });

  it("never emits a heading level the editor cannot render", () => {
    const doc = parseIntoSchema("# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f");
    const levels: number[] = [];
    doc.forEach((n) => {
      if (n.type.name === "heading") levels.push(n.attrs.level as number);
    });
    expect(levels).toEqual([1, 2, 3, 4, 4, 4]);
  });

  // Constructs that are legal Markdown but illegal *inside* the editor's
  // checklist/list nodes. The parser must hoist or flatten them; if it ever
  // stops, check() throws here instead of the user's page silently failing.
  it.each([
    ["nested task list", "- [ ] parent\n  - [ ] child\n"],
    ["blockquote in a checklist item", "- [ ] task\n  > quoted\n"],
    ["code block in a checklist item", "- [x] task\n\n  ```\n  code\n  ```\n"],
    ["table in a bullet item", "- item\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n"],
    ["heading in a bullet item", "- item\n\n  # heading\n"],
    ["deeply nested mixed lists", "- a\n  1. b\n     - [ ] c\n       - d\n"],
  ])("keeps the doc legal for: %s", (_label, md) => {
    expect(() => parseIntoSchema(md)).not.toThrow();
  });

  it.each([
    ["empty input", ""],
    ["frontmatter only", "---\ntitle: x\n---\n"],
    ["unclosed code fence", "```js\nlet a = 1;\n"],
    ["unclosed frontmatter", "---\ntitle: x\n"],
    ["CRLF line endings", "# a\r\n\r\n- b\r\n- c\r\n"],
    ["only a horizontal rule", "---\n\n"],
    ["table with a missing cell", "| a | b |\n| --- | --- |\n| 1 |\n"],
    ["raw html block", "<div><span>hi</span></div>\n"],
    ["image inside text", "before ![i](s.png) after\n"],
    ["stray brackets", "[[ ]] [x]( ) ** ~~ == <u>\n"],
  ])("stays legal on malformed input: %s", (_label, md) => {
    expect(() => parseIntoSchema(md)).not.toThrow();
  });
});

describe("imported content survives the blocks round-trip", () => {
  it("maps to blocks rows and rebuilds the same doc", () => {
    const doc = parseIntoSchema(KITCHEN_SINK);

    // What the editor's save path does. blocksFromDoc needs a UUID blockId on
    // every top-level node; in the app the BlockId plugin mints those on
    // insert, so stamp them here the same way.
    const withIds = PMNode.fromJSON(schema, {
      type: "doc",
      content: (doc.toJSON() as { content: Record<string, unknown>[] }).content.map(
        (n, i) => ({
          ...n,
          attrs: {
            ...((n.attrs as Record<string, unknown>) ?? {}),
            blockId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          },
        })
      ),
    });

    const inputs = blocksFromDoc(withIds);
    expect(inputs.length).toBe(withIds.childCount);

    // Every row must carry a valid blocks.type (the CHECK constraint) and a
    // position; positions must be strictly increasing in document order.
    const validTypes = new Set([
      "paragraph",
      "heading",
      "checklist_item",
      "bullet_list",
      "ordered_list",
      "table",
      "code",
      "callout",
      "toggle",
      "image",
      "file_embed",
      "divider",
      "quote",
    ]);
    for (const b of inputs) expect(validTypes.has(b.type)).toBe(true);
    const positions = inputs.map((b) => b.position);
    expect([...positions].sort()).toEqual(positions);
    expect(new Set(positions).size).toBe(positions.length);

    // Rebuild the doc from rows, exactly as the page loader does, and confirm
    // the content is unchanged — proving nothing is lost through the DB shape.
    const rows: Block[] = inputs.map((b, i) => ({
      id: b.id,
      page_id: "page",
      parent_block_id: null,
      type: b.type,
      content: b.content,
      position: b.position,
      created_at: `t${i}`,
      updated_at: `t${i}`,
    })) as Block[];

    const rebuilt = PMNode.fromJSON(schema, docFromBlocks(rows));
    rebuilt.check();
    expect(rebuilt.toJSON()).toEqual(withIds.toJSON());
  });
});
