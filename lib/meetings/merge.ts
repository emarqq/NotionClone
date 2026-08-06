/**
 * Interleaving two per-channel transcripts into one labeled turn list, and
 * rendering that into editor blocks.
 *
 * PURE — no node imports, no `server-only`. The pipeline calls it on the server
 * and the recording bar calls it in the browser, exactly like
 * `lib/import/markdownToDoc.ts`. Keep it that way: it is also the only part of
 * this feature whose bugs are invisible (a wrong speaker label just looks like a
 * confusing meeting), so it has to stay unit-testable without a filesystem.
 */

import type { JSONContent } from "@tiptap/core";

import type { LabeledTurn } from "./types";
import type { TranscriptSegment } from "@/lib/transcribe/types";

export interface MergeOptions {
  /** Break a turn once it gets this long, so paragraphs stay skimmable. */
  maxTurnChars?: number;
  /** Break a turn that runs longer than this. */
  maxTurnMs?: number;
  /** Silence longer than this starts a new turn even for the same speaker. */
  gapMs?: number;
  /** Added to every `system` segment. Only needed if the two tracks ever come
   *  from independent recorders; the shared-AudioContext capture makes it 0. */
  systemOffsetMs?: number;
}

const DEFAULTS = {
  maxTurnChars: 700,
  maxTurnMs: 45_000,
  gapMs: 3_000,
  systemOffsetMs: 0,
};

/**
 * Whisper's well-known silence hallucinations.
 *
 * Both engines emit these when handed near-silence — "Thank you." and
 * "Subtitles by the Amara.org community" are artifacts of their training data,
 * not speech. They matter more here than in a normal transcript because a
 * hallucinated segment on the system track invents an entire fake speaker turn.
 * The volumedetect gate in ffmpeg.ts is the first line of defence; this is the
 * second, for tracks that are quiet but not silent enough to skip.
 */
const HALLUCINATION_RE =
  /^(thank you|thanks for watching|thanks for listening|you|bye|okay|so|um|uh|subtitles? by.*|amara\.org.*|\[.*\]|\(.*\)|♪.*|music|silence)[.!?]?$/i;

export function dropHallucinations(
  segments: TranscriptSegment[]
): TranscriptSegment[] {
  return segments.filter((s) => {
    const t = s.text.trim();
    if (!t) return false;
    // Only drop a suspicious phrase when it is the WHOLE segment — "Thank you"
    // inside a real sentence is just speech.
    return !HALLUCINATION_RE.test(t);
  });
}

/**
 * Interleave the two channels into speaker-labeled turns.
 *
 * Coalescing runs of the same speaker is not cosmetic: raw whisper segments are
 * ~5-second sentences, so an uncoalesced 60-minute call becomes ~700 three-word
 * paragraphs — unreadable for a human skim and needlessly token-hungry for the
 * later LLM pass this transcript exists to feed.
 */
export function mergeTurns(
  mic: TranscriptSegment[],
  system: TranscriptSegment[],
  options: MergeOptions = {}
): LabeledTurn[] {
  const opts = { ...DEFAULTS, ...options };

  const tagged: LabeledTurn[] = [
    ...dropHallucinations(mic).map((s) => ({
      speaker: "you" as const,
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text.trim(),
    })),
    ...dropHallucinations(system).map((s) => ({
      speaker: "them" as const,
      startMs: s.startMs + opts.systemOffsetMs,
      endMs: s.endMs + opts.systemOffsetMs,
      text: s.text.trim(),
    })),
  ];

  // Deterministic ordering: by start time, then `you` first on an exact tie.
  // The tie-break is arbitrary but must be stable, or the tests flake.
  tagged.sort((a, b) =>
    a.startMs !== b.startMs
      ? a.startMs - b.startMs
      : a.speaker === b.speaker
        ? 0
        : a.speaker === "you"
          ? -1
          : 1
  );

  const turns: LabeledTurn[] = [];
  for (const seg of tagged) {
    const open = turns[turns.length - 1];
    const canExtend =
      open &&
      open.speaker === seg.speaker &&
      seg.startMs - open.endMs <= opts.gapMs &&
      open.text.length + seg.text.length + 1 <= opts.maxTurnChars &&
      seg.endMs - open.startMs <= opts.maxTurnMs;

    if (canExtend) {
      open.text = `${open.text} ${seg.text}`.trim();
      open.endMs = Math.max(open.endMs, seg.endMs);
    } else {
      turns.push({ ...seg });
    }
  }
  return turns;
}

/** `[H:]MM:SS` clock offset from the start of the recording. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export interface TranscriptLabels {
  you: string;
  them: string;
}

/**
 * Render turns as top-level editor nodes: one H2 header, then one paragraph per
 * turn prefixed with a bold `[mm:ss] Speaker:`.
 *
 * Plain paragraphs rather than a toggle on purpose. The stated downstream is
 * "select this and hand it to Claude" — collapsed toggle content is invisible to
 * in-page find, easy to miss when selecting, and has a bespoke serialization in
 * lib/export/serialize.ts. Timestamps stay in because they are trivially
 * strippable with one regex but impossible to reconstruct later.
 *
 * Emits NO `blockId`: on the editor path the BlockId extension mints UUIDs on
 * insert, and on the server path app/actions/recordings.ts assigns them to match
 * the row ids. One generator, two consumers, no divergence.
 */
export function turnsToBlocks(
  turns: LabeledTurn[],
  header: string,
  labels: TranscriptLabels = { you: "You", them: "Them" }
): JSONContent[] {
  const blocks: JSONContent[] = [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: header }],
    },
  ];

  if (turns.length === 0) {
    blocks.push({
      type: "paragraph",
      content: [{ type: "text", text: "(No speech was detected in this recording.)" }],
    });
    return blocks;
  }

  for (const turn of turns) {
    const who = turn.speaker === "you" ? labels.you : labels.them;
    blocks.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          marks: [{ type: "bold" }],
          text: `[${formatClock(turn.startMs)}] ${who}: `,
        },
        { type: "text", text: turn.text },
      ],
    });
  }
  return blocks;
}

/** Plain-text mirror written next to the audio, so a failed insert still leaves
 *  something readable on disk. */
export function turnsToMarkdown(
  turns: LabeledTurn[],
  header: string,
  labels: TranscriptLabels = { you: "You", them: "Them" }
): string {
  const lines = [`## ${header}`, ""];
  for (const turn of turns) {
    const who = turn.speaker === "you" ? labels.you : labels.them;
    lines.push(`**[${formatClock(turn.startMs)}] ${who}:** ${turn.text}`, "");
  }
  return lines.join("\n");
}
