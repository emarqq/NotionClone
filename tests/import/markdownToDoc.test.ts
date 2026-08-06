import { describe, expect, it } from "vitest";
import type { Block, Json } from "@/lib/db/types";
import { serializeBlocksToMarkdown } from "@/lib/export/serialize";
import { markdownToDoc } from "@/lib/import/markdownToDoc";

/**
 * Covers lib/import/markdownToDoc.ts, the inverse of lib/export/serialize.ts.
 *
 * Three layers, per the plan: (1) one unit test per block/inline construct,
 * (2) round-trips through serializeBlocksToMarkdown — the strongest proof,
 * since it exercises this file against markdown the *other* hand-rolled
 * parser in this repo actually produces, not markdown I imagined it would —
 * and (3) the edge cases called out in the task (empty input, unclosed
 * fences, CRLF, etc).
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function block(partial: Partial<Block> & { position: string; content: Json }): Block {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    page_id: "11111111-1111-4111-8111-111111111111",
    parent_block_id: null,
    type: "paragraph",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...partial,
  } as Block;
}

const noResolve = { resolveWikilink: () => null };

/**
 * Normalizes a JSONContent (sub)tree for structural comparison: drops the
 * blockId attr (the importer deliberately never sets it — BlockId mints its
 * own), treats an omitted `content`/`marks` the same as an empty one, and
 * sorts marks by type so mark-application order doesn't matter.
 */
function norm(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(norm);
  if (node === null || typeof node !== "object") return node;
  const n = node as Record<string, unknown>;
  const out: Record<string, unknown> = { type: n.type };
  if (n.attrs && typeof n.attrs === "object") {
    const { blockId, ...rest } = n.attrs as Record<string, unknown>;
    void blockId;
    if (Object.keys(rest).length > 0) out.attrs = rest;
  }
  if (typeof n.text === "string") out.text = n.text;
  if (Array.isArray(n.marks) && n.marks.length > 0) {
    out.marks = (n.marks as Array<Record<string, unknown>>)
      .map((m) => (m.attrs ? { type: m.type, attrs: m.attrs } : { type: m.type }))
      .sort((a, b) => String(a.type).localeCompare(String(b.type)));
  }
  if (Array.isArray(n.content) && n.content.length > 0) out.content = (n.content as unknown[]).map(norm);
  return out;
}

function normEqual(actual: unknown, expected: unknown) {
  expect(norm(actual)).toEqual(norm(expected));
}

// ---------------------------------------------------------------------------
// 1. Per-construct unit tests
// ---------------------------------------------------------------------------

describe("frontmatter", () => {
  it("strips a leading --- fence and parses simple key: value lines", () => {
    const r = markdownToDoc('---\ntitle: My Page\ntags: work\n---\nBody text\n');
    expect(r.frontmatter).toEqual({ title: "My Page", tags: "work" });
    normEqual(r.doc.content, [{ type: "paragraph", content: [{ type: "text", text: "Body text" }] }]);
  });

  it("strips surrounding quotes from a value", () => {
    const r = markdownToDoc('---\ntitle: "Quoted Title"\n---\n');
    expect(r.frontmatter.title).toBe("Quoted Title");
  });

  it("ignores a nested/complex YAML line gracefully instead of throwing", () => {
    const r = markdownToDoc("---\ntitle: OK\ntags:\n  - a\n  - b\n---\nBody\n");
    expect(r.frontmatter).toEqual({ title: "OK" });
    normEqual(r.doc.content, [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }]);
  });

  it("uses frontmatter.title over a leading H1 for the resolved title", () => {
    const r = markdownToDoc("---\ntitle: From Frontmatter\n---\n# From Heading\n");
    expect(r.title).toBe("From Frontmatter");
  });

  it("falls back to a leading H1 when there is no frontmatter title, and never removes it from the doc", () => {
    const r = markdownToDoc("# The Title\n\nBody\n");
    expect(r.title).toBe("The Title");
    expect(r.doc.content?.[0]).toMatchObject({ type: "heading", attrs: { level: 1 } });
  });

  it("returns null title when there is neither", () => {
    const r = markdownToDoc("Just a paragraph.\n");
    expect(r.title).toBeNull();
  });
});

