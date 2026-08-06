/**
 * Where an import lands. `resolveInsertTarget` decides between a plain position
 * (insert) and a range (replace), against the real editor schema.
 *
 * The two rules worth guarding: appending must consume a page's trailing empty
 * paragraph (every page has one, and a brand-new page is nothing else — leaving
 * it would push the whole file down one block), and inserting at the caret must
 * never split the enclosing block. A wrong position here doesn't error, it just
 * silently puts imported content in the wrong place or shreds a list.
 */

import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";

import { EDITOR_EXTENSIONS } from "@/components/editor/editorExtensions";
import { resolveInsertTarget } from "@/components/editor/markdownImport";

const schema = getSchema(EDITOR_EXTENSIONS);

const doc = (...content: unknown[]) =>
  PMNode.fromJSON(schema, { type: "doc", content });

const para = (text?: string) => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const bulletList = (...items: string[]) => ({
  type: "bulletList",
  content: items.map((t) => ({ type: "listItem", content: [para(t)] })),
});

describe("resolveInsertTarget — append to end", () => {
  it("replaces a lone trailing empty paragraph (empty page)", () => {
    const d = doc(para());
    // The whole doc is that paragraph: replacing 0..size means the import
    // becomes the entire page rather than starting on block 2.
    expect(resolveInsertTarget(d, 0, "end")).toEqual({ from: 0, to: d.content.size });
  });

  it("replaces the trailing empty paragraph after real content", () => {
    const d = doc(heading("Title"), para("body"), para());
    const target = resolveInsertTarget(d, 0, "end") as { from: number; to: number };
    expect(target.to).toBe(d.content.size);
    // The replaced range must be exactly the last node, nothing more.
    expect(d.content.size - target.from).toBe(d.lastChild!.nodeSize);
    expect(d.resolve(target.from).nodeAfter!.type.name).toBe("paragraph");
    expect(d.resolve(target.from).nodeAfter!.content.size).toBe(0);
  });

  it("appends at the very end when the last block is not an empty paragraph", () => {
    const d = doc(heading("Title"), para("body"));
    expect(resolveInsertTarget(d, 0, "end")).toBe(d.content.size);
  });

  it("does not treat a non-empty last paragraph as disposable", () => {
    const d = doc(para("keep me"));
    expect(resolveInsertTarget(d, 0, "end")).toBe(d.content.size);
  });

  it("appends after a trailing list rather than into it", () => {
    const d = doc(para("intro"), bulletList("a", "b"));
    expect(resolveInsertTarget(d, 0, "end")).toBe(d.content.size);
  });
});

describe("resolveInsertTarget — at the caret", () => {
  it("replaces the empty paragraph the slash command was typed on", () => {
    const d = doc(heading("Title"), para());
    const caret = d.content.size - 1; // inside the empty paragraph
    const target = resolveInsertTarget(d, caret, "cursor") as {
      from: number;
      to: number;
    };
    expect(d.resolve(target.from).nodeAfter!.type.name).toBe("paragraph");
    expect(target.to - target.from).toBe(d.lastChild!.nodeSize);
  });

  it("inserts after the current paragraph instead of splitting it", () => {
    const d = doc(para("hello world"), para("second"));
    const caret = 6; // mid-word in the first paragraph
    const target = resolveInsertTarget(d, caret, "cursor");
    // 0..firstNode.nodeSize is the end of the first paragraph.
    expect(target).toBe(d.firstChild!.nodeSize);
  });

  it("inserts after the whole list when the caret is inside a list item", () => {
    const d = doc(bulletList("alpha", "beta"), para("after"));
    const list = d.firstChild!;
    const caret = 4; // inside "alpha", depth > 1
    // Must be the position after the ENTIRE list, never inside it: splitting a
    // list around imported blocks would be schema-valid but nonsense.
    expect(resolveInsertTarget(d, caret, "cursor")).toBe(list.nodeSize);
  });

  it("inserts after the whole table when the caret is in a cell", () => {
    const d = doc({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [para("h")] },
            { type: "tableHeader", content: [para("i")] },
          ],
        },
      ],
    });
    const caret = 5; // inside a header cell
    expect(resolveInsertTarget(d, caret, "cursor")).toBe(d.firstChild!.nodeSize);
  });

  it("clamps an out-of-range caret instead of throwing", () => {
    const d = doc(para("x"));
    expect(() => resolveInsertTarget(d, 9999, "cursor")).not.toThrow();
    expect(() => resolveInsertTarget(d, -5, "cursor")).not.toThrow();
  });
});
