/**
 * Frontmatter assembly via gray-matter (js-yaml under the hood) — NEVER by
 * hand-concatenating YAML. js-yaml correctly quotes wikilink values like
 * "[[Parent]]" (which would otherwise parse as a YAML flow sequence) and
 * escapes anything else that needs it. Pure — no I/O.
 */

import matter from "gray-matter";

export interface FrontmatterData {
  id: string;
  title: string;
  icon?: string;
  created?: string;
  updated?: string;
  /** `"[[Parent basename]]"` — omitted for top-level pages. */
  parent?: string;
  /** Durable secondary handle: `[pageId]`. */
  aliases?: string[];
  archived?: boolean;
}

/** Build a complete `.md` file string (`---` YAML `---` + body). Key order follows `data`. */
export function buildMarkdownFile(data: FrontmatterData, body: string): string {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    clean[key] = value;
  }
  const trimmed = body.trim();
  return matter.stringify(trimmed ? `${trimmed}\n` : "", clean);
}