describe("headings", () => {
  it("parses ATX headings 1-4 as-is", () => {
    const r = markdownToDoc("# H1\n\n## H2\n\n### H3\n\n#### H4\n");
    expect(r.doc.content?.map((n) => (n as { attrs?: { level?: number } }).attrs?.level)).toEqual([1, 2, 3, 4]);
  });

  it("clamps level 5 to 4 and warns", () => {
    const r = markdownToDoc("##### Heading\n");
    normEqual(r.doc.content, [{ type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Heading" }] }]);
    expect(r.warnings).toContain("Heading level 5 clamped to 4");
  });

  it("clamps level 6 to 4 and warns", () => {
    const r = markdownToDoc("###### Heading\n");
    expect((r.doc.content?.[0] as { attrs?: { level?: number } }).attrs?.level).toBe(4);
    expect(r.warnings).toContain("Heading level 6 clamped to 4");
  });

  it("strips an ATX closing sequence", () => {
    const r = markdownToDoc("## Heading ##\n");
    normEqual(r.doc.content, [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading" }] }]);
  });

  it("parses a setext H1 (===) and H2 (---)", () => {
    const r = markdownToDoc("Title\n=====\n\nSubtitle\n-----\n");
    normEqual(r.doc.content, [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Subtitle" }] },
    ]);
  });

  it("prefers setext over a thematic break in that position", () => {
    // "---" directly under text (no blank line) is the setext underline, not a divider.
    const r = markdownToDoc("Heading Text\n---\n");
    normEqual(r.doc.content, [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Heading Text" }] }]);
  });
});

describe("code blocks", () => {
  it("parses a fenced code block with a language, verbatim (no inline parsing)", () => {
    const r = markdownToDoc("```ts\nconst x = *not italic*;\n```\n");
    normEqual(r.doc.content, [
      { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const x = *not italic*;" }] },
    ]);
  });

  it("parses a ~~~ fence", () => {
    const r = markdownToDoc("~~~\nhello\n~~~\n");
    normEqual(r.doc.content, [{ type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "hello" }] }]);
  });

  it("runs an unclosed fence to EOF and warns", () => {
    const r = markdownToDoc("```js\nconsole.log(1)\n");
    normEqual(r.doc.content, [
      { type: "codeBlock", attrs: { language: "js" }, content: [{ type: "text", text: "console.log(1)" }] },
    ]);
    expect(r.warnings).toContain("Unclosed code fence ran to the end of the document");
  });

  it("parses a 4-space indented code block at the top level, preceded by a blank line", () => {
    const r = markdownToDoc("Para.\n\n    line one\n    line two\n");
    normEqual(r.doc.content, [
      { type: "paragraph", content: [{ type: "text", text: "Para." }] },
      { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "line one\nline two" }] },
    ]);
  });

  it("expands a leading tab the same as 4 spaces for an indented code block", () => {
    const r = markdownToDoc("Para.\n\n\ttabbed\n");
    normEqual(r.doc.content, [
      { type: "paragraph", content: [{ type: "text", text: "Para." }] },
      { type: "codeBlock", attrs: { language: null }, content: [{ type: "text", text: "tabbed" }] },
    ]);
  });
});

describe("Obsidian callouts and toggles", () => {
  it("parses > [!note] EMOJI as a callout with that emoji", () => {
    const r = markdownToDoc("> [!note] 🎯\n> Body text\n");
    normEqual(r.doc.content, [
      { type: "callout", attrs: { emoji: "🎯" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Body text" }] }] },
    ]);
  });

  it("defaults to 💡 when > [!note] has no trailing emoji", () => {
    const r = markdownToDoc("> [!note]\n> Body\n");
    expect((r.doc.content?.[0] as { attrs?: { emoji?: string } }).attrs?.emoji).toBe("💡");
  });

  it("maps other known Obsidian callout types to a sensible emoji and warns if there's a title", () => {
    const r = markdownToDoc("> [!warning] Careful\n> Body\n");
    expect((r.doc.content?.[0] as { attrs?: { emoji?: string } }).attrs?.emoji).toBe("⚠️");
    expect(r.warnings.some((w) => w.includes("Careful") && w.includes("dropped"))).toBe(true);
  });

  it("maps an unknown callout type to a generic callout and warns", () => {
    const r = markdownToDoc("> [!weird]\n> Body\n");
    expect(r.doc.content?.[0]).toMatchObject({ type: "callout" });
    expect(r.warnings.some((w) => w.includes("[!weird]"))).toBe(true);
  });

  it("parses > [!note]+ summary as an open toggle", () => {
    const r = markdownToDoc("> [!note]+ My Summary\n> Toggle body\n");
    normEqual(r.doc.content, [
      {
        type: "toggle",
        attrs: { open: true },
        content: [
          { type: "toggleSummary", content: [{ type: "text", text: "My Summary" }] },
          { type: "toggleContent", content: [{ type: "paragraph", content: [{ type: "text", text: "Toggle body" }] }] },
        ],
      },
    ]);
  });

  it("parses > [!note]- summary as a closed toggle", () => {
    const r = markdownToDoc("> [!note]- My Summary\n> Toggle body\n");
    expect((r.doc.content?.[0] as { attrs?: { open?: boolean } }).attrs?.open).toBe(false);
  });

  it("gives a toggle with no body a single empty paragraph (block+ can't be empty)", () => {
    const r = markdownToDoc("> [!note]+ Summary only\n");
    const toggle = r.doc.content?.[0] as { content?: Array<{ type: string; content?: unknown[] }> };
    const toggleContent = toggle.content?.find((c) => c.type === "toggleContent");
    expect(toggleContent?.content).toHaveLength(1);
    expect((toggleContent?.content as Array<{ type: string }>)[0].type).toBe("paragraph");
  });
});

describe("blockquote", () => {
  it("parses a plain blockquote recursively", () => {
    const r = markdownToDoc("> Quoted line\n> More quoting\n");
    normEqual(r.doc.content, [
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted line More quoting" }] }] },
    ]);
  });

  it("parses a nested blockquote", () => {
    const r = markdownToDoc("> Outer\n>> Inner\n");
    normEqual(r.doc.content, [
      {
        type: "blockquote",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Outer" }] },
          { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Inner" }] }] },
        ],
      },
    ]);
  });
});

describe("lists", () => {
  it("parses a simple bullet list", () => {
    const r = markdownToDoc("- one\n- two\n");
    normEqual(r.doc.content, [
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
        ],
      },
    ]);
  });

  it("parses an ordered list and sets attrs.start only when it isn't 1", () => {
    const r = markdownToDoc("3. third\n4. fourth\n");
    normEqual(r.doc.content, [
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "third" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "fourth" }] }] },
        ],
      },
    ]);
    const r2 = markdownToDoc("1. first\n");
    expect((r2.doc.content?.[0] as { attrs?: unknown }).attrs).toBeUndefined();
  });

  it("parses a task list with checked and unchecked items", () => {
    const r = markdownToDoc("- [x] done\n- [ ] not done\n");
    normEqual(r.doc.content, [
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] },
          { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "not done" }] }] },
        ],
      },
    ]);
  });

  it("parses a nested bullet list inside a listItem", () => {
    const r = markdownToDoc("- parent\n  - child\n");
    normEqual(r.doc.content, [
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "parent" }] },
              { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "child" }] }] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("parses mixed bullet/ordered nesting", () => {
    const r = markdownToDoc("- Item A\n  1. Nested one\n  2. Nested two\n- Item B\n");
    const bulletList = r.doc.content?.[0] as { content: Array<{ content: unknown[] }> };
    expect(bulletList.content).toHaveLength(2);
    const itemA = bulletList.content[0].content as Array<{ type: string }>;
    expect(itemA[0].type).toBe("paragraph");
    expect(itemA[1].type).toBe("orderedList");
  });

  it("absorbs an indented continuation paragraph into the same list item", () => {
    const r = markdownToDoc("- Item A\n  continues here\n- Item B\n");
    const bulletList = r.doc.content?.[0] as { content: Array<{ content: unknown[] }> };
    const itemA = bulletList.content[0].content as Array<{ content?: Array<{ text?: string }> }>;
    expect(itemA).toHaveLength(1);
    expect(itemA[0].content?.[0].text).toBe("Item A continues here");
  });

  it("flattens a nested task list into sibling items of the parent, and warns (taskItem is paragraph-only)", () => {
    const r = markdownToDoc("- [ ] Parent\n  - [ ] Child one\n  - [x] Child two\n");
    const taskList = r.doc.content?.[0] as { type: string; content: Array<{ attrs?: { checked?: boolean } }> };
    expect(taskList.type).toBe("taskList");
    expect(taskList.content).toHaveLength(3); // Parent + both children, all flattened to the same list
    expect(taskList.content.map((i) => i.attrs?.checked)).toEqual([false, false, true]);
    expect(r.warnings.some((w) => w.includes("Nested task list flattened"))).toBe(true);
  });

  it("hoists non-paragraph content out of a task item to a sibling after the list, and warns", () => {
    const r = markdownToDoc("- [ ] Task with a quote\n  > quoted aside\n");
    expect(r.doc.content).toHaveLength(2);
    expect((r.doc.content as JSONContentLike[])[0].type).toBe("taskList");
    expect((r.doc.content as JSONContentLike[])[1].type).toBe("blockquote");
    expect(r.warnings.some((w) => w.includes("task items support paragraphs only"))).toBe(true);
  });
});

