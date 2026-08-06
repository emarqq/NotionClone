import "server-only";

import { probeWhisperCpp } from "./providers/whisperCpp";
import { probeWhisperPython } from "./providers/whisperPython";
import type { Transcriber, TranscriberId } from "./types";

/**
 * Transcription provider resolution.
 *
 * Mirrors the shape of `lib/llm/registry.ts` (probe → memoise → fall back) but
 * env-only: there is no `app_settings` row for this and adding one would mean a
 * migration, which this feature deliberately avoids.
 *
 * Preference order is whisper.cpp (GPU, large-v3-turbo) then python whisper
 * (CPU, base). `TRANSCRIBER=whisper-python` forces the fallback, which is how
 * you exercise it without uninstalling anything.
 */

let cached: Transcriber | null = null;

export async function getTranscriber(): Promise<Transcriber> {
  if (cached) return cached;

  const forced = process.env.TRANSCRIBER as TranscriberId | undefined;

  if (forced === "whisper-python") {
    const py = await probeWhisperPython();
    if (py) return (cached = py);
  }
  if (forced === "whisper-cpp") {
    const cpp = await probeWhisperCpp();
    if (cpp) return (cached = cpp);
  }

  const cpp = await probeWhisperCpp();
  if (cpp) return (cached = cpp);

  const py = await probeWhisperPython();
  if (py) return (cached = py);

  throw new Error(
    "No transcription engine found. Install whisper.cpp (`brew install whisper-cpp`) " +
      "plus a ggml model, or the python whisper CLI."
  );
}

/** For a settings row / the recording bar's tooltip: what is actually available. */
export async function describeTranscribers(): Promise<
  Array<{ id: TranscriberId; label: string; available: boolean }>
> {
  const [cpp, py] = await Promise.all([probeWhisperCpp(), probeWhisperPython()]);
  return [
    { id: "whisper-cpp", label: cpp?.label ?? "not installed", available: !!cpp },
    { id: "whisper-python", label: py?.label ?? "not installed", available: !!py },
  ];
}

/** Tests only — the cache is process-lifetime, which is right for a local app. */
export function resetTranscriberCache(): void {
  cached = null;
}
