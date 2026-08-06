import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runOrThrow } from "@/lib/meetings/proc";
import type { Transcriber, TranscribeOptions, TranscriptSegment } from "../types";

/**
 * OpenAI's reference python `whisper` CLI — the fallback engine.
 *
 * Exists so the feature still works when whisper.cpp isn't installed or its
 * model download hasn't finished. Slower (CPU only; `--device mps` is NOT usable,
 * Whisper hits unimplemented sparse ops on Metal) and less accurate, but it was
 * already on this machine.
 */

const BIN_CANDIDATES = [
  "/Library/Frameworks/Python.framework/Versions/3.12/bin/whisper",
  "/opt/homebrew/bin/whisper",
  "/usr/local/bin/whisper",
];

/**
 * `base` is MANDATORY, not a default we happen to like: the CLI's own default is
 * `turbo`, and only `base.pt` is in ~/.cache/whisper — omitting this would kick
 * off a silent 1.5 GB download the first time someone stops a recording.
 */
const DEFAULT_MODEL = "base";

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The exact JSON the python CLI writes with `--output_format json`. */
interface WhisperPythonJson {
  segments?: Array<{ start?: number; end?: number; text?: string }>;
}

export async function probeWhisperPython(): Promise<Transcriber | null> {
  const explicit = process.env.WHISPER_PY_BIN;
  const candidates = explicit ? [explicit, ...BIN_CANDIDATES] : BIN_CANDIDATES;

  let bin: string | null = null;
  for (const c of candidates) {
    if (await isExecutable(c)) {
      bin = c;
      break;
    }
  }
  if (!bin) return null;

  const model = process.env.WHISPER_PY_MODEL || DEFAULT_MODEL;
  const resolvedBin = bin;

  return {
    id: "whisper-python",
    label: `${model} (CPU)`,
    async transcribe(
      wavPath: string,
      opts: TranscribeOptions
    ): Promise<TranscriptSegment[]> {
      await runOrThrow("whisper (python)", resolvedBin, [
        wavPath,
        "--model", model,
        "--model_dir", path.join(os.homedir(), ".cache", "whisper"),
        "--output_dir", opts.outDir,
        "--output_format", "json",
        "--language", opts.language || "en",
        "--task", "transcribe",
        "--device", "cpu",
        "--fp16", "False",
        "--verbose", "False",
      ], { signal: opts.signal });

      // Output lands at <outDir>/<input basename>.json.
      const out = path.join(
        opts.outDir,
        `${path.basename(wavPath, path.extname(wavPath))}.json`
      );
      return parseWhisperPythonJson(await fs.readFile(out, "utf8"));
    },
  };
}

/**
 * Parse python whisper JSON.
 *
 * `start`/`end` are FLOAT SECONDS here, against whisper.cpp's integer
 * milliseconds — the whole reason this adapter layer exists. Getting this
 * conversion wrong would produce a transcript whose turns are all 1000x too
 * short, which merges into a single unreadable blob rather than an obvious crash.
 */
export function parseWhisperPythonJson(raw: string): TranscriptSegment[] {
  const parsed = JSON.parse(raw) as WhisperPythonJson;
  const out: TranscriptSegment[] = [];
  for (const seg of parsed.segments ?? []) {
    const text = (seg.text ?? "").trim();
    if (!text) continue;
    out.push({
      startMs: Math.max(0, Math.round((seg.start ?? 0) * 1000)),
      endMs: Math.max(0, Math.round((seg.end ?? 0) * 1000)),
      text,
    });
  }
  return out;
}
