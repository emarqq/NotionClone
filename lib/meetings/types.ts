/**
 * Shared meeting-recording types.
 *
 * Deliberately NO `server-only`: the recording bar, the merge helpers and the
 * pipeline all speak these types, so this module has to be importable from the
 * browser. Keep it free of node imports for the same reason.
 */

/** Where a captured channel came from. `none` means the user recorded mic-only. */
export type SourceKind = "device" | "display" | "none";

export interface SourceInfo {
  kind: SourceKind;
  /** MediaDeviceInfo.deviceId for `device`; absent for `display`/`none`. */
  deviceId?: string;
  /** Human label, shown in the UI and stored for later forensics. */
  label: string;
}

/**
 * Lifecycle of one recording. Stored in meta.json, which is the single source
 * of truth — see lib/meetings/store.ts for why this isn't an in-memory map.
 */
export type RecordingStatus =
  | "recording"
  | "uploaded"
  | "converting"
  | "transcribing"
  | "merging"
  | "ready"
  | "error";

/** One speaker turn after mic/system segments are interleaved and coalesced. */
export interface LabeledTurn {
  /** `you` = the mic (left channel), `them` = system audio (right channel). */
  speaker: "you" | "them";
  startMs: number;
  endMs: number;
  text: string;
}

export interface RecordingMeta {
  id: string;
  /** The page the transcript gets appended to — pinned when recording starts. */
  pageId: string;
  spaceSlug: string;
  pageTitle: string;

  createdAt: string;
  /** Client wall-clock at recorder start; used only for the display header. */
  startedAtMs: number;
  durationMs: number | null;

  /** Next expected chunk index. The append endpoint 409s on any mismatch. */
  nextSeq: number;
  bytes: number;
  lastChunkAt: number | null;

  sources: { mic: SourceInfo; system: SourceInfo };

  status: RecordingStatus;
  /** Human-readable sub-step for the bar ("Transcribing your mic (1/2)"). */
  phaseDetail: string | null;

  transcriberId: string | null;
  transcriberLabel: string | null;
  /** Tracks skipped because they were silent — surfaced so a dead BlackHole
   *  route is reported rather than silently producing a one-sided transcript. */
  silentTracks: Array<"mic" | "system">;

  turnCount: number | null;
  error: string | null;
  /** Set once the transcript has landed in the page, so recovery skips it. */
  insertedAt: string | null;
}

/** meta.json + the turns, as served to the client. */
export interface RecordingDetail extends RecordingMeta {
  turns: LabeledTurn[] | null;
}
