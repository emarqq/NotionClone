/**
 * Markdown → ProseMirror-doc parser. The inverse of `lib/export/serialize.ts`
 * (which only ever goes Postgres JSON → Markdown). Every construct that
 * serializer emits must parse back here to the node shape it came from —
 * this file is written by reading that one closely and inverting it
 * construct-by-construct; see the comments below for the mapping.
 *
 * Pure/sync — no I/O, no "server-only", no browser DOM, no npm markdown
 * library (prosemirror-markdown is Tiptap v3-only and none is installed for
 * v2; a prior project decision keeps it that way). Hand-rolled recursive
 * descent over lines (block level) and characters (inline level), same style
 * as the walkers in lib/export/pmWalk.ts. Never throws: malformed input
 * degrades to plain paragraphs, never a crash that would block a page save.
 *
 * Schema ground truth this file targets (read from the installed Tiptap
 * packages and components/editor/Editor.tsx, not guessed):
 *   - heading: content "inline*", levels 1-4 only (StarterKit configured).
 *   - listItem: content "paragraph block*" — the FIRST child must be a
 *     paragraph; nested lists/blockquotes/etc. are fine after that.
 *   - taskItem (TaskItem.configure({ nested: false })): content "paragraph+"
 *     — paragraphs ONLY, no nested lists of any kind. A checkbox item whose
 *     Markdown body contains a nested task list is flattened into sibling
 *     items of the *parent* taskList (warned); any other nested block is
 *     hoisted to a sibling after the whole list (warned) rather than
 *     dropped or made to produce an invalid doc.
 *   - bulletList/orderedList/taskList: content "listItem+"/"taskItem+".
 *   - blockquote/callout/toggleContent: content "block+" (never empty — an
 *     empty body still gets one empty paragraph).
 *   - toggleSummary: content "inline*".
 *   - codeBlock: content "text*", marks: '' (no inline marks at all).
 *   - table/tableRow/tableCell/tableHeader: "tableRow+" /
 *     "(tableCell|tableHeader)*" / "block+" / "block+" — cells hold a
 *     paragraph, not bare inline content.
 *   - image: block (inline: false), attrs { src, alt, title }.
 *   - pageMention: inline atom, attrs { pageId, label, spaceSlug }.
 *   - marks available: bold, italic, strike, code, underline, highlight,
 *     link. The `comment` mark is never produced (nothing to invert; the
 *     exporter already strips it on the way out).
 *   - `blockId` is deliberately never set — BlockId's ProseMirror plugin
 *     mints a fresh UUID for every top-level node on insert.
 */

import type { JSONContent } from "@tiptap/core";

export interface MarkdownImportResult {
  /** { type: "doc", content: [...top-level nodes] } */
  doc: JSONContent;
  /** Frontmatter key/values, if a leading `---` fence was present. Empty object otherwise. */
  frontmatter: Record<string, string>;
  /** frontmatter.title, else the text of a leading H1, else null. NOTE: never removed from `doc`. */
  title: string | null;
  /** Unique `[[wikilink]]` targets found, in order, so the caller can resolve them to page ids. */
  wikilinks: string[];
  /** Human-readable lossy-conversion notes, e.g. "Heading level 5 clamped to 4". Deduplicated. */
  warnings: string[];
}

/** Threaded through every block/inline helper instead of returning tuples everywhere. */
interface ImportCtx {
  warnings: string[];
  wikilinkSeen: Set<string>;
  wikilinks: string[];
}

function warn(ctx: ImportCtx, message: string): void {
  ctx.warnings.push(message);
}