describe("tables", () => {
  it("parses a GFM table with a header row", () => {
    const r = markdownToDoc("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    normEqual(r.doc.content, [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] },
            ],
          },
        ],
      },
    ]);
  });

  it("unescapes \\| inside a cell", () => {
    const r = markdownToDoc("| A |\n| --- |\n| 1\\|2 |\n");
    const table = r.doc.content?.[0] as { content: Array<{ content: Array<{ content: Array<{ content: Array<{ text: string }> }> }> }> };
    expect(table.content[1].content[0].content[0].content[0].text).toBe("1|2");
  });

  it("pads a short row to the column count", () => {
    const r = markdownToDoc("| A | B | C |\n| --- | --- | --- |\n| 1 |\n");
    const table = r.doc.content?.[0] as { content: Array<{ content: unknown[] }> };
    expect(table.content[1].content).toHaveLength(3);
  });
});

describe("thematic break", () => {
  it("parses ---, ***, and ___ as horizontalRule", () => {
    const r = markdownToDoc("Para one\n\n---\n\nPara two\n\n***\n\nPara three\n\n___\n");
    const types = (r.doc.content ?? []).map((n) => (n as { type: string }).type);
    expect(types).toEqual(["paragraph", "horizontalRule", "paragraph", "horizontalRule", "paragraph", "horizontalRule"]);
  });
});

