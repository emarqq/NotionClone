/**
 * Interleaving the two audio channels into a labeled transcript.
 *
 * This is the one part of meeting recording whose bugs are INVISIBLE: a wrong
 * speaker label, a dropped turn or a bad coalesce doesn't throw, it just reads
 * as a slightly confusing meeting — and by the time anyone notices, the audio
 * context for the interview is long gone. Hence the coverage.
 */

import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";

import { EDITOR_EXTENSIONS } from "@/components/editor/editorExtensions";
import {
  dropHallucinations,
  formatClock,
  mergeTurns,
  turnsToBlocks,
  turnsToMarkdown,
} from "@/lib/meetings/merge";
import type { TranscriptSegment } from "@/lib/transcribe/types";

const seg = (startMs: number, endMs: number, text: string): TranscriptSegment => ({
  startMs,
  endMs,
  text,
});

describe("mergeTurns", () => {
  it("labels mic segments 'you' and system segments 'them'", () => {
    const turns = mergeTurns([seg(0, 1000, "Hello there")], [seg(2000, 3000, "Hi back")]);
    expect(turns.map((t) => [t.speaker, t.text])).toEqual([
      ["you", "Hello there"],
      ["them", "Hi back"],
    ]);
  });

  it("orders strictly by start time across channels", () => {
    // Deliberately fed out of order, and spaced past the 3s gap so they stay
    // three separate turns rather than coalescing.
    const turns = mergeTurns(
      [seg(5000, 6000, "second"), seg(0, 1000, "first")],
      [seg(10_000, 11_000, "third")]
    );
    expect(turns.map((t) => t.text)).toEqual(["first", "second", "third"]);
  });

  it("breaks ties deterministically with 'you' first", () => {
    const a = mergeTurns([seg(1000, 2000, "mine")], [seg(1000, 2000, "theirs")]);
    const b = mergeTurns([seg(1000, 2000, "mine")], [seg(1000, 2000, "theirs")]);
    expect(a[0].speaker).toBe("you");
    expect(a).toEqual(b);
  });

  it("coalesces consecutive same-speaker segments into one turn", () => {
    const turns = mergeTurns(
      [seg(0, 2000, "One."), seg(2100, 4000, "Two."), seg(4100, 6000, "Three.")],
      []
    );
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe("One. Two. Three.");
    expect(turns[0].startMs).toBe(0);
    expect(turns[0].endMs).toBe(6000);
  });

  it("starts a new turn when the other speaker interjects", () => {
    const turns = mergeTurns(
      [seg(0, 1000, "A1"), seg(4000, 5000, "A2")],
      [seg(2000, 3000, "B1")]
    );
    expect(turns.map((t) => [t.speaker, t.text])).toEqual([
      ["you", "A1"],
      ["them", "B1"],
      ["you", "A2"],
    ]);
  });

  it("breaks a same-speaker run across a long silence", () => {
    const turns = mergeTurns([seg(0, 1000, "before"), seg(20_000, 21_000, "after")], []);
    expect(turns).toHaveLength(2);
  });

  it("breaks a turn that exceeds maxTurnChars", () => {
    const long = "x".repeat(400);
    const turns = mergeTurns([seg(0, 1000, long), seg(1100, 2000, long)], [], {
      maxTurnChars: 500,
    });
    expect(turns).toHaveLength(2);
  });

  it("applies systemOffsetMs (the two-recorder fallback path)", () => {
    const turns = mergeTurns([seg(0, 1000, "mic")], [seg(0, 1000, "sys")], {
      systemOffsetMs: 5000,
    });
    expect(turns[1].startMs).toBe(5000);
  });

  it("returns an empty list for two empty channels", () => {
    expect(mergeTurns([], [])).toEqual([]);
  });

  it("handles a fully one-sided recording (silent system channel)", () => {
    const turns = mergeTurns([seg(0, 1000, "solo")], []);
    expect(turns).toEqual([
      { speaker: "you", startMs: 0, endMs: 1000, text: "solo" },
    ]);
  });
});