function recordWikilink(ctx: ImportCtx, target: string): void {
  if (!ctx.wikilinkSeen.has(target)) {
    ctx.wikilinkSeen.add(target);
    ctx.wikilinks.push(target);
  }
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

/** \u0000 is reserved internally to mark a hardBreak inside a joined paragraph string (see joinParagraphLines). */
const HARD_BREAK = "\u0000";

function expandLeadingTabs(line: string): string {
  let col = 0;
  let i = 0;
  while (i < line.length && (line[i] === " " || line[i] === "\t")) {
    col += line[i] === "\t" ? 4 - (col % 4) : 1;
    i++;
  }
  return i === 0 ? line : " ".repeat(col) + line.slice(i);
}

function isBlank(line: string): boolean {
  return /^\s*$/.test(line);
}

function leadingSpaces(line: string): number {
  const m = /^ */.exec(line);
  return m ? m[0].length : 0;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

function extractFrontmatter(lines: string[]): { frontmatter: Record<string, string>; bodyLines: string[] } {
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { frontmatter: {}, bodyLines: lines };
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) return { frontmatter: {}, bodyLines: lines }; // unclosed fence: degrade to "no frontmatter"

  const frontmatter: Record<string, string> = {};
  for (let i = 1; i < close; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue; // nested/complex YAML (lists, objects, multi-line): ignore gracefully, don't throw
    let value = m[2].trim();
    if (value.length === 0) continue; // "key:" with nothing on the line — almost always a nested block that follows; skip it
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    frontmatter[m[1]] = value;
  }
  return { frontmatter, bodyLines: lines.slice(close + 1) };
}

// ---------------------------------------------------------------------------
// Inline parsing — inverts renderText/renderInline/renderMention (serialize.ts:55-93)
// ---------------------------------------------------------------------------

/** Escapable set from serialize.ts's escapeText, plus `|` (table-cell escaping) — safe to unescape everywhere. */
const ESCAPABLE = new Set(["\\", "`", "*", "_", "[", "]", "<", "|"]);

function addMark(node: JSONContent, mark: { type: string; attrs?: Record<string, unknown> }): JSONContent {
  if (node.type !== "text") return node; // only text nodes carry marks; atoms/hardBreak pass through untouched
  const marks = Array.isArray(node.marks) ? node.marks : [];
  if (marks.some((mk) => mk.type === mark.type)) return node; // don't double-apply the same mark type
  return { ...node, marks: [...marks, mark] };
}

/** Finds `[start,end)` ranges covered by inline code spans, so image-splitting can ignore matches inside them. */
function findCodeSpanRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    let j = i;
    while (text[j] === "`") j++;
    const runLen = j - i;
    const fence = "`".repeat(runLen);
    let searchFrom = j;
    let matched = false;
    while (!matched) {
      const idx = text.indexOf(fence, searchFrom);
      if (idx === -1) break;
      if (text[idx + runLen] === "`") {
        searchFrom = idx + runLen;
        continue;
      }
      ranges.push([i, idx + runLen]);
      i = idx + runLen;
      matched = true;
    }
    if (!matched) i = j; // unclosed fence: not a code span, just skip past the backtick run
  }
  return ranges;
}

function inRanges(ranges: Array<[number, number]>, idx: number): boolean {
  return ranges.some(([s, e]) => idx >= s && idx < e);
}

/** Longest-run-first backtick code span. Mirrors serialize.ts's inlineCode() padding rule in reverse. */
function matchCodeSpan(text: string, pos: number): { content: string; next: number } | null {
  let j = pos;
  while (text[j] === "`") j++;
  const runLen = j - pos;
  const fence = "`".repeat(runLen);
  let searchFrom = j;
  while (true) {
    const idx = text.indexOf(fence, searchFrom);
    if (idx === -1) return null;
    if (text[idx + runLen] === "`") {
      searchFrom = idx + runLen; // part of a longer run; keep looking
      continue;
    }
    let raw = text.slice(j, idx);
    if (raw.length >= 2 && raw[0] === " " && raw[raw.length - 1] === " " && raw.trim() !== "") {
      raw = raw.slice(1, -1); // strip the single pad space added when raw started/ended with a backtick or whitespace
    }
    return { content: raw, next: idx + runLen };
  }
}

function matchAutolink(text: string, pos: number): { href: string; next: number } | null {
  const m = /^<([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]*)>/.exec(text.slice(pos));
  if (!m) return null;
  return { href: m[1], next: pos + m[0].length };
}

function matchUnderline(text: string, pos: number): { inner: string; next: number } | null {
  const m = /^<u>([\s\S]*?)<\/u>/i.exec(text.slice(pos));
  if (!m) return null;
  return { inner: m[1], next: pos + m[0].length };
}

function matchWikilink(text: string, pos: number): { target: string; label: string; next: number } | null {
  const m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(text.slice(pos));
  if (!m) return null;
  const target = m[1].trim();
  const label = (m[2] ?? m[1]).trim();
  return { target, label, next: pos + m[0].length };
}

/** `[text](href)` — no nested-bracket support (matches the first unescaped `]`), which is all serialize.ts ever emits. */
function matchLink(text: string, pos: number): { inner: string; href: string; next: number } | null {
  if (text[pos] !== "[") return null;
  let j = pos + 1;
  while (j < text.length && text[j] !== "]") {
    j += text[j] === "\\" ? 2 : 1;
  }
  if (j >= text.length || text[j + 1] !== "(") return null;
  let k = j + 2;
  while (k < text.length && text[k] !== ")") k++;
  if (k >= text.length) return null;
  return { inner: text.slice(pos + 1, j), href: text.slice(j + 2, k), next: k + 1 };
}