describe("images", () => {
  it("parses a paragraph that is entirely one image as a top-level image block", () => {
    const r = markdownToDoc("![Alt text](https://example.com/x.png)\n");
    normEqual(r.doc.content, [{ type: "image", attrs: { src: "https://example.com/x.png", alt: "Alt text", title: null } }]);
  });

  it("splits a paragraph that has other text around an image, and warns", () => {
    const r = markdownToDoc("Before ![Alt](x.png) after\n");
    normEqual(r.doc.content, [
      { type: "paragraph", content: [{ type: "text", text: "Before" }] },
      { type: "image", attrs: { src: "x.png", alt: "Alt", title: null } },
      { type: "paragraph", content: [{ type: "text", text: "after" }] },
    ]);
    expect(r.warnings).toContain("Image inside a paragraph split into a separate block");
  });
});

describe("paragraphs", () => {
  it("turns a two-trailing-space line ending into a hardBreak", () => {
    const r = markdownToDoc("Line one  \nLine two\n");
    normEqual(r.doc.content, [
      { type: "paragraph", content: [{ type: "text", text: "Line one" }, { type: "hardBreak" }, { type: "text", text: "Line two" }] },
    ]);
  });

  it("reverses escapeBlockLeading for a leading \\#, \\>, \\-, and \\1.", () => {
    expect(markdownToDoc("\\# not a heading\n").doc.content?.[0]).toMatchObject({
      content: [{ text: "# not a heading" }],
    });
    expect(markdownToDoc("\\> not a quote\n").doc.content?.[0]).toMatchObject({
      content: [{ text: "> not a quote" }],
    });
    expect(markdownToDoc("\\- not a bullet\n").doc.content?.[0]).toMatchObject({
      content: [{ text: "- not a bullet" }],
    });
    expect(markdownToDoc("\\1. not a list\n").doc.content?.[0]).toMatchObject({
      content: [{ text: "1. not a list" }],
    });
  });
});

