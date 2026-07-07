"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from "./constants";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  primaryColor: string;
  secondaryColor: string;
  /** True once the persisted state has been rehydrated on the client. */
  hasHydrated: boolean;

  setMode: (mode: ThemeMode) => void;
  setPrimaryColor: (color: string) => void;
  setSecondaryColor: (color: string) => void;
  setHasHydrated: (value: boolean) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "system",
      primaryColor: DEFAULT_PRIMARY_COLOR,
      secondaryColor: DEFAULT_SECONDARY_COLOR,
      hasHydrated: false,

      setMode: (mode) => set({ mode }),
      setPrimaryColor: (color) => set({ primaryColor: color }),
      setSecondaryColor: (color) => set({ secondaryColor: color }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "kh-theme",
      storage: createJSONStorage(() => localStorage),
      // Same pattern as components/tabs/store.ts and components/ai-panel/store.ts:
      // skip auto-hydration so the server render and first client render both
      // use the defaults, then rehydrate explicitly on mount (no hydration
      // mismatch). The layout's inline no-flash script applies the persisted
      // values to the DOM synchronously before that, so there's no flash.
      skipHydration: true,
      partialize: (state) => ({
        mode: state.mode,
        primaryColor: state.primaryColor,
        secondaryColor: state.secondaryColor,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

let rehydrateRequested = false;

/** Triggers persist rehydration exactly once on the client. */
export function rehydrateThemeStore(): void {
  if (rehydrateRequested || typeof window === "undefined") return;
  rehydrateRequested = true;
  void useThemeStore.persist.rehydrate();
}
