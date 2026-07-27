"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface EditorPrefsState {
  /** Capitalize the first letter of sentences as you type. */
  autoCapitalize: boolean;
  /** Auto-fix completed words against the en dictionary. */
  autocorrect: boolean;

  setAutoCapitalize: (value: boolean) => void;
  setAutocorrect: (value: boolean) => void;
}

export const useEditorPrefsStore = create<EditorPrefsState>()(
  persist(
    (set) => ({
      autoCapitalize: true,
      autocorrect: true,

      setAutoCapitalize: (value) => set({ autoCapitalize: value }),
      setAutocorrect: (value) => set({ autocorrect: value }),
    }),
    {
      name: "kh-editor-prefs",
      storage: createJSONStorage(() => localStorage),
      // Same skipHydration pattern as components/theme/store.ts — server and
      // first client render use the defaults, then we rehydrate explicitly on
      // mount so there's no SSR hydration mismatch. The editor extensions read
      // these via getState() at input time (well after rehydration), and the
      // Settings checkboxes tolerate the brief default→persisted correction.
      skipHydration: true,
    }
  )
);

let rehydrateRequested = false;

/** Triggers persist rehydration exactly once on the client. */
export function rehydrateEditorPrefsStore(): void {
  if (rehydrateRequested || typeof window === "undefined") return;
  rehydrateRequested = true;
  void useEditorPrefsStore.persist.rehydrate();
}