describe("raw HTML block", () => {
  it("keeps a raw HTML block as plain text and warns", () => {
    const r = markdownToDoc("<div>raw html</div>\n");
    normEqual(r.doc.content, [{ type: "paragraph", content: [{ type: "text", text: "<div>raw html</div>" }] }]);
    expect(r.warnings).toContain("Raw HTML block kept as plain text");
  });

  it("does not treat <u> as a raw HTML block (it's the inline underline mark)", () => {
    const r = markdownToDoc("<u>underlined</u> text\n");
    normEqual(r.doc.content, [
      { type: "paragraph", content: [{ type: "text", text: "underlined", marks: [{ type: "underline" }] }, { type: "text", text: " text" }] },
    ]);
  });
});

describe("inline: code spans", () => {
  it("uses the longest backtick run needed and strips a single pad space", () => {
    const r = markdownToDoc("`` `padded` ``\n");
    normEqual(r.doc.content, [{ type: "paragraph", content: [{ type: "text", text: "`padded`", marks: [{ type: "code" }] }] }]);
  });

  it("keeps a literal backtick inside a longer-fenced code span", () => {
    const r = markdownToDoc("``a `b` c``\n");
    normEqual(r.doc.content, [{ type: "paragraph", content: [{ type: "text", text: "a `b` c", marks: [{ type: "code" }] }] }]);
  });

  it("does not apply other marks inside code", () => {
    const r = markdownToDoc("`**not bold**`\n");
    normEqual(r.doc.content, [{ type: "paragraph", content: [{ type: "text", text: "**not bold**", marks: [{ type: "code" }] }] }]);
  });
});

