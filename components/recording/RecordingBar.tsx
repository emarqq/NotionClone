"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mic,
  Square,
  X,
} from "lucide-react";

import { formatClock } from "@/lib/meetings/merge";
import type { RecordingDetail } from "@/lib/meetings/types";
import {
  LOOPBACK_LABEL_RE,
  abortCapture,
  listAudioInputs,
  startCapture,
  stopCapture,
  type SystemChoice,
} from "./capture";
import { deliverTranscript } from "./deliverTranscript";
import { rehydrateRecordingPrefs, useRecordingStore } from "./recordingStore";

/**
 * The floating recording bar.
 *
 * Mounted ONCE by AppShell, outside the route subtree — that is what lets a
 * recording survive navigating between pages mid-meeting. It must not be
 * rendered by a menu: PageActionsMenu unmounts itself on click, which would tear
 * the recorder out from under an in-progress call.
 *
 * Sits top-centre because all three bottom slots are taken (ImportStatusToast
 * bottom-centre, AIProposalCard bottom-right, SettingsModal bottom-right) — and
 * a red pill under the tab bar is the conventional "you are recording" signal.
 */

const POLL_INTERVAL_MS = 2000;

export default function RecordingBar() {
  const phase = useRecordingStore((s) => s.phase);
  const target = useRecordingStore((s) => s.target);
  const levels = useRecordingStore((s) => s.levels);
  const startedAt = useRecordingStore((s) => s.startedAt);
  const bytes = useRecordingStore((s) => s.bytes);
  const phaseDetail = useRecordingStore((s) => s.phaseDetail);
  const error = useRecordingStore((s) => s.error);
  const result = useRecordingStore((s) => s.result);
  const micDeviceId = useRecordingStore((s) => s.micDeviceId);
  const systemDeviceId = useRecordingStore((s) => s.systemDeviceId);
  const systemKind = useRecordingStore((s) => s.systemKind);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    rehydrateRecordingPrefs();
  }, []);

  // Enumerate devices when the setup panel opens, auto-selecting a loopback.
  useEffect(() => {
    if (phase !== "setup") return;
    let cancelled = false;
    void (async () => {
      try {
        const inputs = await listAudioInputs();
        if (cancelled) return;
        setDevices(inputs);
        setDeviceError(null);

        const store = useRecordingStore.getState();
        const patch: Parameters<typeof store.setDevices>[0] = {};
        if (!store.micDeviceId && inputs[0]) patch.micDeviceId = inputs[0].deviceId;
        if (!store.systemDeviceId) {
          const loopback = inputs.find((d) => LOOPBACK_LABEL_RE.test(d.label));
          if (loopback) patch.systemDeviceId = loopback.deviceId;
        }
        if (Object.keys(patch).length > 0) store.setDevices(patch);
      } catch (err) {
        if (!cancelled) {
          setDeviceError(
            err instanceof Error
              ? `Microphone access was refused: ${err.message}`
              : "Could not list audio devices."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  // Elapsed time derived from wall clock, never an incrementing counter —
  // background tabs throttle timers to ~1 Hz and a counter would drift badly
  // over an hour-long meeting.
  useEffect(() => {
    if (phase !== "recording" || !startedAt) return;
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [phase, startedAt]);

  // Warn before a reload/close would kill a live capture.
  useEffect(() => {
    if (phase !== "recording") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  const pollUntilDone = useCallback(async (recordingId: string, pageId: string) => {
    const store = useRecordingStore.getState();
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      let detail: RecordingDetail & { header: string };
      try {
        const res = await fetch(`/api/meetings/recordings/${recordingId}`);
        if (!res.ok) throw new Error(`status ${res.status}`);
        detail = await res.json();
      } catch {
        continue; // Transient — polling reconnects for free, which is the point.
      }

      store.setPhaseDetail(detail.phaseDetail);

      if (detail.status === "error") {
        store.fail(detail.error || "Transcription failed.");
        return;
      }
      if (detail.status === "ready" && detail.turns) {
        const outcome = await deliverTranscript(
          recordingId,
          pageId,
          detail.turns,
          detail.header
        );
        if (outcome.ok) {
          store.succeed({
            turnCount: detail.turns.length,
            pageTitle: detail.pageTitle,
            viaServer: outcome.viaServer,
          });
        } else {
          store.fail(outcome.error || "Could not add the transcript to the page.");
        }
        return;
      }
    }
  }, []);

  const handleStart = async () => {
    const store = useRecordingStore.getState();
    if (!store.target) return;
    setBusy(true);
    try {
      const system: SystemChoice =
        store.systemKind === "display"
          ? { kind: "display" }
          : store.systemKind === "device" && store.systemDeviceId
            ? {
                kind: "device",
                deviceId: store.systemDeviceId,
                label:
                  devices.find((d) => d.deviceId === store.systemDeviceId)?.label ??
                  "System audio",
              }
            : { kind: "none" };

      const id = await startCapture({
        micDeviceId: store.micDeviceId,
        system,
        target: store.target,
        onLevels: (mic, sys) => useRecordingStore.getState().setLevels(mic, sys),
        onError: (msg) => useRecordingStore.getState().fail(msg),
        onBytes: (b) => useRecordingStore.getState().setBytes(b),
      });
      store.beginRecording(id);
    } catch (err) {
      store.fail(
        err instanceof Error ? err.message : "Could not start recording."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    const store = useRecordingStore.getState();
    const pageId = store.target?.pageId;
    setBusy(true);
    try {
      const id = await stopCapture();
      if (!id || !pageId) {
        store.fail("Recording was lost before it could be saved.");
        return;
      }
      store.setPhase("processing");
      store.setPhaseDetail("Converting audio");
      void pollUntilDone(id, pageId);
    } catch (err) {
      store.fail(err instanceof Error ? err.message : "Could not stop cleanly.");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    await abortCapture();
    useRecordingStore.getState().close();
  };

  const handleRetry = async () => {
    const store = useRecordingStore.getState();
    const id = store.recordingId;
    const pageId = store.target?.pageId;
    if (!id || !pageId) return;
    store.setPhase("processing");
    store.setPhaseDetail("Retrying");
    await fetch(`/api/meetings/recordings/${id}/finish`, { method: "POST" }).catch(
      () => {}
    );
    void pollUntilDone(id, pageId);
  };

  if (phase === "idle") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 top-14 z-50 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-neutral-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95"
    >
      {phase === "setup" && (
        <SetupPanel
          devices={devices}
          deviceError={deviceError}
          micDeviceId={micDeviceId}
          systemDeviceId={systemDeviceId}
          systemKind={systemKind}
          pageTitle={target?.pageTitle ?? ""}
          busy={busy}
          onStart={handleStart}
          onCancel={handleCancel}
        />
      )}

      {phase === "recording" && (
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
          </span>
          <span className="font-mono text-sm tabular-nums text-neutral-800 dark:text-neutral-100">
            {formatClock(elapsed)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <LevelMeter label="You" value={levels.mic} />
            <LevelMeter label="Them" value={levels.system} />
          </div>
          <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
            {(bytes / 1024 / 1024).toFixed(1)} MB
          </span>
          <button
            type="button"
            onClick={handleStop}
            disabled={busy}
            className="flex shrink-0 items-center gap-1.5 rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            <Square size={11} fill="currentColor" /> Stop
          </button>
        </div>
      )}

      {phase === "processing" && (
        <div className="flex items-center gap-2.5 text-sm">
          <Loader2 size={15} className="shrink-0 animate-spin text-neutral-500" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-neutral-800 dark:text-neutral-100">
              {phaseDetail ?? "Processing"}…
            </div>
            <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
              Keep working — the transcript will be added to{" "}
              <span className="font-medium">{target?.pageTitle}</span> when it&apos;s done.
            </div>
          </div>
        </div>
      )}

      {phase === "done" && result && (
        <div className="flex items-center gap-2.5 text-sm">
          <CheckCircle2 size={15} className="shrink-0 text-green-600" />
          <div className="min-w-0 flex-1">
            <div className="text-neutral-800 dark:text-neutral-100">
              Transcript added — {result.turnCount}{" "}
              {result.turnCount === 1 ? "turn" : "turns"}.
            </div>
            <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
              {result.viaServer
                ? `Appended to ${result.pageTitle}. Reload that page to see it.`
                : "Cmd-Z undoes it."}
            </div>
          </div>
          <CloseButton onClick={() => useRecordingStore.getState().close()} />
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-start gap-2.5 text-sm">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <div className="text-neutral-800 dark:text-neutral-100">{error}</div>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={handleRetry}
                className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
              >
                Retry transcription
              </button>
              <span className="self-center text-[11px] text-neutral-500 dark:text-neutral-400">
                The audio is safe on disk.
              </span>
            </div>
          </div>
          <CloseButton onClick={() => useRecordingStore.getState().close()} />
        </div>
      )}
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss"
      className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
    >
      <X size={13} />
    </button>
  );
}

/**
 * Live input level. Not decoration: this is the only way to confirm the loopback
 * device is actually routed BEFORE a one-shot interview, and a silent right
 * channel discovered afterwards is unrecoverable.
 */
function LevelMeter({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.round(value * 140));
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-[10px] text-neutral-500 dark:text-neutral-400">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          className={`h-full rounded-full transition-[width] duration-75 ${
            pct > 2 ? "bg-green-500" : "bg-neutral-300 dark:bg-neutral-600"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SetupPanel({
  devices,
  deviceError,
  micDeviceId,
  systemDeviceId,
  systemKind,
  pageTitle,
  busy,
  onStart,
  onCancel,
}: {
  devices: MediaDeviceInfo[];
  deviceError: string | null;
  micDeviceId: string | null;
  systemDeviceId: string | null;
  systemKind: "device" | "display" | "none";
  pageTitle: string;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const setDevices = useRecordingStore((s) => s.setDevices);
  const selectClass =
    "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100";

  const noSystem =
    systemKind === "none" || (systemKind === "device" && !systemDeviceId);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Mic size={14} className="text-neutral-500" />
        <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
          Record meeting
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-500 dark:text-neutral-400">
          → {pageTitle}
        </span>
      </div>

      {deviceError && (
        <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {deviceError}
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Your microphone
        </span>
        <select
          className={selectClass}
          value={micDeviceId ?? ""}
          onChange={(e) => setDevices({ micDeviceId: e.target.value })}
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Microphone"}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Computer audio (the other side)
        </span>
        <select
          className={selectClass}
          value={systemKind === "device" ? (systemDeviceId ?? "") : systemKind}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "display" || v === "none") {
              setDevices({ systemKind: v });
            } else {
              setDevices({ systemKind: "device", systemDeviceId: v });
            }
          }}
        >
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || "Input"}
              {LOOPBACK_LABEL_RE.test(d.label) ? "  ← loopback" : ""}
            </option>
          ))}
          <option value="display">Share a browser tab…</option>
          <option value="none">None (microphone only)</option>
        </select>
      </label>

      {noSystem && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400">
          Only your microphone will be recorded — the other side won&apos;t be captured.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onStart}
          disabled={busy}
          className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Mic size={11} />}
          Start recording
        </button>
      </div>
    </div>
  );
}
