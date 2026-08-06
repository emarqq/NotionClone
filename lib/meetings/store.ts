import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

import { MAX_RECORDING_BYTES, recordingDir, recordingsRoot } from "./config";
import type { LabeledTurn, RecordingMeta, SourceInfo } from "./types";

/**
 * Disk-backed recording state.
 *
 * meta.json is the SINGLE SOURCE OF TRUTH — deliberately not an in-memory Map.
 * `next dev --turbopack` re-evaluates route modules on every source edit, which
 * would silently wipe an in-process registry in the middle of a recording. Disk
 * also survives a server restart and the browser tab closing, which is what
 * makes crash recovery possible at all.
 */

const META = "meta.json";
const AUDIO = "raw.webm";
const TRANSCRIPT = "transcript.json";

/** Matches a v4-shaped UUID and nothing else. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Thrown for a malformed id so routes can answer 400 instead of a blanket 500. */
export class InvalidRecordingIdError extends Error {
  constructor() {
    super("Invalid recording id.");
    this.name = "InvalidRecordingIdError";
  }
}

/**
 * Path-traversal guard. The id arrives from a dynamic `[id]` route segment and
 * is joined onto a filesystem root, so `../../..` must never survive this.
 * Non-negotiable: every exported function here calls it first.
 */
export function assertRecordingId(id: string): string {
  if (!UUID_RE.test(id)) throw new InvalidRecordingIdError();
  return id;
}

/** Atomic write (temp + rename), so a crash mid-write can't truncate meta.json.
 *  Same approach as `writeFileAtomic` in lib/export/vaultFs.ts. */
async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.tmp-${process.pid}`
  );
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export function audioPath(id: string): string {
  return path.join(recordingDir(assertRecordingId(id)), AUDIO);
}

export function transcriptPath(id: string): string {
  return path.join(recordingDir(assertRecordingId(id)), TRANSCRIPT);
}

export async function createRecording(input: {
  pageId: string;
  spaceSlug: string;
  pageTitle: string;
  startedAtMs: number;
  sources: { mic: SourceInfo; system: SourceInfo };
}): Promise<RecordingMeta> {
  const id = crypto.randomUUID();
  const meta: RecordingMeta = {
    id,
    pageId: input.pageId,
    spaceSlug: input.spaceSlug,
    pageTitle: input.pageTitle,
    createdAt: new Date().toISOString(),
    startedAtMs: input.startedAtMs,
    durationMs: null,
    nextSeq: 0,
    bytes: 0,
    lastChunkAt: null,
    sources: input.sources,
    status: "recording",
    phaseDetail: null,
    transcriberId: null,
    transcriberLabel: null,
    silentTracks: [],
    turnCount: null,
    error: null,
    insertedAt: null,
  };
  const dir = recordingDir(id);
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(path.join(dir, META), meta);
  return meta;
}

export async function readMeta(id: string): Promise<RecordingMeta> {
  const file = path.join(recordingDir(assertRecordingId(id)), META);
  return JSON.parse(await fs.readFile(file, "utf8")) as RecordingMeta;
}

/** Read-modify-write of meta.json. Single-user local app with one writer per
 *  recording, so a lock would be ceremony — but keep patches small and additive. */
export async function patchMeta(
  id: string,
  partial: Partial<RecordingMeta>
): Promise<RecordingMeta> {
  const current = await readMeta(id);
  const next = { ...current, ...partial };
  await writeJsonAtomic(path.join(recordingDir(id), META), next);
  return next;
}

export type AppendResult =
  | { ok: true; nextSeq: number }
  | { ok: false; reason: "out-of-order" | "too-large"; nextSeq: number };

/**
 * Append one MediaRecorder chunk to raw.webm.
 *
 * Order is strict and enforced: chunk 0 carries the EBML header, and every later
 * chunk is a raw Cluster continuation, so an out-of-order append produces an
 * undecodable file. The client uploads strictly serially; the seq check turns a
 * duplicate retry into a no-op instead of corruption.
 */
export async function appendChunk(
  id: string,
  seq: number,
  buf: Buffer
): Promise<AppendResult> {
  const meta = await readMeta(id);
  if (seq !== meta.nextSeq) {
    return { ok: false, reason: "out-of-order", nextSeq: meta.nextSeq };
  }
  if (meta.bytes + buf.length > MAX_RECORDING_BYTES) {
    return { ok: false, reason: "too-large", nextSeq: meta.nextSeq };
  }
  await fs.appendFile(path.join(recordingDir(id), AUDIO), buf);
  await patchMeta(id, {
    nextSeq: seq + 1,
    bytes: meta.bytes + buf.length,
    lastChunkAt: Date.now(),
  });
  return { ok: true, nextSeq: seq + 1 };
}

export async function writeTurns(id: string, turns: LabeledTurn[]): Promise<void> {
  await writeJsonAtomic(transcriptPath(id), turns);
}

export async function readTurns(id: string): Promise<LabeledTurn[] | null> {
  try {
    return JSON.parse(await fs.readFile(transcriptPath(id), "utf8")) as LabeledTurn[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Recordings the UI should offer to recover on load: finished-but-never-inserted
 * transcripts, plus recordings still marked `recording` that have gone quiet for
 * over a minute (i.e. the tab died mid-capture — the partial webm is still
 * decodable and can be transcribed).
 */
export async function listPending(): Promise<RecordingMeta[]> {
  let ids: string[];
  try {
    ids = await fs.readdir(recordingsRoot());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const out: RecordingMeta[] = [];
  for (const id of ids) {
    if (!UUID_RE.test(id)) continue;
    try {
      const meta = await readMeta(id);
      const staleCapture =
        meta.status === "recording" &&
        meta.bytes > 0 &&
        Date.now() - (meta.lastChunkAt ?? 0) > 60_000;
      if ((meta.status === "ready" && !meta.insertedAt) || staleCapture) {
        out.push(meta);
      }
    } catch {
      // A half-written or hand-deleted directory shouldn't break the list.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
