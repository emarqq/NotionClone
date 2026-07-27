/**
 * Block rows → a self-contained, print-ready HTML document. Used only by the
 * "Export as PDF" flow: the browser opens this document and calls
 * `window.print()`, so the user picks "Save as PDF" in the native print
 * dialog rather than the server generating a PDF binary itself.
 *
 * Mirrors the node-walking shape of `lib/export/serialize.ts` (the Markdown
 * serializer) but emits HTML tags instead of Markdown syntax. One-way
 * (Postgres JSON → HTML) — never parses HTML back.
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

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectText(node: PMNode): string {
  if (node.type === "text") return node.text ?? "";
  return childNodes(node).map(collectText).join("");
}

function renderText(node: PMNode): string {
  const raw = escapeHtml(node.text ?? "");
  const marks = node.marks ?? [];
  const has = (t: string) => marks.some((m) => m.type === t);

  let out = raw;
  if (has("code")) out = `<code>${out}</code>`;
  if (has("highlight")) out = `<mark>${out}</mark>`;
  if (has("strike")) out = `<s>${out}</s>`;
  if (has("bold") || has("strong")) out = `<strong>${out}</strong>`;
  if (has("italic") || has("em")) out = `<em>${out}</em>`;
  if (has("underline")) out = `<u>${out}</u>`;

  const link = marks.find((m) => m.type === "link");
  if (link) out = `<a href="${escapeHtml(String(link.attrs?.href ?? ""))}">${out}</a>`;
  return out;
}

function renderMention(node: PMNode): string {
  const label = (node.attrs?.label as string) || "Untitled";
  return `<span class="mention">${escapeHtml(label)}</span>`;
}

function renderInline(children: PMNode[]): string {
  return children
    .map((c) => {
      if (c.type === "text") return renderText(c);
      if (c.type === "hardBreak") return "<br/>";
      if (c.type === "pageMention") return renderMention(c);
      return renderInline(childNodes(c));
    })
    .join("");
}

function renderListItems(node: PMNode, itemType: "listItem" | "taskItem"): string {
  return childNodes(node)
    .filter((c) => c.type === itemType)
    .map((li) => {
      const checkbox =
        itemType === "taskItem"
          ? `<input type="checkbox" disabled ${li.attrs?.checked === true ? "checked" : ""}/> `
          : "";
      return `<li>${checkbox}${renderBlocks(childNodes(li))}</li>`;
    })
    .join("\n");
}

function renderTable(node: PMNode): string {
  const rows = childNodes(node).filter((r) => r.type === "tableRow");
  const body = rows
    .map((row, i) => {
      const cells = childNodes(row)
        .filter((c) => c.type === "tableCell" || c.type === "tableHeader")
        .map((c) => {
          const tag = i === 0 || c.type === "tableHeader" ? "th" : "td";
          return `<${tag}>${renderBlocks(childNodes(c))}</${tag}>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");
  return `<table>${body}</table>`;
}

function renderCallout(node: PMNode): string {
  const emoji = (node.attrs?.emoji as string) ?? "💡";
  return `<blockquote class="callout"><div class="callout-emoji">${escapeHtml(emoji)}</div>${renderBlocks(
    childNodes(node)
  )}</blockquote>`;
}

function renderToggle(node: PMNode): string {
  const summaryNode = childNodes(node).find((c) => c.type === "toggleSummary");
  const contentNode = childNodes(node).find((c) => c.type === "toggleContent");
  const summary = summaryNode ? renderInline(childNodes(summaryNode)) : "";
  const body = contentNode ? renderBlocks(childNodes(contentNode)) : "";
  return `<details open><summary>${summary}</summary>${body}</details>`;
}

function renderImage(node: PMNode): string {
  const alt = escapeHtml((node.attrs?.alt as string) || (node.attrs?.title as string) || "image");
  const src = escapeHtml((node.attrs?.src as string) ?? "");
  return `<img alt="${alt}" src="${src}"/>`;
}

function renderNode(node: PMNode): string {
  const kids = childNodes(node);
  switch (node.type) {
    case "paragraph":
      return `<p>${renderInline(kids)}</p>`;
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? Math.min(6, Math.max(1, node.attrs.level)) : 1;
      return `<h${level}>${renderInline(kids)}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${renderListItems(node, "listItem")}</ul>`;
    case "orderedList": {
      const start = typeof node.attrs?.start === "number" ? ` start="${node.attrs.start}"` : "";
      return `<ol${start}>${renderListItems(node, "listItem")}</ol>`;
    }
    case "taskList":
      return `<ul class="task-list">${renderListItems(node, "taskItem")}</ul>`;
    case "blockquote":
      return `<blockquote>${renderBlocks(kids)}</blockquote>`;
    case "codeBlock": {
      return `<pre><code>${escapeHtml(collectText(node))}</code></pre>`;
    }
    case "horizontalRule":
    case "divider":
      return "<hr/>";
    case "image":
      return renderImage(node);
    case "table":
      return renderTable(node);
    case "callout":
      return renderCallout(node);
    case "toggle":
      return renderToggle(node);
    default:
      return kids.length === 0
        ? node.text
          ? `<p>${escapeHtml(node.text)}</p>`
          : ""
        : renderBlocks(kids);
  }
}

function renderBlocks(nodes: PMNode[]): string {
  return nodes.map(renderNode).filter((s) => s.length > 0).join("\n");
}

const PRINT_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; max-width: 780px; margin: 2rem auto; padding: 0 1.5rem; line-height: 1.6; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.4em 0 0.4em; }
  p { margin: 0.6em 0; }
  code { background: #f2f2f2; border-radius: 3px; padding: 0.1em 0.3em; font-size: 0.9em; }
  pre { background: #f6f6f6; border-radius: 6px; padding: 0.8em 1em; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #ddd; margin: 0.8em 0; padding: 0.2em 1em; color: #444; }
  blockquote.callout { display: flex; gap: 0.6em; background: #f7f7f7; border-left-color: #999; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
  th, td { border: 1px solid #ddd; padding: 0.4em 0.6em; text-align: left; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
  .mention { background: #eef0ff; border-radius: 3px; padding: 0 0.3em; }
  @media print { body { margin: 0 auto; } }
`;

/** Renders a full standalone HTML document (page title + body) ready to print/save as PDF. */
export function renderPageToHtmlDocument(title: string, blocks: Block[]): string {
  const nodes = blocks
    .slice()
    .sort(byPosition)
    .map((b) => asNode(b.content))
    .filter((n): n is PMNode => n !== null);
  const body = renderBlocks(nodes);
  const safeTitle = escapeHtml(title || "Untitled");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>${safeTitle}</title>
<style>${PRINT_STYLES}</style>
</head>
<body>
<h1>${safeTitle}</h1>
${body}
<script>window.onload = function () { window.print(); };</script>
</body>
</html>`;
}
