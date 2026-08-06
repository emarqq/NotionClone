"use client";

import type { SourceInfo } from "@/lib/meetings/types";

/**
 * Audio capture for meeting recording.
 *
 * A NON-REACT module singleton on purpose: this owns the AudioContext, the
 * MediaRecorder and the in-flight upload queue, none of which may be torn down
 * by a re-render or a route change. `RecordingBar` only reads state out of the
 * zustand store that this module pushes into.
 *
 * ── The graph ────────────────────────────────────────────────────────────────
 *   mic    ─► MediaStreamAudioSourceNode ─► Analyser ─┐
 *                                                      ├─► ChannelMerger(2) ─► MediaStreamDestination ─► MediaRecorder
 *   system ─► MediaStreamAudioSourceNode ─► Analyser ─┘
 *              (input 0 = LEFT = you, input 1 = RIGHT = them)
 *
 * One recorder over a merged stereo stream rather than two parallel recorders,
 * because both sources then share a single AudioContext clock: the two speakers
 * are sample-aligned for free, with no cross-recorder drift to discover forty
 * minutes into an interview. ffmpeg splits the channels again server-side.
 *
 * The merger is NEVER connected to ctx.destination — that would replay system
 * audio out of the speakers and straight back into the microphone.
 */

/** How often MediaRecorder hands us a blob. Also the worst-case data loss if
 *  the tab dies, since everything acked is already on the server's disk. */
const TIMESLICE_MS = 5000;
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm"];
const MAX_UPLOAD_ATTEMPTS = 8;

export type SystemChoice =
  | { kind: "device"; deviceId: string; label: string }
  | { kind: "display" }
  | { kind: "none" };

export interface StartOptions {
  micDeviceId: string | null;
  system: SystemChoice;
  target: { pageId: string; spaceSlug: string; pageTitle: string };
  onLevels: (mic: number, system: number) => void;
  onError: (message: string) => void;
  onBytes: (bytes: number) => void;
}

interface Session {
  ctx: AudioContext;
  recorder: MediaRecorder;
  streams: MediaStream[];
  micAnalyser: AnalyserNode | null;
  systemAnalyser: AnalyserNode | null;
  rafId: number | null;
  recordingId: string;
  /** Strictly increasing; the server 409s on any mismatch. */
  nextSeq: number;
  queue: Blob[];
  uploading: boolean;
  stopped: boolean;
  /** Resolves once every queued chunk has been acked. */
  drained: (() => void) | null;
  bytes: number;
  failed: boolean;
}

let session: Session | null = null;

export function isCapturing(): boolean {
  return session !== null && !session.stopped;
}

function pickMimeType(): string {
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

/**
 * Loopback devices must be captured raw. Chrome's default echo cancellation,
 * noise suppression and auto gain are tuned for a human talking into a mic and
 * will happily gate or pump system audio into something Whisper can't read.
 */
const RAW_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
} as const;

async function openMic(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: deviceId
      ? { deviceId: { exact: deviceId }, channelCount: 1 }
      : { channelCount: 1 },
  });
}

async function openSystem(choice: SystemChoice): Promise<MediaStream | null> {
  if (choice.kind === "none") return null;

  if (choice.kind === "device") {
    return navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: choice.deviceId }, ...RAW_AUDIO_CONSTRAINTS },
    });
  }

  // Tab/window share. Chrome requires a video track to be requested for a
  // display capture even when only the audio is wanted, so we ask for video and
  // immediately drop it — keeping it alive would pointlessly encode a screen.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  for (const track of stream.getVideoTracks()) {
    track.stop();
    stream.removeTrack(track);
  }
  if (stream.getAudioTracks().length === 0) {
    throw new Error(
      'That share had no audio. Re-pick the source and tick "Share tab audio".'
    );
  }
  return stream;
}

function describeSystem(choice: SystemChoice, stream: MediaStream | null): SourceInfo {
  if (choice.kind === "none" || !stream) return { kind: "none", label: "None" };
  if (choice.kind === "device") {
    return { kind: "device", deviceId: choice.deviceId, label: choice.label };
  }
  return {
    kind: "display",
    label: stream.getAudioTracks()[0]?.label || "Shared tab audio",
  };
}

