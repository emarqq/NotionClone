import "server-only";

import path from "node:path";

import { ffmpegBin } from "./config";
import { run, runOrThrow } from "./proc";

/**
 * Audio conversion for the recording pipeline.
 *
 * The browser records ONE stereo webm/opus stream with the microphone on the
 * left channel and system audio on the right (see components/recording/capture.ts).
 * Splitting happens here rather than in the browser because ffmpeg also fixes the
 * container: concatenated MediaRecorder chunks form a valid but non-seekable
 * WebM (no Duration, no Cues), and transcoding discards the container entirely.
 *
 * 16 kHz mono pcm_s16le is not a preference — whisper.cpp accepts nothing else,
 * and `whisper-cli` lists only flac/mp3/ogg/wav as inputs, so webm could never
 * be fed to it directly.
 */

export interface SplitResult {
  micWav: string;
  systemWav: string;
}

export async function splitToWavPair(dir: string): Promise<SplitResult> {
  const input = path.join(dir, "raw.webm");
  const micWav = path.join(dir, "mic.wav");
  const systemWav = path.join(dir, "sys.wav");

  await runOrThrow("ffmpeg split", ffmpegBin(), [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-i", input,
    "-filter_complex",
    "[0:a]aformat=channel_layouts=stereo,channelsplit=channel_layout=stereo[L][R]",
    "-map", "[L]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", micWav,
    "-map", "[R]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", systemWav,
  ]);

  return { micWav, systemWav };
}

/**
 * Peak level of a wav in dBFS. Digital silence reports -91 dB or lower.
 *
 * This gate exists because feeding Whisper a silent track is the single most
 * reliable way to get invented dialogue: the decoder will happily produce
 * "Thank you." or "Subtitles by the Amara.org community" from noise floor, and
 * on the system channel that becomes an entire fabricated speaker turn. Cheaper
 * and far more reliable to skip the track than to filter the output afterwards.
 */
export async function probeMaxVolumeDb(wavPath: string): Promise<number> {
  // volumedetect reports on stderr and exits 0; a parse miss must not be fatal.
  const { stderr } = await run(ffmpegBin(), [
    "-hide_banner",
    "-i", wavPath,
    "-af", "volumedetect",
    "-f", "null",
    "-",
  ]);
  const match = stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/);
  return match ? Number(match[1]) : Number.NEGATIVE_INFINITY;
}

/** Below this peak, treat a track as "nothing was captured". */
export const SILENCE_THRESHOLD_DB = -50;

export async function isSilent(wavPath: string): Promise<boolean> {
  return (await probeMaxVolumeDb(wavPath)) < SILENCE_THRESHOLD_DB;
}

/** Wall-clock duration of an audio file in ms, or null if ffmpeg can't tell. */
export async function probeDurationMs(filePath: string): Promise<number | null> {
  const { stderr } = await run(ffmpegBin(), ["-hide_banner", "-i", filePath]);
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return Math.round(
    (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
  );
}