/** Generic delimiter-run matcher shared by bold/italic/strike/highlight — finds the next unescaped closing run. */
function matchDelimiter(text: string, pos: number, marker: string): { inner: string; next: number } | null {
  const start = pos + marker.length;
  let j = start;
  while (j < text.length) {
    if (text[j] === "\\") {
      j += 2;
      continue;
    }
    if (text.startsWith(marker, j)) {
      if (j === start) {
        j += marker.length; // empty span; keep scanning for a non-empty match
        continue;
      }
      return { inner: text.slice(start, j), next: j + marker.length };
    }
    j++;
  }
  return null;
}

/**
 * Recursive-descent inline tokenizer. Priority mirrors renderText's precedence
 * in reverse: code spans are checked first and are exclusive (nothing else
 * parses inside one), then autolinks/underline/wikilinks/links, then the
 * emphasis-like delimiters, then character escapes, then plain text.
 */
function parseInline(text: string, ctx: ImportCtx): JSONContent[] {
  const out: JSONContent[] = [];
  let buf = "";
  let pos = 0;
  const flush = () => {
    if (buf) {
      out.push({ type: "text", text: buf });
      buf = "";
    }
  };

  while (pos < text.length) {
    const ch = text[pos];

    if (ch === HARD_BREAK) {
      flush();
      out.push({ type: "hardBreak" });
      pos += 1;
      continue;
    }

    if (ch === "`") {
      const m = matchCodeSpan(text, pos);
      if (m) {
        flush();
        out.push({ type: "text", text: m.content, marks: [{ type: "code" }] });
        pos = m.next;
        continue;
      }
    }

    if (ch === "<") {
      const auto = matchAutolink(text, pos);
      if (auto) {
        flush();
        out.push({ type: "text", text: auto.href, marks: [{ type: "link", attrs: { href: auto.href } }] });
        pos = auto.next;
        continue;
      }
      const u = matchUnderline(text, pos);
      if (u) {
        flush();
        for (const n of parseInline(u.inner, ctx)) out.push(addMark(n, { type: "underline" }));
        pos = u.next;
        continue;
      }
    }

    if (ch === "[" && text[pos + 1] === "[") {
      const wl = matchWikilink(text, pos);
      if (wl) {
        flush();
        recordWikilink(ctx, wl.target);
        out.push({
          type: "pageMention",
          // `target` is transient/parser-only: the caller resolves it to a
          // real pageId and strips it before the node reaches the editor —
          // the PageMention schema itself only declares pageId/label/spaceSlug.
          attrs: { pageId: null, label: wl.label, spaceSlug: null, target: wl.target },
        });
        pos = wl.next;
        continue;
      }
    }

    if (ch === "[") {
      const lk = matchLink(text, pos);
      if (lk) {
        flush();
        for (const n of parseInline(lk.inner, ctx)) out.push(addMark(n, { type: "link", attrs: { href: lk.href } }));
        pos = lk.next;
        continue;
      }
    }

    const two = text.slice(pos, pos + 2);
    if (two === "**" || two === "__") {
      const d = matchDelimiter(text, pos, two);
      if (d) {
        flush();
        for (const n of parseInline(d.inner, ctx)) out.push(addMark(n, { type: "bold" }));
        pos = d.next;
        continue;
      }
    } else if (two === "~~") {
      const d = matchDelimiter(text, pos, "~~");
      if (d) {
        flush();
        for (const n of parseInline(d.inner, ctx)) out.push(addMark(n, { type: "strike" }));
        pos = d.next;
        continue;
      }
    } else if (two === "==") {
      const d = matchDelimiter(text, pos, "==");
      if (d) {
        flush();
        for (const n of parseInline(d.inner, ctx)) out.push(addMark(n, { type: "highlight" }));
        pos = d.next;
        continue;
      }
    }

    if ((ch === "*" || ch === "_") && text[pos + 1] !== ch) {
      const d = matchDelimiter(text, pos, ch);
      if (d) {
        flush();
        for (const n of parseInline(d.inner, ctx)) out.push(addMark(n, { type: "italic" }));
        pos = d.next;
        continue;
      }
    }

    if (ch === "\\" && pos + 1 < text.length && ESCAPABLE.has(text[pos + 1])) {
      buf += text[pos + 1];
      pos += 2;
      continue;
    }

    buf += ch;
    pos += 1;
  }
  flush();
  return out;
}

