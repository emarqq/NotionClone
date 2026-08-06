/**
 * Transcription provider interface.
 *
 * Shaped after `lib/llm/types.ts` (swappable provider behind a registry) but
 * deliberately simpler: resolution is env-only, with no `app_settings` lookup.
 *
 * No `server-only` — the client imports `TranscriberId` for display.
 */

export type TranscriberId = "whisper-cpp" | "whisper-python";

/** One utterance with millisecond offsets, normalised across engines. */
export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscribeOptions {
  /** Directory the engine may write its JSON sidecar into. */
  outDir: string;
  /** BCP-47-ish language code both CLIs accept, or "auto". */
  language?: string;
  signal?: AbortSignal;
}

export interface Transcriber {
  readonly id: TranscriberId;
  /** Shown in the recording bar, e.g. "large-v3-turbo (Metal)". */
  readonly label: string;
  /** Transcribe a 16 kHz mono PCM wav. Both engines require exactly that. */
  transcribe(wavPath: string, opts: TranscribeOptions): Promise<TranscriptSegment[]>;
}