describe("inline: emphasis-like marks", () => {
  it("parses bold via ** and __", () => {
    const r = markdownToDoc("**bold** and __also bold__\n");
    const content = (r.doc.content?.[0] as { content: Array<{ text?: string; marks?: Array<{ type: string }> }> }).content;
    expect(content[0]).toMatchObject({ text: "bold", marks: [{ type: "bold" }] });
    expect(content[2]).toMatchObject({ text: "also bold", marks: [{ type: "bold" }] });
  });

  it("parses italic via * and _", () => {
    const r = markdownToDoc("*italic* and _also italic_\n");
    const content = (r.doc.content?.[0] as { content: Array<{ text?: string; marks?: Array<{ type: string }> }> }).content;
    expect(content[0]).toMatchObject({ text: "italic", marks: [{ type: "italic" }] });
    expect(content[2]).toMatchObject({ text: "also italic", marks: [{ type: "italic" }] });
  });

  it("parses strike (~~) and highlight (==)", () => {
    const r = markdownToDoc("~~gone~~ ==lit==\n");
    const content = (r.doc.content?.[0] as { content: Array<{ text?: string; marks?: Array<{ type: string }> }> }).content;
    expect(content[0]).toMatchObject({ text: "gone", marks: [{ type: "strike" }] });
    expect(content[2]).toMatchObject({ text: "lit", marks: [{ type: "highlight" }] });
  });

  it("parses <u>...</u> as the underline mark", () => {
    const r = markdownToDoc("<u>under</u>\n");
    normEqual(r.doc.content, [{ type: "paragraph", content: [{ type: "text", text: "under", marks: [{ type: "underline" }] }] }]);
  });

  it("composes nested marks: bold link, and italic+highlight", () => {
    const r1 = markdownToDoc("**[bold link](https://x)**\n");
    const node1 = (r1.doc.content?.[0] as { content: Array<Record<string, unknown>> }).content[0];
    normEqual(node1, { type: "text", text: "bold link", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://x" } }] });

    const r2 = markdownToDoc("*==both==*\n");
    const node2 = (r2.doc.content?.[0] as { content: Array<Record<string, unknown>> }).content[0];
    normEqual(node2, { type: "text", text: "both", marks: [{ type: "italic" }, { type: "highlight" }] });
  });
});

describe("inline: links and autolinks", () => {
  it("parses [text](href) with inline-parsed text", () => {
    const r = markdownToDoc("[**bold** text](https://example.com)\n");
    const content = (r.doc.content?.[0] as { content: Array<Record<string, unknown>> }).content;
    normEqual(content[0], { type: "text", text: "bold", marks: [{ type: "bold" }, { type: "link", attrs: { href: "https://example.com" } }] });
    normEqual(content[1], { type: "text", text: " text", marks: [{ type: "link", attrs: { href: "https://example.com" } }] });
  });

  it("parses an angle-bracket autolink", () => {
    const r = markdownToDoc("<https://example.com>\n");
    normEqual(r.doc.content, [
      { type: "paragraph", content: [{ type: "text", text: "https://example.com", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
    ]);
  });

  it("leaves a bare URL as plain text", () => {
    const r = markdownToDoc("Visit https://example.com today\n");
    normEqual(r.doc.content, [{ type: "paragraph", content: [{ type: "text", text: "Visit https://example.com today" }] }]);
  });
});

describe("inline: wikilinks", () => {
  it("parses a plain [[Target]] into a pageMention carrying both label and target", () => {
    const r = markdownToDoc("[[Accounting Notes]]\n");
    normEqual(r.doc.content, [
      {
        type: "paragraph",
        content: [{ type: "pageMention", attrs: { pageId: null, label: "Accounting Notes", spaceSlug: null, target: "Accounting Notes" } }],
      },
    ]);
    expect(r.wikilinks).toEqual(["Accounting Notes"]);
  });

  it("parses an aliased [[Target|Label]], keeping target distinct from label", () => {
    const r = markdownToDoc("[[Accounting Notes|my notes]]\n");
    normEqual(r.doc.content, [
      {
        type: "paragraph",
        content: [{ type: "pageMention", attrs: { pageId: null, label: "my notes", spaceSlug: null, target: "Accounting Notes" } }],
      },
    ]);
    expect(r.wikilinks).toEqual(["Accounting Notes"]);
  });

  it("collects unique wikilink targets in document order", () => {
    const r = markdownToDoc("[[Page A]] and [[Page B]] and [[Page A|again]]\n");
    expect(r.wikilinks).toEqual(["Page A", "Page B"]);
  });
});

describe("inline: escapes", () => {
  it("unescapes \\\\ \\` \\* \\_ \\[ \\] \\<", () => {
    const r = markdownToDoc("\\\\ \\` \\* \\_ \\[ \\] \\<\n");
    normEqual(r.doc.content, [{ type: "paragraph", content: [{ type: "text", text: "\\ ` * _ [ ] <" }] }]);
  });
});

// ---------------------------------------------------------------------------
// 2. Round-trip tests via serializeBlocksToMarkdown — the strongest proof.
// ---------------------------------------------------------------------------

type JSONContentLike = { type: string; content?: JSONContentLike[]; attrs?: Record<string, unknown> };

function roundTrip(nodes: Json[]): ReturnType<typeof markdownToDoc> {
  const blocks = nodes.map((content, idx) => block({ position: `a${idx}`, content }));
  const md = serializeBlocksToMarkdown(blocks, noResolve);
  return markdownToDoc(md);
}

describe("round-trip: headings", () => {
  it("round-trips levels 1-4 unchanged", () => {
    const nodes: Json[] = [1, 2, 3, 4].map((level) => ({
      type: "heading",
      attrs: { level },
      content: [{ type: "text", text: `Heading ${level}` }],
    })) as unknown as Json[];
    const r = roundTrip(nodes);
    normEqual(r.doc.content, nodes);
  });

  it("documents the h5/h6 -> h4 asymmetry: exporter clamps to 6, importer clamps to 4", () => {
    const nodes: Json[] = [{ type: "heading", attrs: { level: 5 }, content: [{ type: "text", text: "Deep heading" }] }] as unknown as Json[];
    const r = roundTrip(nodes);
    normEqual(r.doc.content, [{ type: "heading", attrs: { level: 4 }, content: [{ type: "text", text: "Deep heading" }] }]);
    expect(r.warnings).toContain("Heading level 5 clamped to 4");
  });
});

describe("round-trip: paragraph with every mark and a link", () => {
  it("round-trips bold/italic/strike/highlight/code/underline/link", () => {
    const nodes: Json[] = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "plain " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " " },
          { type: "text", text: "italic", marks: [{ type: "italic" }] },
          { type: "text", text: " " },
          { type: "text", text: "strike", marks: [{ type: "strike" }] },
          { type: "text", text: " " },
          { type: "text", text: "hl", marks: [{ type: "highlight" }] },
          { type: "text", text: " " },
          { type: "text", text: "code", marks: [{ type: "code" }] },
          { type: "text", text: " " },
          { type: "text", text: "under", marks: [{ type: "underline" }] },
          { type: "text", text: " " },
          { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
        ],
      },
    ] as unknown as Json[];
    const r = roundTrip(nodes);
    normEqual(r.doc.content, nodes);
  });
});

describe("round-trip: lists", () => {
  it("round-trips a bullet list with a nested bullet list", () => {
    const nodes: Json[] = [
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "two" }] },
              { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "nested" }] }] }] },
            ],
          },
        ],
      },
    ] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });

  it("round-trips an ordered list with a non-default start", () => {
    const nodes: Json[] = [
      {
        type: "orderedList",
        attrs: { start: 5 },
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "fifth" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "sixth" }] }] },
        ],
      },
    ] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });

  it("round-trips a task list", () => {
    const nodes: Json[] = [
      {
        type: "taskList",
        content: [
          { type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "done" }] }] },
          { type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "todo" }] }] },
        ],
      },
    ] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });

  it("documents the nested-task-list asymmetry: the editor can never produce one (TaskItem nested:false), but hand-written Markdown can, and it gets flattened", () => {
    const r = markdownToDoc("- [ ] Parent\n  - [x] Child\n");
    const taskList = r.doc.content?.[0] as { type: string; content: Array<{ attrs?: { checked?: boolean } }> };
    expect(taskList.type).toBe("taskList");
    expect(taskList.content.map((i) => i.attrs?.checked)).toEqual([false, true]);
    expect(r.warnings.some((w) => w.includes("Nested task list flattened"))).toBe(true);
  });
});