function flattenInlineText(nodes: JSONContent[]): string {
  return nodes
    .map((n) => {
      if (n.type === "text") return n.text ?? "";
      if (n.type === "pageMention") return (n.attrs?.label as string) ?? "";
      if (n.type === "hardBreak") return " ";
      return "";
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Block-level matchers
// ---------------------------------------------------------------------------

function matchAtxHeading(line: string): { level: number; text: string } | null {
  const m = /^ {0,3}(#{1,6})(\s+(.*))?$/.exec(line);
  if (!m) return null;
  const level = m[1].length;
  const text = (m[3] ?? "").trim().replace(/\s+#+\s*$/, ""); // strip an optional ATX closing sequence
  return { level, text };
}

/** `-`/`=` underline directly below a text line, no blank line between. Only single-line headings are promoted. */
const SETEXT_RE = /^ {0,3}(=+|-+)\s*$/;

function isThematicBreak(trimmed: string): boolean {
  if (trimmed.length < 3) return false;
  const c = trimmed[0];
  if (c !== "-" && c !== "*" && c !== "_") return false;
  for (const ch of trimmed) {
    if (ch !== c && ch !== " " && ch !== "\t") return false;
  }
  return trimmed.replace(/\s/g, "").length >= 3;
}

function matchFenceOpen(line: string): { char: string; len: number; lang: string } | null {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\n]*)$/.exec(line);
  if (!m) return null;
  const char = m[1][0];
  if (char === "`" && m[2].includes("`")) return null; // backtick fences can't have a backtick in the info string
  return { char, len: m[1].length, lang: m[2].trim() };
}

function isFenceClose(line: string, char: string, minLen: number): boolean {
  const m = /^ {0,3}(`+|~+)\s*$/.exec(line);
  return !!m && m[1][0] === char && m[1].length >= minLen;
}

interface MarkerMatch {
  kind: "bullet" | "ordered" | "task";
  /**
   * Column (relative to rest0) where nested/continuation content is
   * anchored. For a task item this is the BULLET's width alone ("- "), not
   * "- [ ] " — GFM task syntax is recognized inside the item's own first
   * paragraph, it isn't part of the block-level list marker, so hand-written
   * Markdown indents continuation lines relative to the bullet, not the
   * checkbox. `rest` below is still checkbox-stripped, independently.
   */
  indentWidth: number;
  rest: string;
  num?: number;
  checked?: boolean;
}

/** `rest0` is a line with its leading indentation already stripped. */
function matchMarker(rest0: string): MarkerMatch | null {
  if (rest0.length === 0) return null;
  const c = rest0[0];
  if (c === "-" || c === "*" || c === "+") {
    let pos = 1;
    if (pos < rest0.length && rest0[pos] !== " ") return null; // e.g. "-foo" is not a list marker
    while (rest0[pos] === " ") pos++;
    const afterBulletSpace = pos;
    const taskM = /^\[([ xX])\]/.exec(rest0.slice(pos));
    if (taskM) {
      let p2 = pos + 3;
      if (p2 < rest0.length) {
        if (rest0[p2] !== " ") {
          // "- [x]foo": not valid task syntax; fall back to a plain bullet with "[x]foo" as its content
          return { kind: "bullet", indentWidth: afterBulletSpace, rest: rest0.slice(afterBulletSpace) };
        }
        while (rest0[p2] === " ") p2++;
      }
      return { kind: "task", indentWidth: afterBulletSpace, rest: rest0.slice(p2), checked: taskM[1].toLowerCase() === "x" };
    }
    return { kind: "bullet", indentWidth: afterBulletSpace, rest: rest0.slice(afterBulletSpace) };
  }
  const om = /^(\d{1,9})([.)])/.exec(rest0);
  if (om) {
    let pos = om[0].length;
    if (pos < rest0.length && rest0[pos] !== " ") return null; // e.g. "1.foo" is not a list marker
    while (rest0[pos] === " ") pos++;
    return { kind: "ordered", indentWidth: pos, rest: rest0.slice(pos), num: parseInt(om[1], 10) };
  }
  return null;
}

/** Splits a table row on unescaped `|`, keeping `\|` intact for the inline parser to unescape later. */
function splitRowCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      cur += s[i] + s[i + 1];
      i++;
      continue;
    }
    if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function isTableDelimiterRow(line: string): boolean {
  if (!line.includes("-") || !line.includes("|")) return false;
  const cells = splitRowCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** Lines that can interrupt an in-progress paragraph (CommonMark "lazy continuation" — excludes ambiguous dash/eq runs, handled via SETEXT_RE by the caller first). */
function isBlockStart(line: string): boolean {
  if (leadingSpaces(line) > 3) return false;
  if (matchAtxHeading(line)) return true;
  if (matchFenceOpen(line)) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (matchMarker(line.slice(leadingSpaces(line)))) return true;
  if (isThematicBreak(line.trim())) return true;
  return false;
}

const OBS_CALLOUT_RE = /^\[!([A-Za-z]+)\]([+-])?[ \t]?(.*)$/;

const CALLOUT_EMOJI: Record<string, string> = {
  info: "ℹ️",
  warning: "⚠️",
  tip: "💡",
  danger: "🔥",
  question: "❓",
  success: "✅",
  example: "📋",
  quote: "💬",
  abstract: "📝",
  failure: "❌",
  bug: "🐛",
};

// ---------------------------------------------------------------------------
// Block collectors that consume several lines and advance the cursor
// ---------------------------------------------------------------------------

function collectFence(
  lines: string[],
  start: number,
  fence: { char: string; len: number },
  ctx: ImportCtx
): { text: string; next: number } {
  const collected: string[] = [];
  let i = start;
  let closed = false;
  while (i < lines.length) {
    if (isFenceClose(lines[i], fence.char, fence.len)) {
      closed = true;
      i++;
      break;
    }
    collected.push(lines[i]);
    i++;
  }
  if (!closed) warn(ctx, "Unclosed code fence ran to the end of the document");
  return { text: collected.join("\n"), next: i };
}

function collectIndentedCode(lines: string[], start: number): { text: string; next: number } {
  const collected: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      collected.push("");
      i++;
      continue;
    }
    if (leadingSpaces(line) >= 4) {
      collected.push(line.slice(4));
      i++;
      continue;
    }
    break;
  }
  let end = collected.length;
  while (end > 0 && collected[end - 1] === "") end--; // don't bake trailing blank lines into the code content
  return { text: collected.slice(0, end).join("\n"), next: i };
}

/** Continuation lines of a `>` block, one dedent level removed (strips "> " or ">"). */
function collectQuoteLines(lines: string[], start: number): { raw: string[]; next: number } {
  const raw: string[] = [];
  let j = start;
  while (j < lines.length) {
    const m = /^ {0,3}>( ?)(.*)$/.exec(lines[j]);
    if (m) {
      raw.push(m[2]);
      j++;
      continue;
    }
    if (isBlank(lines[j]) && j + 1 < lines.length && /^ {0,3}>/.test(lines[j + 1])) {
      raw.push(""); // a loose blank line inside the quote, still followed by more quoted content
      j++;
      continue;
    }
    break;
  }
  return { raw, next: j };
}

function isHtmlBlockStart(line: string): boolean {
  const t = line.replace(/^ {0,3}/, "");
  if (/^<u[ >]/i.test(t)) return false; // <u>...</u> is handled as an inline mark, not a block
  return /^<\/?[a-zA-Z][a-zA-Z0-9-]*(?=[\s>/]|$)/.test(t);
}

function collectRawHtmlBlock(lines: string[], start: number): { text: string; next: number } {
  const collected: string[] = [];
  let i = start;
  while (i < lines.length && !isBlank(lines[i])) {
    collected.push(lines[i].trim());
    i++;
  }
  return { text: collected.join(" "), next: i };
}

// ---------------------------------------------------------------------------
// Obsidian callouts / toggles (checked before plain blockquote)
// ---------------------------------------------------------------------------

function tryObsidianCalloutOrToggle(headerRest: string, bodyRawLines: string[], ctx: ImportCtx): JSONContent | null {
  const m = OBS_CALLOUT_RE.exec(headerRest);
  if (!m) return null;
  const type = m[1].toLowerCase();
  const fold = m[2] ?? null;
  const rest = (m[3] ?? "").trim();
  const body = parseBlockLines(bodyRawLines, { allowIndentedCode: true }, ctx);
  const nonEmptyBody = body.length ? body : [{ type: "paragraph" }];

  if (fold) {
    return {
      type: "toggle",
      attrs: { open: fold === "+" },
      content: [
        rest ? { type: "toggleSummary", content: parseInline(rest, ctx) } : { type: "toggleSummary" },
        { type: "toggleContent", content: nonEmptyBody },
      ],
    };
  }

  let emoji: string;
  if (type === "note") {
    emoji = rest.length > 0 ? rest : "💡";
  } else if (type in CALLOUT_EMOJI) {
    emoji = CALLOUT_EMOJI[type];
    if (rest.length > 0) {
      warn(ctx, `Obsidian callout title "${rest}" for [!${type}] dropped (callout has no title field)`);
    }
  } else {
    emoji = "💡";
    warn(ctx, `Unknown Obsidian callout type [!${type}] mapped to a generic callout`);
    if (rest.length > 0) {
      warn(ctx, `Obsidian callout title "${rest}" for [!${type}] dropped (callout has no title field)`);
    }
  }
  return { type: "callout", attrs: { emoji }, content: nonEmptyBody };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function buildTable(lines: string[], start: number, ctx: ImportCtx): { node: JSONContent; next: number } {
  const headerCells = splitRowCells(lines[start]);
  let i = start + 2; // header row + delimiter row
  const rows: string[][] = [headerCells];
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) {
    rows.push(splitRowCells(lines[i]));
    i++;
  }
  const cols = Math.max(...rows.map((r) => r.length));
  const rowNodes = rows.map((cells, rowIdx) => {
    const padded = cells.slice();
    while (padded.length < cols) padded.push(""); // pad short rows to the column count
    const cellType = rowIdx === 0 ? "tableHeader" : "tableCell";
    return {
      type: "tableRow",
      content: padded.map((cellText) => {
        const inline = parseInline(cellText, ctx);
        return {
          type: cellType,
          content: [inline.length ? { type: "paragraph", content: inline } : { type: "paragraph" }],
        };
      }),
    };
  });
  return { node: { type: "table", content: rowNodes }, next: i };
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

interface ListParseResult {
  node: JSONContent;
  /** Content that can't legally live inside this list's items (see taskItem note up top); spliced in right after the list. */
  extra: JSONContent[];
  next: number;
}

function sameMarkerKind(line: string, indent: number, kind: MarkerMatch["kind"], bulletChar: string | null): boolean {
  const m = matchMarker(line.slice(indent));
  if (!m || m.kind !== kind) return false;
  if (kind === "bullet" && line[indent] !== bulletChar) return false;
  return true;
}

/** taskItem is `paragraph+` only. Leading paragraphs stay; everything else is hoisted out (a nested taskList is flattened specially by the caller). */
function restrictToTaskItemContent(body: JSONContent[], ctx: ImportCtx): { content: JSONContent[]; overflow: JSONContent[] } {
  const content: JSONContent[] = [];
  const overflow: JSONContent[] = [];
  let sawOther = false;
  for (const node of body) {
    if (!sawOther && node.type === "paragraph") {
      content.push(node);
    } else {
      sawOther = true;
      overflow.push(node);
    }
  }
  if (content.length === 0) content.push({ type: "paragraph" });
  if (overflow.some((n) => n.type !== "taskList")) {
    warn(ctx, "Checklist item content beyond plain paragraphs moved after the list (task items support paragraphs only)");
  }
  return { content, overflow };
}

function parseList(lines: string[], start: number, ctx: ImportCtx): ListParseResult {
  const startIndent = leadingSpaces(lines[start]);
  const first = matchMarker(lines[start].slice(startIndent));
  if (!first) {
    // Unreachable given the caller's guard, but keep this function total.
    return { node: { type: "paragraph" }, extra: [], next: start + 1 };
  }
  const kind = first.kind;
  const bulletChar = kind === "bullet" ? lines[start][startIndent] : null;
  const orderedStart = first.num ?? 1;

  const items: JSONContent[] = [];
  const extraAfter: JSONContent[] = [];
  let i = start;

  while (i < lines.length) {
    if (isBlank(lines[i])) {
      const la = i + 1;
      if (la < lines.length && leadingSpaces(lines[la]) === startIndent && sameMarkerKind(lines[la], startIndent, kind, bulletChar)) {
        i = la; // a single blank line between items of the same list doesn't end it
        continue;
      }
      break;
    }
    if (leadingSpaces(lines[i]) !== startIndent) break;
    const m = matchMarker(lines[i].slice(startIndent));
    if (!m || m.kind !== kind) break;
    if (kind === "bullet" && lines[i][startIndent] !== bulletChar) break;

    const contentCol = startIndent + m.indentWidth;
    const itemLines: string[] = [m.rest];
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (isBlank(line)) {
        if (i + 1 < lines.length && !isBlank(lines[i + 1]) && leadingSpaces(lines[i + 1]) >= contentCol) {
          itemLines.push("");
          i++;
          continue;
        }
        break;
      }
      if (leadingSpaces(line) >= contentCol) {
        itemLines.push(line.slice(contentCol));
        i++;
        continue;
      }
      break;
    }

    const rawBody = parseBlockLines(itemLines, { allowIndentedCode: false }, ctx);

    if (kind === "task") {
      const { content, overflow } = restrictToTaskItemContent(rawBody, ctx);
      items.push({ type: "taskItem", attrs: { checked: m.checked ?? false }, content });
      for (const node of overflow) {
        if (node.type === "taskList") {
          warn(ctx, "Nested task list flattened into the parent list (task items can't be nested)");
          for (const child of node.content ?? []) items.push(child);
        } else {
          extraAfter.push(node);
        }
      }
    } else {
      const body = rawBody.length ? rawBody.slice() : [{ type: "paragraph" }];
      if (body[0]?.type !== "paragraph") body.unshift({ type: "paragraph" }); // listItem requires a leading paragraph
      items.push({ type: "listItem", content: body });
    }
  }

  let node: JSONContent;
  if (kind === "task") {
    node = { type: "taskList", content: items };
  } else if (kind === "ordered") {
    node = orderedStart !== 1 ? { type: "orderedList", attrs: { start: orderedStart }, content: items } : { type: "orderedList", content: items };
  } else {
    node = { type: "bulletList", content: items };
  }
  return { node, extra: extraAfter, next: i };
}

// ---------------------------------------------------------------------------
// Paragraphs, setext headings, and image splitting
// ---------------------------------------------------------------------------

/** Reverses escapeBlockLeading (serialize.ts:42-44) — only ever applied at the very start of a paragraph. */
function unescapeBlockLeading(text: string): string {
  return text.replace(/^\\(?=(#{1,6}\s|>\s|[-*+]\s|\d+\.\s))/, "");
}

/** Joins a paragraph's source lines into one string, turning a trailing "two spaces" line ending into a hardBreak sentinel. */
function joinParagraphLines(paraLines: string[]): string {
  let out = "";
  for (let idx = 0; idx < paraLines.length; idx++) {
    const isLast = idx === paraLines.length - 1;
    const hard = !isLast && /  +$/.test(paraLines[idx]);
    const piece = paraLines[idx].replace(/ +$/, "");
    if (idx === 0) {
      out = piece;
    } else {
      out += out.endsWith(HARD_BREAK) ? piece : ` ${piece}`;
    }
    if (hard) out += HARD_BREAK;
  }
  return out;
}

function imageNode(alt: string, src: string): JSONContent {
  return { type: "image", attrs: { src, alt, title: null } };
}

/** Splits a paragraph's raw text on `![alt](src)`, skipping matches inside inline code spans. */
function splitParagraphOnImages(rawText: string, ctx: ImportCtx): JSONContent[] {
  const trimmed = rawText.trim();
  const sole = /^!\[([^\]]*)\]\(([^)]*)\)$/.exec(trimmed);
  if (sole) return [imageNode(sole[1], sole[2])];

  const codeRanges = findCodeSpanRanges(rawText);
  const IMG_RE = /!\[([^\]]*)\]\(([^)]*)\)/g;
  const segments: JSONContent[] = [];
  let lastIndex = 0;
  let found = false;
  let m: RegExpExecArray | null;
  while ((m = IMG_RE.exec(rawText))) {
    if (inRanges(codeRanges, m.index)) continue;
    found = true;
    // Trim the whitespace that was only ever separating text from the image
    // marker — the image becomes its own block, so that space carries no
    // content of its own.
    const before = rawText.slice(lastIndex, m.index).replace(/[ \t]+$/, "");
    if (/\S/.test(before)) segments.push({ type: "paragraph", content: parseInline(before, ctx) });
    segments.push(imageNode(m[1], m[2]));
    lastIndex = IMG_RE.lastIndex;
    warn(ctx, "Image inside a paragraph split into a separate block");
  }
  if (!found) {
    const inline = parseInline(rawText, ctx);
    return [inline.length ? { type: "paragraph", content: inline } : { type: "paragraph" }];
  }
  const after = rawText.slice(lastIndex).replace(/^[ \t]+/, "");
  if (/\S/.test(after)) segments.push({ type: "paragraph", content: parseInline(after, ctx) });
  return segments;
}

function parseParagraphOrSetext(lines: string[], start: number, ctx: ImportCtx): { nodes: JSONContent[]; next: number } {
  const paraLines: string[] = [];
  let j = start;
  while (j < lines.length) {
    const line = lines[j];
    if (isBlank(line)) break;
    if (paraLines.length > 0 && SETEXT_RE.test(line)) break;
    if (paraLines.length > 0 && isBlockStart(line)) break;
    paraLines.push(line);
    j++;
  }
  if (j < lines.length && paraLines.length > 0 && SETEXT_RE.test(lines[j])) {
    const level = lines[j].trim()[0] === "=" ? 1 : 2;
    const raw = unescapeBlockLeading(joinParagraphLines(paraLines));
    const inline = parseInline(raw, ctx);
    return { nodes: [{ type: "heading", attrs: { level }, content: inline }], next: j + 1 };
  }
  const raw = unescapeBlockLeading(joinParagraphLines(paraLines));
  return { nodes: splitParagraphOnImages(raw, ctx), next: j };
}

// ---------------------------------------------------------------------------
// The generic block parser — used for the doc top level, blockquote/callout/
// toggle bodies, and list item bodies alike (nested lists fall out for free
// by recursing back into this same function on dedented sublines).
// ---------------------------------------------------------------------------

interface BlockOpts {
  /** Indented (4-space/tab) code blocks only apply outside lists, right after a blank line. */
  allowIndentedCode: boolean;
}

function parseBlockLines(lines: string[], opts: BlockOpts, ctx: ImportCtx): JSONContent[] {
  const out: JSONContent[] = [];
  let i = 0;
  let prevBlank = true;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      prevBlank = true;
      continue;
    }

    const atx = matchAtxHeading(line);
    if (atx) {
      let level = atx.level;
      if (level > 4) {
        warn(ctx, `Heading level ${level} clamped to 4`);
        level = 4;
      }
      out.push({ type: "heading", attrs: { level }, content: parseInline(atx.text, ctx) });
      i++;
      prevBlank = false;
      continue;
    }

    const fence = matchFenceOpen(line);
    if (fence) {
      const { text, next } = collectFence(lines, i + 1, fence, ctx);
      out.push({ type: "codeBlock", attrs: { language: fence.lang || null }, content: text ? [{ type: "text", text }] : [] });
      i = next;
      prevBlank = false;
      continue;
    }

    if (opts.allowIndentedCode && prevBlank && leadingSpaces(line) >= 4) {
      const { text, next } = collectIndentedCode(lines, i);
      out.push({ type: "codeBlock", attrs: { language: null }, content: text ? [{ type: "text", text }] : [] });
      i = next;
      prevBlank = false;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const header = /^ {0,3}>( ?)(.*)$/.exec(line)!;
      const { raw: contRaw, next } = collectQuoteLines(lines, i + 1);
      const obs = tryObsidianCalloutOrToggle(header[2], contRaw, ctx);
      if (obs) {
        out.push(obs);
      } else {
        const body = parseBlockLines([header[2], ...contRaw], { allowIndentedCode: true }, ctx);
        out.push({ type: "blockquote", content: body.length ? body : [{ type: "paragraph" }] });
      }
      i = next;
      prevBlank = false;
      continue;
    }

    if (leadingSpaces(line) <= 3 && isThematicBreak(line.trim())) {
      out.push({ type: "horizontalRule" });
      i++;
      prevBlank = false;
      continue;
    }

    if (leadingSpaces(line) <= 3 && matchMarker(line.slice(leadingSpaces(line)))) {
      const { node, extra, next } = parseList(lines, i, ctx);
      out.push(node, ...extra);
      i = next;
      prevBlank = false;
      continue;
    }

    if (i + 1 < lines.length && line.includes("|") && isTableDelimiterRow(lines[i + 1])) {
      const { node, next } = buildTable(lines, i, ctx);
      out.push(node);
      i = next;
      prevBlank = false;
      continue;
    }

    if (isHtmlBlockStart(line)) {
      const { text, next } = collectRawHtmlBlock(lines, i);
      warn(ctx, "Raw HTML block kept as plain text");
      out.push({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
      i = next;
      prevBlank = false;
      continue;
    }

    const { nodes, next } = parseParagraphOrSetext(lines, i, ctx);
    out.push(...nodes);
    i = next;
    prevBlank = false;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Title resolution
// ---------------------------------------------------------------------------

function resolveTitle(frontmatter: Record<string, string>, content: JSONContent[]): string | null {
  if (frontmatter.title && frontmatter.title.trim().length > 0) return frontmatter.title;
  const first = content[0];
  if (first && first.type === "heading" && first.attrs?.level === 1) {
    const text = flattenInlineText(first.content ?? []).trim();
    if (text.length > 0) return text;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function markdownToDoc(markdown: string): MarkdownImportResult {
  const ctx: ImportCtx = { warnings: [], wikilinkSeen: new Set(), wikilinks: [] };
  try {
    const normalized = (markdown ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\u0000/g, "");
    const rawLines = normalized.split("\n");
    // A string ending in "\n" splits with a trailing "" that isn't a real
    // blank line, just the newline terminating the line before it — drop it
    // so an unclosed fence/paragraph doesn't pick up a phantom trailing line.
    if (rawLines.length > 1 && rawLines[rawLines.length - 1] === "") rawLines.pop();
    const lines = rawLines.map(expandLeadingTabs);
    const { frontmatter, bodyLines } = extractFrontmatter(lines);
    const content = parseBlockLines(bodyLines, { allowIndentedCode: true }, ctx);
    const docContent = content.length > 0 ? content : [{ type: "paragraph" }];
    const title = resolveTitle(frontmatter, docContent);
    return {
      doc: { type: "doc", content: docContent },
      frontmatter,
      title,
      wikilinks: ctx.wikilinks,
      warnings: Array.from(new Set(ctx.warnings)),
    };
  } catch {
    // Should be unreachable — every helper above is written to degrade rather
    // than throw — but a Markdown import must never be able to crash a save.
    return {
      doc: { type: "doc", content: [{ type: "paragraph" }] },
      frontmatter: {},
      title: null,
      wikilinks: [],
      warnings: ["Failed to parse this document's Markdown; imported as an empty page"],
    };
  }
}