describe("dropHallucinations", () => {
  it("drops whole-segment whisper silence artifacts", () => {
    const kept = dropHallucinations([
      seg(0, 1, "Thank you."),
      seg(1, 2, "Subtitles by the Amara.org community"),
      seg(2, 3, "[BLANK_AUDIO]"),
      seg(3, 4, "♪♪♪"),
      seg(4, 5, ""),
      seg(5, 6, "Real speech here."),
    ]);
    expect(kept.map((s) => s.text)).toEqual(["Real speech here."]);
  });

  it("keeps a suspicious phrase that is part of a real sentence", () => {
    const kept = dropHallucinations([seg(0, 1, "Thank you for walking me through it.")]);
    expect(kept).toHaveLength(1);
  });

  it("does not let a hallucination fabricate a speaker turn", () => {
    // A silent system channel that yielded only "Thank you." must contribute
    // nothing — otherwise the transcript invents a person who never spoke.
    const turns = mergeTurns([seg(0, 1000, "Only I spoke.")], [seg(0, 500, "Thank you.")]);
    expect(turns.every((t) => t.speaker === "you")).toBe(true);
  });
});

describe("formatClock", () => {
  it("formats mm:ss under an hour and h:mm:ss beyond", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(4000)).toBe("00:04");
    expect(formatClock(65_000)).toBe("01:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });

  it("clamps negatives rather than emitting garbage", () => {
    expect(formatClock(-500)).toBe("00:00");
  });
});

describe("turnsToBlocks", () => {
  const schema = getSchema(EDITOR_EXTENSIONS);

  it("emits a heading followed by one paragraph per turn", () => {
    const blocks = turnsToBlocks(
      [
        { speaker: "you", startMs: 4000, endMs: 6000, text: "Hello." },
        { speaker: "them", startMs: 7000, endMs: 9000, text: "Hi." },
      ],
      "Transcript — test"
    );
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe("heading");
    expect(blocks[1].type).toBe("paragraph");
  });

  it("bolds only the [timestamp] Speaker: prefix", () => {
    const [, first] = turnsToBlocks(
      [{ speaker: "you", startMs: 4000, endMs: 6000, text: "Hello." }],
      "h"
    );
    const content = first.content as Array<{ text: string; marks?: unknown[] }>;
    expect(content[0].text).toBe("[00:04] You: ");
    expect(content[0].marks).toEqual([{ type: "bold" }]);
    expect(content[1].text).toBe("Hello.");
    expect(content[1].marks).toBeUndefined();
  });

  it("never sets blockId — BlockId mints ids on insert", () => {
    const blocks = turnsToBlocks(
      [{ speaker: "you", startMs: 0, endMs: 1, text: "x" }],
      "h"
    );
    for (const b of blocks) {
      expect((b.attrs as Record<string, unknown> | undefined)?.blockId).toBeUndefined();
    }
  });

  it("produces schema-legal nodes in the real editor schema", () => {
    // A schema-illegal node would be silently dropped on insert, losing the
    // transcript with no error anywhere.
    const blocks = turnsToBlocks(
      [
        { speaker: "you", startMs: 0, endMs: 1000, text: "Legal?" },
        { speaker: "them", startMs: 2000, endMs: 3000, text: "Should be." },
      ],
      "Transcript — schema check"
    );
    const doc = PMNode.fromJSON(schema, { type: "doc", content: blocks });
    expect(() => doc.check()).not.toThrow();
    expect(doc.childCount).toBe(3);
  });

  it("still emits a heading and a note when nothing was said", () => {
    const blocks = turnsToBlocks([], "Transcript — empty");
    expect(blocks).toHaveLength(2);
    const doc = PMNode.fromJSON(schema, { type: "doc", content: blocks });
    expect(() => doc.check()).not.toThrow();
  });

  it("honours custom speaker labels", () => {
    const [, p] = turnsToBlocks(
      [{ speaker: "them", startMs: 0, endMs: 1, text: "Hi" }],
      "h",
      { you: "Erik", them: "Dana" }
    );
    const content = p.content as Array<{ text: string }>;
    expect(content[0].text).toBe("[00:00] Dana: ");
  });
});

describe("turnsToMarkdown", () => {
  it("mirrors the block output as readable markdown", () => {
    const md = turnsToMarkdown(
      [{ speaker: "you", startMs: 4000, endMs: 6000, text: "Hello." }],
      "Transcript — test"
    );
    expect(md).toContain("## Transcript — test");
    expect(md).toContain("**[00:04] You:** Hello.");
  });
});