describe("round-trip: blockquote", () => {
  it("round-trips a blockquote", () => {
    const nodes: Json[] = [
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted text" }] }] },
    ] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });
});

describe("round-trip: code block with language", () => {
  it("round-trips a codeBlock with attrs.language", () => {
    const nodes: Json[] = [
      { type: "codeBlock", attrs: { language: "ts" }, content: [{ type: "text", text: "const x = 1;" }] },
    ] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });
});

describe("round-trip: callout with a custom emoji", () => {
  it("round-trips a callout", () => {
    const nodes: Json[] = [
      { type: "callout", attrs: { emoji: "🎯" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Callout body" }] }] },
    ] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });
});

describe("round-trip: toggle open and closed", () => {
  it("round-trips an open toggle", () => {
    const nodes: Json[] = [
      {
        type: "toggle",
        attrs: { open: true },
        content: [
          { type: "toggleSummary", content: [{ type: "text", text: "Open toggle" }] },
          { type: "toggleContent", content: [{ type: "paragraph", content: [{ type: "text", text: "Open content" }] }] },
        ],
      },
    ] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });

  it("round-trips a closed toggle", () => {
    const nodes: Json[] = [
      {
        type: "toggle",
        attrs: { open: false },
        content: [
          { type: "toggleSummary", content: [{ type: "text", text: "Closed toggle" }] },
          { type: "toggleContent", content: [{ type: "paragraph", content: [{ type: "text", text: "Closed content" }] }] },
        ],
      },
    ] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });
});

describe("round-trip: table with header", () => {
  it("round-trips a table", () => {
    const nodes: Json[] = [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Col A" }] }] },
              { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Col B" }] }] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] },
              { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] },
            ],
          },
        ],
      },
    ] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });
});

