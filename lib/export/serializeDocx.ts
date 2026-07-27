/**
 * Block rows → a .docx `Document` (via the `docx` package). Used by the
 * "Export as Word" flow. Mirrors the node-walking shape of
 * `lib/export/serialize.ts` (the Markdown serializer) but emits `docx`
 * Paragraph/TextRun objects. Lists are rendered as text-prefixed bullets
 * ("•"/"1.") rather than real Word numbering — simpler and good enough for a
 * one-way content dump. One-way (Postgres JSON → docx) — never parses back.
 */

import {
  AlignmentType,
  Document,
  HeadingLevel,
  type IParagraphOptions,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { Block, Json } from "@/lib/db/types";

type PMMark = { type?: string; attrs?: Record<string, Json> };
type PMNode = {
  type?: string;
  attrs?: Record<string, Json>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
};

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

function byPosition(a: Block, b: Block): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

function asNode(value: Json): PMNode | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const n = value as PMNode;
  return typeof n.type === "string" ? n : null;
}

function childNodes(node: PMNode): PMNode[] {
  return Array.isArray(node.content) ? node.content.filter((c): c is PMNode => !!c) : [];
}

function collectText(node: PMNode): string {
  if (node.type === "text") return node.text ?? "";
  return childNodes(node).map(collectText).join("");
}

/** Flattens an inline run into TextRuns carrying bold/italic/underline/strike/code + link href as plain text. */
function renderRuns(children: PMNode[], indent = ""): TextRun[] {
  const runs: TextRun[] = [];
  let prefix = indent;
  for (const c of children) {
    if (c.type === "hardBreak") {
      runs.push(new TextRun({ text: "", break: 1 }));
      continue;
    }
    if (c.type === "pageMention") {
      const label = (c.attrs?.label as string) || "Untitled";
      runs.push(new TextRun({ text: `${prefix}${label}`, italics: true }));
      prefix = "";
      continue;
    }
    if (c.type !== "text") {
      runs.push(...renderRuns(childNodes(c), prefix));
      prefix = "";
      continue;
    }
    const marks = c.marks ?? [];
    const has = (t: string) => marks.some((m) => m.type === t);
    const link = marks.find((m) => m.type === "link");
    const text = `${prefix}${c.text ?? ""}${link ? ` (${String(link.attrs?.href ?? "")})` : ""}`;
    prefix = "";
    runs.push(
      new TextRun({
        text,
        bold: has("bold") || has("strong"),
        italics: has("italic") || has("em"),
        underline: has("underline") ? {} : undefined,
        strike: has("strike"),
        font: has("code") ? "Courier New" : undefined,
        highlight: has("highlight") ? "yellow" : undefined,
      })
    );
  }
  return runs;
}

function renderListItems(
  node: PMNode,
  itemType: "listItem" | "taskItem",
  ordered: boolean
): Paragraph[] {
  const items = childNodes(node).filter((c) => c.type === itemType);
  const out: Paragraph[] = [];
  items.forEach((li, i) => {
    const marker =
      itemType === "taskItem"
        ? `${li.attrs?.checked === true ? "☑" : "☐"} `
        : ordered
          ? `${i + 1}. `
          : "• ";
    const kids = childNodes(li);
    const inlineKids = kids.filter((k) => !isBlockNode(k));
    out.push(new Paragraph({ children: renderRuns(inlineKids, marker), indent: { left: 360 } }));
    for (const kid of kids.filter(isBlockNode)) {
      out.push(...renderNode(kid));
    }
  });
  return out;
}

function isBlockNode(node: PMNode): boolean {
  return ["bulletList", "orderedList", "taskList", "paragraph", "blockquote", "codeBlock"].includes(
    node.type ?? ""
  );
}

function renderTable(node: PMNode): Paragraph[] {
  // Rendered as plain text rows (pipe-separated) — a real docx Table adds
  // significant complexity for what is fundamentally a one-way content dump.
  const rows = childNodes(node).filter((r) => r.type === "tableRow");
  return rows.map((row) => {
    const cells = childNodes(row)
      .filter((c) => c.type === "tableCell" || c.type === "tableHeader")
      .map((c) => collectText(c).trim())
      .join(" | ");
    return new Paragraph({ text: cells });
  });
}

function renderNode(node: PMNode): Paragraph[] {
  const kids = childNodes(node);
  switch (node.type) {
    case "paragraph":
      return [new Paragraph({ children: renderRuns(kids) })];
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? Math.min(6, Math.max(1, node.attrs.level)) : 1;
      return [new Paragraph({ children: renderRuns(kids), heading: HEADING_LEVELS[level - 1] })];
    }
    case "bulletList":
      return renderListItems(node, "listItem", false);
    case "orderedList":
      return renderListItems(node, "listItem", true);
    case "taskList":
      return renderListItems(node, "taskItem", false);
    case "blockquote":
      return renderIndentedBlocks(kids, { left: { style: "single", size: 6, color: "999999", space: 8 } });
    case "codeBlock":
      return collectText(node)
        .split("\n")
        .map((line) => new Paragraph({ children: [new TextRun({ text: line, font: "Courier New" })] }));
    case "horizontalRule":
    case "divider":
      return [new Paragraph({ text: "───────────", alignment: AlignmentType.CENTER })];
    case "image": {
      const alt = (node.attrs?.alt as string) || (node.attrs?.title as string) || "image";
      const src = (node.attrs?.src as string) ?? "";
      return [
        new Paragraph({
          children: [new TextRun({ text: `[image: ${alt}${src ? ` — ${src}` : ""}]`, italics: true })],
        }),
      ];
    }
    case "table":
      return renderTable(node);
    case "callout": {
      const emoji = (node.attrs?.emoji as string) ?? "💡";
      return [
        new Paragraph({ text: emoji }),
        ...kids.flatMap(renderNode),
      ];
    }
    case "toggle": {
      const summaryNode = kids.find((c) => c.type === "toggleSummary");
      const contentNode = kids.find((c) => c.type === "toggleContent");
      const summary = summaryNode ? renderRuns(childNodes(summaryNode)) : [];
      const body = contentNode ? childNodes(contentNode).flatMap(renderNode) : [];
      return [new Paragraph({ children: summary }), ...body];
    }
    default:
      return kids.length === 0
        ? node.text
          ? [new Paragraph({ text: node.text })]
          : []
        : kids.flatMap(renderNode);
  }
}

/** Renders block children as indented paragraphs with a left border (blockquote styling). */
function renderIndentedBlocks(
  kids: PMNode[],
  border: NonNullable<IParagraphOptions["border"]>
): Paragraph[] {
  return kids.flatMap((kid) => {
    if (kid.type === "paragraph") {
      return [new Paragraph({ children: renderRuns(childNodes(kid)), indent: { left: 360 }, border })];
    }
    return renderNode(kid);
  });
}

/** Builds the .docx file bytes for a page's blocks. */
export async function serializeBlocksToDocx(title: string, blocks: Block[]): Promise<Buffer> {
  const nodes = blocks
    .slice()
    .sort(byPosition)
    .map((b) => asNode(b.content))
    .filter((n): n is PMNode => n !== null);

  const children: Paragraph[] = [
    new Paragraph({ text: title || "Untitled", heading: HeadingLevel.TITLE }),
    ...nodes.flatMap(renderNode),
  ];

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}
