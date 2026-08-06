import { formatClock } from "./merge";
import type { RecordingMeta } from "./types";

/**
 * The H2 line that heads an inserted transcript.
 *
 * Pure and shared so the server-written transcript.md and the client-inserted
 * blocks can never disagree about what a recording is called.
 *
 * e.g. "Transcript — Aug 4, 2026, 9:14 AM · 47:32 · large-v3-turbo (Metal)"
 */
export function transcriptHeader(meta: RecordingMeta): string {
  const when = new Date(meta.startedAtMs || Date.parse(meta.createdAt));
  const stamp = when.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const parts = [`Transcript — ${stamp}`];
  if (meta.durationMs) parts.push(formatClock(meta.durationMs));
  if (meta.transcriberLabel) parts.push(meta.transcriberLabel);
  return parts.join(" · ");
}