describe("round-trip: divider", () => {
  it("round-trips a horizontalRule", () => {
    const nodes: Json[] = [{ type: "horizontalRule" }] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });
});

describe("round-trip: image", () => {
  it("round-trips a top-level image block", () => {
    const nodes: Json[] = [
      { type: "image", attrs: { src: "https://example.com/pic.png", alt: "A picture", title: null } },
    ] as unknown as Json[];
    normEqual(roundTrip(nodes).doc.content, nodes);
  });
});

describe("round-trip: wikilink mention", () => {
  it("round-trips a pageMention as far as the format allows: label and target survive, pageId/spaceSlug are re-resolved by the caller", () => {
    const nodes: Json[] = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "pageMention", attrs: { pageId: "22222222-2222-4222-8222-222222222222", label: "Other Page", spaceSlug: "work" } },
        ],
      },
    ] as unknown as Json[];
    const blocks = [block({ position: "a0", content: nodes[0] })];
    const md = serializeBlocksToMarkdown(blocks, { resolveWikilink: () => "Other Page" });
    const r = markdownToDoc(md);
    normEqual(r.doc.content, [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "pageMention", attrs: { pageId: null, label: "Other Page", spaceSlug: null, target: "Other Page" } },
        ],
      },
    ]);
    expect(r.wikilinks).toEqual(["Other Page"]);
  });
});

// ---------------------------------------------------------------------------
// 3. Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("never throws, and returns one empty paragraph for an empty string", () => {
    const r = markdownToDoc("");
    normEqual(r.doc.content, [{ type: "paragraph" }]);
    expect(r.frontmatter).toEqual({});
    expect(r.title).toBeNull();
    expect(r.wikilinks).toEqual([]);
  });

  it("returns one empty paragraph for a frontmatter-only document", () => {
    const r = markdownToDoc("---\ntitle: Only Frontmatter\n---\n");
    normEqual(r.doc.content, [{ type: "paragraph" }]);
    expect(r.title).toBe("Only Frontmatter");
  });

  it("does not throw on an unclosed code fence", () => {
    expect(() => markdownToDoc("```\nunterminated")).not.toThrow();
  });

  it("normalizes CRLF line endings", () => {
    const r = markdownToDoc("Line one\r\n\r\nLine two\r\n");
    normEqual(r.doc.content, [
      { type: "paragraph", content: [{ type: "text", text: "Line one" }] },
      { type: "paragraph", content: [{ type: "text", text: "Line two" }] },
    ]);
  });

  it("handles a | inside a table cell without breaking the column split", () => {
    const r = markdownToDoc("| A |\n| --- |\n| 1\\|2 |\n");
    expect(r.doc.content?.[0]).toMatchObject({ type: "table" });
  });

  it("handles backticks inside a code span", () => {
    const r = markdownToDoc("``a`b``\n");
    normEqual(r.doc.content, [{ type: "paragraph", content: [{ type: "text", text: "a`b", marks: [{ type: "code" }] }] }]);
  });

  it("clamps a level-5 heading and warns", () => {
    const r = markdownToDoc("##### Too Deep\n");
    expect((r.doc.content?.[0] as { attrs?: { level?: number } }).attrs?.level).toBe(4);
    expect(r.warnings).toContain("Heading level 5 clamped to 4");
  });

  it("never throws on deeply nested lists or unbalanced brackets/emphasis", () => {
    const pathological = "- a\n".repeat(3) + "  - b\n".repeat(3) + "[[unterminated\n**unterminated bold\n*unterminated italic\n";
    expect(() => markdownToDoc(pathological)).not.toThrow();
  });
});
