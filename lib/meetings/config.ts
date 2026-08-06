import "server-only";

import os from "node:os";
import path from "node:path";

/**
 * Where recordings live.
 *
 * Deliberately OUTSIDE the Obsidian vault root (`lib/export/config.ts`): the
 * exporter reconciles orphans under its own subtree and deletes what it doesn't
 * recognise, and audio must never be in reach of that pass. It is also outside
 * the repo so `next build` never tries to bundle a gigabyte of webm.
 */
const DEFAULT_RECORDINGS_DIR = "~/NotionCloneRecordings";

/** Homebrew's ffmpeg. Absolute because the Electron child env's PATH is minimal
 *  (`desktop/electron/src/main.js` childEnv) — never rely on PATH here. */
const DEFAULT_FFMPEG_BIN = "/opt/homebrew/bin/ffmpeg";

/** Expand a leading `~` (dotenv's convention), same as the exporter's config. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function recordingsRoot(): string {
  return path.resolve(
    expandHome(process.env.RECORDINGS_DIR || DEFAULT_RECORDINGS_DIR)
  );
}

/**
 * Absolute directory for one recording.
 *
 * Callers MUST have run `assertRecordingId` first — this joins a caller-supplied
 * string onto a filesystem root, and the id arrives from a dynamic `[id]` route
 * segment. store.ts is the only intended caller and it asserts.
 */
export function recordingDir(id: string): string {
  return path.join(recordingsRoot(), id);
}

export function ffmpegBin(): string {
  return process.env.FFMPEG_BIN || DEFAULT_FFMPEG_BIN;
}

/** Cap on a single recording, past which the client is told to stop.
 *  ~128 kbit/s stereo opus ≈ 57 MB/hour, so 400 MB is roughly 7 hours. */
export const MAX_RECORDING_BYTES = 400 * 1024 * 1024;