/** Peak amplitude 0..1 from an analyser, for the level meters. */
function readLevel(analyser: AnalyserNode, buf: Uint8Array): number {
  analyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i] - 128) / 128;
    if (v > peak) peak = v;
  }
  return peak;
}

export async function startCapture(opts: StartOptions): Promise<string> {
  if (session) throw new Error("A recording is already running.");

  const micStream = await openMic(opts.micDeviceId);
  let systemStream: MediaStream | null = null;
  try {
    systemStream = await openSystem(opts.system);
  } catch (err) {
    // A failed system source must not cost the user their microphone: fall back
    // to mic-only rather than aborting the whole recording.
    for (const t of micStream.getTracks()) t.stop();
    throw err;
  }

  const ctx = new AudioContext();
  // Autoplay policy can hand back a suspended context, which would process no
  // audio at all and produce a silent recording with no error anywhere.
  if (ctx.state === "suspended") await ctx.resume();

  const merger = ctx.createChannelMerger(2);
  const dest = ctx.createMediaStreamDestination();
  merger.connect(dest);

  const micSource = ctx.createMediaStreamSource(micStream);
  const micAnalyser = ctx.createAnalyser();
  micAnalyser.fftSize = 1024;
  micSource.connect(micAnalyser);
  micSource.connect(merger, 0, 0); // LEFT

  let systemAnalyser: AnalyserNode | null = null;
  if (systemStream) {
    const sysSource = ctx.createMediaStreamSource(systemStream);
    systemAnalyser = ctx.createAnalyser();
    systemAnalyser.fftSize = 1024;
    sysSource.connect(systemAnalyser);
    sysSource.connect(merger, 0, 1); // RIGHT
  }

  const micInfo: SourceInfo = {
    kind: "device",
    deviceId: opts.micDeviceId ?? undefined,
    label: micStream.getAudioTracks()[0]?.label || "Default microphone",
  };

  const created = await fetch("/api/meetings/recordings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageId: opts.target.pageId,
      spaceSlug: opts.target.spaceSlug,
      pageTitle: opts.target.pageTitle,
      startedAtMs: Date.now(),
      sources: { mic: micInfo, system: describeSystem(opts.system, systemStream) },
    }),
  });
  if (!created.ok) {
    ctx.close();
    for (const s of [micStream, systemStream]) s?.getTracks().forEach((t) => t.stop());
    throw new Error("Could not start the recording on the server.");
  }
  const { id } = (await created.json()) as { id: string };

  const recorder = new MediaRecorder(dest.stream, {
    mimeType: pickMimeType(),
    audioBitsPerSecond: 128000,
  });

  const s: Session = {
    ctx,
    recorder,
    streams: [micStream, ...(systemStream ? [systemStream] : [])],
    micAnalyser,
    systemAnalyser,
    rafId: null,
    recordingId: id,
    nextSeq: 0,
    queue: [],
    uploading: false,
    stopped: false,
    drained: null,
    bytes: 0,
    failed: false,
  };
  session = s;

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      s.queue.push(event.data);
      s.bytes += event.data.size;
      opts.onBytes(s.bytes);
      // Kick the pump from the data event itself, never a timer: background tabs
      // throttle timers to ~1 Hz, which would stall uploads exactly when a long
      // meeting is running in a hidden tab.
      void pump(s, opts.onError);
    }
  };

  // Level metering.
  const micBuf = new Uint8Array(micAnalyser.frequencyBinCount);
  const sysBuf = systemAnalyser
    ? new Uint8Array(systemAnalyser.frequencyBinCount)
    : null;
  const tick = () => {
    if (!session || session.stopped) return;
    opts.onLevels(
      readLevel(micAnalyser, micBuf),
      systemAnalyser && sysBuf ? readLevel(systemAnalyser, sysBuf) : 0
    );
    s.rafId = requestAnimationFrame(tick);
  };
  s.rafId = requestAnimationFrame(tick);

  recorder.start(TIMESLICE_MS);
  return id;
}

