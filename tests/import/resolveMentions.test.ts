/**
 * `[[wikilink]]` → live page mention resolution, and the fallback when no page
 * matches.
 *
 * The fallback is the point: an unresolved mention must NOT stay a pageMention
 * node. It's an inline atom whose href would render as "#", and the backlink
 * extractor (lib/links/extract.ts) keys off pageId — so a null-id mention would
 * be a dead link that also pollutes the link graph. Plain text is the honest
 * representation, and the importer reports which ones it couldn't match.
 */

import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";

import { EDITOR_EXTENSIONS } from "@/components/editor/editorExtensions";
import { resolveMentions, type PageOption } from "@/components/editor/markdownImport";
import { markdownToDoc } from "@/lib/import/markdownToDoc";

const schema = getSchema(EDITOR_EXTENSIONS);

const PAGES: PageOption[] = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Accounting Notes", spaceSlug: "school" },
  { id: "22222222-2222-4222-8222-222222222222", title: "Budget", spaceSlug: "work" },
  { id: "33333333-3333-4333-8333-333333333333", title: "Budget", spaceSlug: "personal" },
];

const newStats = () => ({ resolved: 0, unresolved: [] as string[] });

/** Parse markdown, then resolve, mirroring what the import flow does. */
function run(markdown: string, pages: PageOption[] = PAGES) {
  const parsed = markdownToDoc(markdown);
  const stats = newStats();
  const content = resolveMentions(parsed.doc.content ?? [], pages, stats);
  return { content, stats, wikilinks: parsed.wikilinks };
}

/** All pageMention nodes at any depth. */
function mentions(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (list: JSONContent[]) => {
    for (const n of list) {
      if (n.type === "pageMention") out.push(n);
      if (n.content) walk(n.content);
    }
  };
  walk(nodes);
  return out;
}

function allText(nodes: JSONContent[]): string {
  let s = "";
  const walk = (list: JSONContent[]) => {
    for (const n of list) {
      if (n.type === "text") s += n.text ?? "";
      if (n.content) walk(n.content);
    }
  };
  walk(nodes);
  return s;
}

describe("resolveMentions", () => {
  it("resolves a plain wikilink to a live mention", () => {
    const { content, stats } = run("See [[Accounting Notes]] for details.");
    const m = mentions(content);
    expect(m).toHaveLength(1);
    expect(m[0].attrs).toEqual({
      pageId: "11111111-1111-4111-8111-111111111111",
      label: "Accounting Notes",
      spaceSlug: "school",
    });
    expect(stats).toEqual({ resolved: 1, unresolved: [] });
  });

  it("resolves an aliased wikilink by TARGET but keeps the alias as the label", () => {
    // The whole reason the parser carries a transient `target` attr: matching on
    // the display label would fail for every aliased link.
    const { content, stats } = run("See [[Accounting Notes|my notes]].");
    const m = mentions(content);
    expect(m).toHaveLength(1);
    expect(m[0].attrs?.pageId).toBe("11111111-1111-4111-8111-111111111111");
    expect(m[0].attrs?.label).toBe("my notes");
    expect(stats.resolved).toBe(1);
  });

  it("matches case-insensitively as a fallback", () => {
    const { content, stats } = run("See [[accounting NOTES]].");
    expect(mentions(content)[0].attrs?.pageId).toBe("11111111-1111-4111-8111-111111111111");
    expect(stats.resolved).toBe(1);
  });

  it("turns an unmatched wikilink into plain text, not a dead mention", () => {
    const { content, stats } = run("See [[No Such Page]].");
    expect(mentions(content)).toHaveLength(0);
    expect(allText(content)).toContain("[[No Such Page]]");
    expect(stats.unresolved).toEqual(["No Such Page"]);
    expect(stats.resolved).toBe(0);
  });

  it("keeps the alias in the text fallback", () => {
    const { content } = run("See [[Missing Target|pretty name]].");
    expect(allText(content)).toContain("[[pretty name]]");
  });

  it("resolves every mention with no pages available (all become text)", () => {
    const { content, stats } = run("[[Accounting Notes]] and [[Budget]]", []);
    expect(mentions(content)).toHaveLength(0);
    expect(stats.unresolved).toEqual(["Accounting Notes", "Budget"]);
  });

  it("picks the first match deterministically for duplicate titles", () => {
    const { content } = run("[[Budget]]");
    // Two pages are titled "Budget"; first in the list wins, every time.
    expect(mentions(content)[0].attrs?.pageId).toBe("22222222-2222-4222-8222-222222222222");
    expect(mentions(content)[0].attrs?.spaceSlug).toBe("work");
  });

  it("resolves mentions nested inside lists, callouts, toggles and tables", () => {
    const md = [
      "- item with [[Accounting Notes]]",
      "",
      "> [!note] 💡",
      "> callout with [[Budget]]",
      "",
      "> [!note]+ toggle [[Accounting Notes]]",
      "> body with [[Budget]]",
      "",
      "| a | b |",
      "| --- | --- |",
      "| [[Accounting Notes]] | x |",
    ].join("\n");
    const { content, stats } = run(md);
    expect(stats.resolved).toBe(5);
    expect(stats.unresolved).toEqual([]);
    for (const m of mentions(content)) expect(m.attrs?.pageId).toBeTruthy();
  });

  it("strips the transient target attr so the result is schema-legal", () => {
    const { content } = run("See [[Accounting Notes]] and [[Nope]].");
    for (const m of mentions(content)) {
      expect(Object.keys(m.attrs ?? {}).sort()).toEqual(["label", "pageId", "spaceSlug"]);
    }
    // The real proof: the editor schema accepts the resolved doc as-is.
    const node = PMNode.fromJSON(schema, { type: "doc", content });
    expect(() => node.check()).not.toThrow();
  });

  it("reports each unresolved target once even when repeated", () => {
    const { content, stats } = run("[[Ghost]] then [[Ghost]] again");
    expect(mentions(content)).toHaveLength(0);
    // resolveMentions records every occurrence; the caller dedupes for display.
    expect(new Set(stats.unresolved)).toEqual(new Set(["Ghost"]));
  });
});
