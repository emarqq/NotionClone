/**
 * Heading-aware chunker: groups ordered segments by heading path and splits
 * each group into ~400-token windows with ~40-token overlap. Pure/sync — no
 * I/O, safe to unit-test without "server-only".
 */

import { createHash } from "node:crypto";

export interface Segment {
  headingPath: string[];
  text: string;
}

export interface Chunk {
  content: string;
  headingPath: string[];
  chunkIndex: number;
  contentHash: string;
  tokenCount: number;
}

const TARGET_TOKENS = 400;
const OVERLAP_TOKENS = 40;

/** chars/4 heuristic — good enough for chunk sizing, not exact BPE counts. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Builds the `breadcrumb > heading > path` context line prefixed to a chunk. */
function contextLine(breadcrumb: string, headingPath: string[]): string {
  return [breadcrumb, ...headingPath].filter(Boolean).join(" > ");
}

/**
 * Splits `text` (already whitespace-normalized) into ~targetTokens windows,
 * each overlapping the previous by ~overlapTokens, breaking on word
 * boundaries. Returns [] for empty input.
 */
function splitIntoWindows(
  text: string,
  targetTokens: number,
  overlapTokens: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const targetChars = targetTokens * 4;
  const overlapChars = overlapTokens * 4;
  const windows: string[] = [];
  let start = 0;

  while (start < words.length) {
    let charCount = 0;
    let end = start;
    while (end < words.length && (charCount < targetChars || end === start)) {
      charCount += words[end].length + 1;
      end++;
    }
    windows.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;

    // Back up from `end` by ~overlapChars worth of words for the next window.
    let backChars = 0;
    let newStart = end;
    while (newStart > start && backChars < overlapChars) {
      newStart--;
      backChars += words[newStart].length + 1;
    }
    start = newStart > start ? newStart : end;
  }

  return windows;
}

/** Groups consecutive segments that share the same heading path. */
function groupByHeadingPath(segments: Segment[]): Segment[][] {
  const groups: Segment[][] = [];
  let current: Segment[] = [];
  let currentKey: string | null = null;

  for (const segment of segments) {
    const key = JSON.stringify(segment.headingPath);
    if (currentKey !== null && key === currentKey) {
      current.push(segment);
    } else {
      if (current.length > 0) groups.push(current);
      current = [segment];
      currentKey = key;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/**
 * Chunks ordered segments into ~400-token, heading-aware windows. Each
 * chunk's content is prefixed with a `breadcrumb > heading path` context
 * line followed by a blank line, then hashed (sha256 hex) for stale-chunk
 * diffing in lib/rag/ingest.ts.
 */
export function chunkSegments(segments: Segment[], breadcrumb: string): Chunk[] {
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const group of groupByHeadingPath(segments)) {
    const headingPath = group[0].headingPath;
    const groupText = group
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join("\n\n");
    if (!groupText) continue;

    const windows = splitIntoWindows(groupText, TARGET_TOKENS, OVERLAP_TOKENS);
    for (const window of windows) {
      const content = `${contextLine(breadcrumb, headingPath)}\n\n${window}`;
      chunks.push({
        content,
        headingPath,
        chunkIndex: chunkIndex++,
        contentHash: createHash("sha256").update(content).digest("hex"),
        tokenCount: estimateTokens(content),
      });
    }
  }

  return chunks;
}