/**
 * Upload queued chunks strictly one at a time, in order.
 *
 * Order is not a nicety: chunk 0 carries the WebM header and later chunks are
 * bare Cluster continuations, so a parallel or reordered upload yields an
 * undecodable file. A failed chunk is retried with backoff and never skipped.
 */
async function pump(s: Session, onError: (m: string) => void): Promise<void> {
  if (s.uploading || s.failed) return;
  s.uploading = true;

  while (s.queue.length > 0) {
    const blob = s.queue[0];
    let uploaded = false;

    for (let attempt = 0; attempt < MAX_UPLOAD_ATTEMPTS && !uploaded; attempt++) {
      try {
        const res = await fetch(
          `/api/meetings/recordings/${s.recordingId}/chunk?seq=${s.nextSeq}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: blob,
          }
        );

        if (res.ok) {
          const { nextSeq } = (await res.json()) as { nextSeq: number };
          s.nextSeq = nextSeq;
          uploaded = true;
        } else if (res.status === 409) {
          // The server already has this chunk (a retry that actually landed).
          const { nextSeq } = (await res.json()) as { nextSeq: number };
          s.nextSeq = nextSeq;
          uploaded = true;
        } else if (res.status === 413) {
          s.failed = true;
          onError("Recording hit the size limit and was stopped.");
          s.uploading = false;
          return;
        } else {
          throw new Error(`chunk upload failed (${res.status})`);
        }
      } catch {
        await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** attempt)));
      }
    }

    if (!uploaded) {
      s.failed = true;
      onError("Lost connection to the server — recording stopped.");
      s.uploading = false;
      return;
    }
    s.queue.shift();
  }

  s.uploading = false;
  if (s.stopped && s.drained) {
    s.drained();
    s.drained = null;
  }
}

/**
 * Stop recording, flush every remaining chunk, and hand off to the pipeline.
 * Resolves with the recording id once /finish has been accepted.
 */
export async function stopCapture(): Promise<string | null> {
  const s = session;
  if (!s) return null;

  const id = s.recordingId;

  // `stop()` emits one final dataavailable with whatever is still buffered, so
  // the drain promise has to be armed before stopping.
  const finalChunk = new Promise<void>((resolve) => {
    s.recorder.onstop = () => resolve();
  });
  if (s.recorder.state !== "inactive") s.recorder.stop();
  await finalChunk;

  s.stopped = true;
  if (s.rafId !== null) cancelAnimationFrame(s.rafId);

  // Wait for the queue to drain before telling the server we're done, or the
  // pipeline would start on a truncated file.
  if (s.queue.length > 0 || s.uploading) {
    await new Promise<void>((resolve) => {
      s.drained = resolve;
      void pump(s, () => resolve());
    });
  }

  for (const stream of s.streams) stream.getTracks().forEach((t) => t.stop());
  await s.ctx.close().catch(() => {});
  session = null;

  await fetch(`/api/meetings/recordings/${id}/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ durationMs: null }),
  }).catch(() => {});

  return id;
}

/** Tear down without processing — used when the user cancels outright. */
export async function abortCapture(): Promise<void> {
  const s = session;
  if (!s) return;
  s.stopped = true;
  if (s.rafId !== null) cancelAnimationFrame(s.rafId);
  if (s.recorder.state !== "inactive") s.recorder.stop();
  for (const stream of s.streams) stream.getTracks().forEach((t) => t.stop());
  await s.ctx.close().catch(() => {});
  session = null;
}

/**
 * Device list for the pickers. Labels are empty until a getUserMedia grant
 * exists, so a probe stream is opened and immediately closed on first call.
 */
export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.some((d) => d.kind === "audioinput" && !d.label)) {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
    devices = await navigator.mediaDevices.enumerateDevices();
  }
  return devices.filter((d) => d.kind === "audioinput");
}

/** Virtual loopback devices, i.e. the ones that can actually hear the computer. */
export const LOOPBACK_LABEL_RE = /blackhole|loopback|aggregate|soundflower|multi-output|vb-audio|virtual/i;
