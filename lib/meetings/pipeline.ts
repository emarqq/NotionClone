import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { getTranscriber } from "@/lib/transcribe/registry";
import type { TranscriptSegment } from "@/lib/transcribe/types";
import { recordingDir } from "./config";
import { isSilent, probeDurationMs, splitToWavPair } from "./ffmpeg";
import { mergeTurns, turnsToMarkdown } from "./merge";
import { patchMeta, readMeta, writeTurns } from "./store";
import { transcriptHeader } from "./header";

/**
 * Post-recording processing: split → transcribe both channels → merge → persist.
 *
 * Runs detached from the request that triggered it (`/finish` returns 202
 * immediately). Deliberately NOT wrapped in `next/server`'s `after()`: that is
 * scoped to a request's lifecycle and is the wrong contract for a job that can
 * run for minutes. Progress is published by patching meta.json, which the client
 * polls — see store.ts for why disk rather than an in-memory job registry.
 */

/** Guards against double-starting the same job (e.g. a double-clicked Retry).
 *  Purely an optimisation — meta.json remains the source of truth. */
const inFlight = new Map<string, Promise<void>>();

export function processRecording(id: string): Promise<void> {
  const existing = inFlight.get(id);
  if (existing) return existing;

  const job = runPipeline(id)
    .catch(async (err) => {
      console.error(`[meetings] pipeline failed for ${id}:`, err);
      await patchMeta(id, {
        status: "error",
        phaseDetail: null,
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => {});
    })
    .finally(() => {
      inFlight.delete(id);
    });

  inFlight.set(id, job);
  return job;
}

async function runPipeline(id: string): Promise<void> {
  const dir = recordingDir(id);
  const meta = await readMeta(id);

  if (meta.bytes === 0) {
    throw new Error("Nothing was recorded — no audio reached the server.");
  }

  // --- 1. Split the stereo capture into two mono 16 kHz tracks -------------
  await patchMeta(id, {
    status: "converting",
    phaseDetail: "Converting audio",
    error: null,
  });
  const { micWav, systemWav } = await splitToWavPair(dir);

  // Duration from the audio itself; the client's number is a fallback, since a
  // crashed tab never reports one.
  const measured = await probeDurationMs(micWav);
  if (measured) await patchMeta(id, { durationMs: measured });

  // --- 2. Skip silent tracks before they can hallucinate -------------------
  const silentTracks: Array<"mic" | "system"> = [];
  const micSilent = await isSilent(micWav);
  const systemSilent =
    meta.sources.system.kind === "none" ? true : await isSilent(systemWav);
  if (micSilent) silentTracks.push("mic");
  if (systemSilent) silentTracks.push("system");

  if (micSilent && systemSilent) {
    throw new Error(
      "Both audio channels were silent. Check that the right input devices were selected."
    );
  }

  // --- 3. Transcribe each live track --------------------------------------
  const transcriber = await getTranscriber();
  await patchMeta(id, {
    status: "transcribing",
    silentTracks,
    transcriberId: transcriber.id,
    transcriberLabel: transcriber.label,
    phaseDetail: "Transcribing",
  });

  const total = 2 - silentTracks.length;
  let done = 0;

  const transcribeTrack = async (
    wav: string,
    which: "mic" | "system",
    humanName: string
  ): Promise<TranscriptSegment[]> => {
    if (silentTracks.includes(which)) return [];
    await patchMeta(id, {
      phaseDetail: `Transcribing ${humanName} (${done + 1}/${total})`,
    });
    const segments = await transcriber.transcribe(wav, { outDir: dir, language: "en" });
    done += 1;
    return segments;
  };

  // Sequential, not parallel: both engines already saturate the machine (Metal
  // GPU or all CPU cores), so running them concurrently makes each slower
  // without finishing sooner, and doubles peak memory.
  const micSegments = await transcribeTrack(micWav, "mic", "your mic");
  const systemSegments = await transcribeTrack(systemWav, "system", "the other side");

  // --- 4. Merge into labeled turns ----------------------------------------
  await patchMeta(id, { status: "merging", phaseDetail: "Assembling transcript" });
  const turns = mergeTurns(micSegments, systemSegments);
  await writeTurns(id, turns);

  // A readable artifact on disk, so even a total insert failure leaves the
  // user something they can open and paste by hand.
  const finalMeta = await readMeta(id);
  await fs.writeFile(
    path.join(dir, "transcript.md"),
    turnsToMarkdown(turns, transcriptHeader(finalMeta)),
    "utf8"
  );

  // --- 5. Clean up the intermediates --------------------------------------
  // The WAVs are ~4x the size of the source webm (16-bit PCM) and are fully
  // reproducible from raw.webm, which is kept so a better model can re-run later.
  await Promise.all([
    fs.rm(micWav, { force: true }),
    fs.rm(systemWav, { force: true }),
  ]);

  await patchMeta(id, {
    status: "ready",
    phaseDetail: null,
    turnCount: turns.length,
    error: null,
  });
}
