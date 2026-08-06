/**
 * Whisper JSON parsing, pinned against REAL output from both engines.
 *
 * The fixtures in ./fixtures were produced by actually running each binary on
 * this machine (whisper.cpp large-v3-turbo and python whisper base) — not
 * hand-written, because the entire point of this layer is that the two engines
 * disagree about units: whisper.cpp reports integer MILLISECONDS in `offsets`,
 * python whisper reports float SECONDS in `start`/`end`.
 *
 * Getting that conversion wrong doesn't crash. It yields turns 1000x too short,
 * which collapse into one unreadable blob during merge. That silence is why this
 * file exists.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseWhisperCppJson } from "@/lib/transcribe/providers/whisperCpp";
import { parseWhisperPythonJson } from "@/lib/transcribe/providers/whisperPython";

const fixture = (name: string) =>
  readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("parseWhisperCppJson", () => {
  const segments = parseWhisperCppJson(fixture("whisper-cpp.json"));

  it("reads offsets as milliseconds", () => {
    expect(segments[0]).toEqual({
      startMs: 0,
      endMs: 2400,
      text: "Hey, thanks for jumping on the call today.",
    });
    expect(segments[1].startMs).toBe(2740);
    expect(segments[1].endMs).toBe(6260);
  });

  it("trims whisper's leading space on every segment", () => {
    expect(segments.every((s) => s.text === s.text.trim())).toBe(true);
    expect(segments.every((s) => !s.text.startsWith(" "))).toBe(true);
  });

  it("tolerates missing/empty transcription arrays", () => {
    expect(parseWhisperCppJson("{}")).toEqual([]);
    expect(parseWhisperCppJson('{"transcription":[]}')).toEqual([]);
    expect(parseWhisperCppJson('{"transcription":[{"text":"   "}]}')).toEqual([]);
  });

  it("defaults absent offsets to 0 rather than NaN", () => {
    const out = parseWhisperCppJson('{"transcription":[{"text":"hi"}]}');
    expect(out).toEqual([{ startMs: 0, endMs: 0, text: "hi" }]);
  });
});

describe("parseWhisperPythonJson", () => {
  const segments = parseWhisperPythonJson(fixture("whisper-python.json"));

  it("converts float seconds to integer milliseconds", () => {
    expect(segments[0].startMs).toBe(0);
    expect(segments[0].endMs).toBe(4640); // 4.64s in the fixture
    expect(Number.isInteger(segments[0].endMs)).toBe(true);
  });

  it("trims text", () => {
    expect(segments.every((s) => s.text === s.text.trim())).toBe(true);
  });

  it("tolerates missing/empty segment arrays", () => {
    expect(parseWhisperPythonJson("{}")).toEqual([]);
    expect(parseWhisperPythonJson('{"segments":[]}')).toEqual([]);
  });

  it("rounds sub-millisecond values instead of truncating to NaN", () => {
    const out = parseWhisperPythonJson(
      '{"segments":[{"start":1.2345,"end":2.9999,"text":"x"}]}'
    );
    expect(out).toEqual([{ startMs: 1235, endMs: 3000, text: "x" }]);
  });
});

describe("cross-engine agreement", () => {
  it("both engines yield the same normalised shape for the same audio", () => {
    // Same source wav, different engines. Not asserting identical text (the
    // models genuinely differ), only that the contract downstream code relies
    // on holds for both.
    const cpp = parseWhisperCppJson(fixture("whisper-cpp.json"));
    const py = parseWhisperPythonJson(fixture("whisper-python.json"));

    for (const segments of [cpp, py]) {
      expect(segments.length).toBeGreaterThan(0);
      for (const s of segments) {
        expect(Number.isInteger(s.startMs)).toBe(true);
        expect(Number.isInteger(s.endMs)).toBe(true);
        expect(s.endMs).toBeGreaterThanOrEqual(s.startMs);
        expect(s.text.length).toBeGreaterThan(0);
      }
    }

    // Both transcribed the same ~6 second clip, so the last end offset should
    // land in the same ballpark — this is what catches a units regression.
    const cppEnd = cpp[cpp.length - 1].endMs;
    const pyEnd = py[py.length - 1].endMs;
    expect(Math.abs(cppEnd - pyEnd)).toBeLessThan(3000);
    expect(cppEnd).toBeGreaterThan(3000);
  });
});
