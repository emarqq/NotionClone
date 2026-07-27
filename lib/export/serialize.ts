/**
 * Block rows → Obsidian-flavored Markdown. Pure/sync — no I/O, no "server-only",
 * no browser DOM — so it unit-tests headlessly (mirrors lib/rag/blockText.ts).
 *
 * Why hand-rolled and not @tiptap/markdown: that package is Tiptap v3-only and
 * this repo is on Tiptap 2.27; reconstructing a v2 schema to drive
 * prosemirror-markdown would throw on the editor's injected `comment` mark /
 * `blockId` attr / foreign `file_embed` rows. A walker degrades gracefully on
 * unknown nodes/marks (like docFromBlocks and blockText.ts already do) and gives
 * full control over the Obsidian flavor (`[[wikilinks]]`, `> [!note]` callouts,
 * foldable-callout toggles, comment-mark stripping).
 *
 * This is a ONE-WAY serializer (Postgres JSON → Markdown). It never parses
 * Markdown back, so the ProseMirror round-trip corruption class does not apply.
 */

import type { Block, Json } from "@/lib/db/types";

type PMMark = { type?: string; attrs?: Record<string, Json> };
type PMNode = {
  type?: string;
  attrs?: Record<string, Json>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
};

export interface SerializeContext {
  /** Resolve a mentioned page id → its current vault file basename (no extension). */
  resolveWikilink: (pageId: string) => string | null;
}

type Ctx = SerializeContext & { inTable: boolean };

/** Inline leaf node types (joined without separators). */
const INLINE_TYPES = new Set(["text", "hardBreak", "pageMention"]);

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

function isInlineRun(children: PMNode[]): boolean {
  return children.length > 0 && children.every((c) => INLINE_TYPES.has(c.type ?? ""));
}

/** Escape the Markdown-significant characters that would otherwise be parsed. */
function escapeText(s: string, inTable: boolean): string {
  let out = s.replace(/([\\`*_[\]<])/g, "\\$1");
  if (inTable) out = out.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return out;
}

/** Prevent a paragraph's first line from being read as a heading/quote/list/etc. */
function escapeBlockLeading(s: string): string {
  return s.replace(/^(\s*)(#{1,6}\s|>\s|[-*+]\s|\d+\.\s)/, (_m, ws: string, marker: string) => `${ws}\\${marker}`);
}

/** Fence inline code with enough backticks to survive backticks in the content. */
function inlineCode(raw: string): string {
  const runs = raw.match(/`+/g);
  const longest = runs ? Math.max(...runs.map((r) => r.length)) : 0;
  const fence = "`".repeat(longest + 1);
  const needsPad = raw.startsWith("`") || raw.endsWith("`") || raw.trim() !== raw;
  return needsPad ? `${fence} ${raw} ${fence}` : `${fence}${raw}${fence}`;
}

function collectText(node: PMNode): string {
  if (node.type === "text") return node.text ?? "";
  return childNodes(node).map(collectText).join("");
}

function renderText(node: PMNode, ctx: Ctx): string {
  const raw = node.text ?? "";
  const marks = node.marks ?? [];
  const has = (t: string) => marks.some((m) => m.type === t);

  let out: string;
  if (has("code")) {
    out = inlineCode(raw); // literal; other formatting marks don't compose with code
  } else {
    out = escapeText(raw, ctx.inTable);
    if (has("highlight")) out = `==${out}==`;
    if (has("strike")) out = `~~${out}~~`;
    if (has("bold") || has("strong")) out = `**${out}**`;
    if (has("italic") || has("em")) out = `*${out}*`;
    if (has("underline")) out = `<u>${out}</u>`;
  }
  // `comment` mark (attr threadId) is intentionally ignored → stripped on export.
  const link = marks.find((m) => m.type === "link");
  if (link) out = `[${out}](${String(link.attrs?.href ?? "")})`;
  return out;
}

function renderMention(node: PMNode, ctx: Ctx): string {
  const pageId = node.attrs?.pageId;
  const label = (node.attrs?.label as string) || "Untitled";
  const target = typeof pageId === "string" && pageId ? ctx.resolveWikilink(pageId) : null;
  if (!target) return `[[${label}]]`;
  return target === label ? `[[${target}]]` : `[[${target}|${label}]]`;
}

function renderInline(children: PMNode[], ctx: Ctx): string {
  return children
    .map((c) => {
      if (c.type === "text") return renderText(c, ctx);
      if (c.type === "hardBreak") return ctx.inTable ? " " : "  \n";
      if (c.type === "pageMention") return renderMention(c, ctx);
      return renderInline(childNodes(c), ctx); // unknown inline wrapper → descend
    })
    .join("");
}

/** Prefix every line of a block (for blockquotes/callouts/toggles). Empty lines keep a bare marker. */
function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => (l.length ? prefix + l : prefix.trimEnd()))
    .join("\n");
}

function renderList(node: PMNode, ordered: boolean, ctx: Ctx, indent: number): string {
  const items = childNodes(node).filter((c) => c.type === "listItem");
  let n = ordered && typeof node.attrs?.start === "number" ? node.attrs.start : 1;
  return items
    .map((li) => renderListItem(li, ordered ? `${n++}. ` : "- ", ctx, indent))
    .join("\n");
}

function renderTaskList(node: PMNode, ctx: Ctx, indent: number): string {
  return childNodes(node)
    .filter((c) => c.type === "taskItem")
    .map((ti) => renderListItem(ti, `- [${ti.attrs?.checked === true ? "x" : " "}] `, ctx, indent))
    .join("\n");
}

