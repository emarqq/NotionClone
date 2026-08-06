import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { runOrThrow } from "@/lib/meetings/proc";
import type { Transcriber, TranscribeOptions, TranscriptSegment } from "../types";

/**
 * whisper.cpp via the Homebrew `whisper-cpp` formula.
 *
 * Verified on this machine (2026-08-04, formula 1.9.1): the binary is
 * `whisper-cli` — upstream renamed it from `main`, and the formula has shipped
 * both names historically, so the path is probed rather than hardcoded. Metal is
 * enabled in the bottle and needs no flag; `whisper-cli` prints
 * `ggml_metal_device_init: GPU name: …` to stderr when the GPU is in use.
 */

const BIN_CANDIDATES = [
  "/opt/homebrew/bin/whisper-cli",
  "/opt/homebrew/bin/whisper-cpp",
  "/usr/local/bin/whisper-cli",
  "/usr/local/bin/whisper-cpp",
];

const DEFAULT_MODEL = "~/.cache/whisper-cpp/ggml-large-v3-turbo.bin";

function expandHome(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/** The exact JSON whisper-cli writes with `-oj` (see tests/meetings/fixtures). */
interface WhisperCppJson {
  transcription?: Array<{
    offsets?: { from?: number; to?: number };
    text?: string;
  }>;
}

/**
 * Resolve a usable whisper.cpp install, or null.
 *
 * Requires BOTH the binary and the model file. An installed binary with no model
 * is worse than no install at all: it would win detection and then fail on the
 * first real meeting, which is exactly the failure you cannot afford to discover
 * after an interview.
 */
export async function probeWhisperCpp(): Promise<Transcriber | null> {
  const explicit = process.env.WHISPER_CPP_BIN;
  const candidates = explicit ? [explicit, ...BIN_CANDIDATES] : BIN_CANDIDATES;

  let bin: string | null = null;
  for (const c of candidates) {
    if (await isExecutable(c)) {
      bin = c;
      break;
    }
  }
  if (!bin) return null;

  const model = expandHome(process.env.WHISPER_CPP_MODEL || DEFAULT_MODEL);
  if (!(await fileExists(model))) return null;

  const modelName = path.basename(model).replace(/^ggml-|\.bin$/g, "");
  const resolvedBin = bin;

  return {
    id: "whisper-cpp",
    label: `${modelName} (Metal)`,
    async transcribe(
      wavPath: string,
      opts: TranscribeOptions
    ): Promise<TranscriptSegment[]> {
      // `-of` is an output path WITHOUT extension; whisper-cli appends `.json`.
      const prefix = path.join(
        opts.outDir,
        path.basename(wavPath, path.extname(wavPath))
      );
      await runOrThrow("whisper.cpp", resolvedBin, [
        "-m", model,
        "-f", wavPath,
        "-oj",
        "-of", prefix,
        "-l", opts.language || "en",
        "-t", String(Math.min(8, os.cpus().length)),
        "-np",
      ], { signal: opts.signal });

      const raw = await fs.readFile(`${prefix}.json`, "utf8");
      return parseWhisperCppJson(raw);
    },
  };
}

/**
 * Parse whisper.cpp `-oj` output.
 *
 * Reads `offsets` (integer milliseconds), NOT `timestamps` — the latter is a
 * `HH:MM:SS,mmm` string that would need reparsing and loses nothing useful.
 * This is the half of the unit mismatch with the python engine that makes the
 * adapter worth having; both are pinned by tests/meetings/parseWhisper.test.ts.
 */
export function parseWhisperCppJson(raw: string): TranscriptSegment[] {
  const parsed = JSON.parse(raw) as WhisperCppJson;
  const out: TranscriptSegment[] = [];
  for (const seg of parsed.transcription ?? []) {
    const text = (seg.text ?? "").trim();
    if (!text) continue;
    out.push({
      startMs: Math.max(0, Math.round(seg.offsets?.from ?? 0)),
      endMs: Math.max(0, Math.round(seg.offsets?.to ?? 0)),
      text,
    });
  }
  return out;
}
