"use client";

import { create } from "zustand";

/**
 * Recording UI state.
 *
 * Module-scope zustand, mounted once by AppShell — deliberately outside the
 * route subtree so navigating between pages mid-meeting neither unmounts the bar
 * nor interrupts capture. The target page is pinned when recording starts, so a
 * transcript always lands where the user pressed Record even if they wandered
 * off to another page during the call.
 */

export type RecordingPhase =
  | "idle"
  | "setup"
  | "recording"
  | "processing"
  | "done"
  | "error";

export interface RecordingTarget {
  pageId: string;
  spaceSlug: string;
  pageTitle: string;
}

const PREFS_KEY = "notionclone.recording.prefs";

interface Prefs {
  micDeviceId: string | null;
  systemDeviceId: string | null;
  /** "device" | "display" | "none" — remembered across sessions. */
  systemKind: "device" | "display" | "none";
}

interface RecordingState {
  phase: RecordingPhase;
  target: RecordingTarget | null;
  recordingId: string | null;

  startedAt: number | null;
  bytes: number;
  levels: { mic: number; system: number };

  micDeviceId: string | null;
  systemDeviceId: string | null;
  systemKind: "device" | "display" | "none";

  /** Sub-step text from the server pipeline ("Transcribing your mic (1/2)"). */
  phaseDetail: string | null;
  error: string | null;
  /** Set on success so the bar can say where the transcript went. */
  result: { turnCount: number; pageTitle: string; viaServer: boolean } | null;

  open: (target: RecordingTarget) => void;
  close: () => void;
  setPhase: (phase: RecordingPhase) => void;
  setDevices: (p: Partial<Prefs>) => void;
  beginRecording: (recordingId: string) => void;
  setLevels: (mic: number, system: number) => void;
  setBytes: (bytes: number) => void;
  setPhaseDetail: (detail: string | null) => void;
  fail: (message: string) => void;
  succeed: (result: { turnCount: number; pageTitle: string; viaServer: boolean }) => void;
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  phase: "idle",
  target: null,
  recordingId: null,
  startedAt: null,
  bytes: 0,
  levels: { mic: 0, system: 0 },
  micDeviceId: null,
  systemDeviceId: null,
  systemKind: "device",
  phaseDetail: null,
  error: null,
  result: null,

  open: (target) => {
    // Never clobber a live recording by opening the bar from another page.
    const { phase } = get();
    if (phase === "recording" || phase === "processing") return;
    set({ phase: "setup", target, error: null, result: null, bytes: 0 });
  },

  close: () => {
    const { phase } = get();
    if (phase === "recording") return; // Stop first — guarded in the UI too.
    set({
      phase: "idle",
      target: null,
      recordingId: null,
      startedAt: null,
      bytes: 0,
      levels: { mic: 0, system: 0 },
      phaseDetail: null,
      error: null,
      result: null,
    });
  },

  setPhase: (phase) => set({ phase }),
  setDevices: (p) => {
    set(p as Partial<RecordingState>);
    persistPrefs({ ...readPrefs(), ...p });
  },
  beginRecording: (recordingId) =>
    set({ phase: "recording", recordingId, startedAt: Date.now(), error: null }),
  setLevels: (mic, system) => set({ levels: { mic, system } }),
  setBytes: (bytes) => set({ bytes }),
  setPhaseDetail: (phaseDetail) => set({ phaseDetail }),
  fail: (message) => set({ phase: "error", error: message, phaseDetail: null }),
  succeed: (result) => set({ phase: "done", result, phaseDetail: null, error: null }),
}));

function readPrefs(): Prefs {
  if (typeof window === "undefined") {
    return { micDeviceId: null, systemDeviceId: null, systemKind: "device" };
  }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw) as Prefs;
  } catch {
    // Corrupt/blocked storage is not worth failing a recording over.
  }
  return { micDeviceId: null, systemDeviceId: null, systemKind: "device" };
}

function persistPrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore — device choice just won't be remembered.
  }
}

/** Restore remembered device choices. Called once by RecordingBar on mount,
 *  mirroring `rehydrateEditorPrefsStore` in components/editor/editorPrefsStore.ts. */
export function rehydrateRecordingPrefs(): void {
  const prefs = readPrefs();
  useRecordingStore.setState({
    micDeviceId: prefs.micDeviceId,
    systemDeviceId: prefs.systemDeviceId,
    systemKind: prefs.systemKind ?? "device",
  });
}