/** listItem / taskItem: first block sits on the marker line; nested lists & extra blocks indent under it. */
function renderListItem(li: PMNode, marker: string, ctx: Ctx, indent: number): string {
  const pad = " ".repeat(indent);
  const cont = " ".repeat(indent + marker.length);
  const kids = childNodes(li);
  const out: string[] = [];

  kids.forEach((kid, i) => {
    const nested =
      kid.type === "bulletList" || kid.type === "orderedList" || kid.type === "taskList";
    let md: string;
    if (kid.type === "bulletList") md = renderList(kid, false, ctx, indent + marker.length);
    else if (kid.type === "orderedList") md = renderList(kid, true, ctx, indent + marker.length);
    else if (kid.type === "taskList") md = renderTaskList(kid, ctx, indent + marker.length);
    else md = renderNode(kid, ctx);

    if (nested) {
      out.push(md); // already indented via the indent argument
    } else if (i === 0) {
      const [first, ...rest] = md.split("\n");
      out.push(pad + marker + first);
      for (const r of rest) out.push(cont + r);
    } else {
      for (const r of md.split("\n")) out.push(cont + r);
    }
  });

  if (out.length === 0) out.push(pad + marker.trimEnd());
  return out.join("\n");
}

function renderTable(node: PMNode, ctx: Ctx): string {
  const rows = childNodes(node).filter((r) => r.type === "tableRow");
  if (rows.length === 0) return "";
  const cellsPerRow = rows.map((r) =>
    childNodes(r)
      .filter((c) => c.type === "tableCell" || c.type === "tableHeader")
      .map((c) =>
        renderBlocks(childNodes(c), { ...ctx, inTable: true })
          .replace(/\n+/g, " ")
          .trim() || " "
      )
  );
  const cols = Math.max(...cellsPerRow.map((r) => r.length));
  const pad = (r: string[]) => {
    const copy = r.slice();
    while (copy.length < cols) copy.push(" ");
    return copy;
  };
  const line = (r: string[]) => `| ${r.join(" | ")} |`;
  const header = pad(cellsPerRow[0]);
  const sep = new Array(cols).fill("---");
  const body = cellsPerRow.slice(1).map(pad);
  return [line(header), line(sep), ...body.map(line)].join("\n");
}

function renderCallout(node: PMNode, ctx: Ctx): string {
  const emoji = (node.attrs?.emoji as string) ?? "💡";
  const body = renderBlocks(childNodes(node), ctx);
  const header = `> [!note] ${emoji}`;
  return body ? `${header}\n${prefixLines(body, "> ")}` : header;
}

function renderToggle(node: PMNode, ctx: Ctx): string {
  const open = node.attrs?.open !== false;
  const summaryNode = childNodes(node).find((c) => c.type === "toggleSummary");
  const contentNode = childNodes(node).find((c) => c.type === "toggleContent");
  const summary = summaryNode ? renderInline(childNodes(summaryNode), ctx) : "";
  const body = contentNode ? renderBlocks(childNodes(contentNode), ctx) : "";
  // Obsidian foldable callout: `+` starts expanded, `-` starts folded.
  const header = `> [!note]${open ? "+" : "-"} ${summary}`.trimEnd();
  return body ? `${header}\n${prefixLines(body, "> ")}` : header;
}

function renderImage(node: PMNode): string {
  // v1: lossless marker only. The `attachments` bucket is private, so a URL
  // would not resolve in Obsidian anyway; byte-copy to _attachments/ is v2.
  const alt = (node.attrs?.alt as string) || (node.attrs?.title as string) || "image";
  const src = (node.attrs?.src as string) ?? "";
  return `![${alt}](${src})`;
}

function renderNode(node: PMNode, ctx: Ctx): string {
  const kids = childNodes(node);
  switch (node.type) {
    case "paragraph":
      return escapeBlockLeading(renderInline(kids, ctx));
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? Math.min(6, Math.max(1, node.attrs.level)) : 1;
      return `${"#".repeat(level)} ${renderInline(kids, ctx)}`;
    }
    case "bulletList":
      return renderList(node, false, ctx, 0);
    case "orderedList":
      return renderList(node, true, ctx, 0);
    case "taskList":
      return renderTaskList(node, ctx, 0);
    case "blockquote":
      return prefixLines(renderBlocks(kids, ctx), "> ");
    case "codeBlock": {
      const lang = (node.attrs?.language as string) ?? "";
      return `\`\`\`${lang}\n${collectText(node)}\n\`\`\``;
    }
    case "horizontalRule":
    case "divider":
      return "---";
    case "image":
      return renderImage(node);
    case "table":
      return renderTable(node, ctx);
    case "callout":
      return renderCallout(node, ctx);
    case "toggle":
      return renderToggle(node, ctx);
    case "toggleContent":
      return renderBlocks(kids, ctx);
    case "toggleSummary":
      return renderInline(kids, ctx);
    default:
      if (kids.length === 0) return node.text ? escapeText(node.text, ctx.inTable) : "";
      return isInlineRun(kids) ? renderInline(kids, ctx) : renderBlocks(kids, ctx);
  }
}

function renderBlocks(nodes: PMNode[], ctx: Ctx): string {
  return nodes
    .map((n) => renderNode(n, ctx))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

/**
 * Serializes a page's block rows to a Markdown body string (no frontmatter).
 * `blocks` need not be pre-sorted. Unknown/foreign block rows (e.g. file_embed)
 * degrade to their inline text or are dropped, never throwing.
 */
export function serializeBlocksToMarkdown(blocks: Block[], opts: SerializeContext): string {
  const nodes = blocks
    .slice()
    .sort(byPosition)
    .map((b) => asNode(b.content))
    .filter((n): n is PMNode => n !== null);
  return renderBlocks(nodes, { ...opts, inTable: false });
}
