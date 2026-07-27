"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 300;
const MAX_WIDTH = 560;

interface AiPanelState {
  open: boolean;
  activeConversationId: string | null;
  width: number;
  /** Graph-RAG: expand retrieval to linked pages ("Connect linked notes"). */
  graphExpand: boolean;
  /** True once the persisted state has been rehydrated on the client. */
  hasHydrated: boolean;
  /**
   * One-shot query text set by an entry point outside the panel (e.g. the
   * Home "Ask your brain" bar). AiPanel sends it and clears it on mount/open.
   */
  pendingQuery: string | null;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setActiveConversationId: (id: string | null) => void;
  setWidth: (width: number) => void;
  setGraphExpand: (value: boolean) => void;
  setHasHydrated: (value: boolean) => void;
  setPendingQuery: (value: string | null) => void;
}

export const useAiPanelStore = create<AiPanelState>()(
  persist(
    (set, get) => ({
      open: false,
      activeConversationId: null,
      width: DEFAULT_WIDTH,
      graphExpand: true,
      hasHydrated: false,
      pendingQuery: null,

      toggle: () => set({ open: !get().open }),
      setOpen: (open) => set({ open }),
      setActiveConversationId: (id) => set({ activeConversationId: id }),
      setWidth: (width) =>
        set({ width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)) }),
      setGraphExpand: (value) => set({ graphExpand: value }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
      setPendingQuery: (value) => set({ pendingQuery: value }),
    }),
    {
      name: "kh-ai-panel",
      storage: createJSONStorage(() => localStorage),
      // Same pattern as components/tabs/store.ts: skip auto-hydration so the
      // server render and first client render both use the defaults, then
      // rehydrate explicitly on mount (no hydration mismatch).
      skipHydration: true,
      partialize: (state) => ({
        open: state.open,
        activeConversationId: state.activeConversationId,
        width: state.width,
        graphExpand: state.graphExpand,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

let rehydrateRequested = false;

/** Triggers persist rehydration exactly once on the client. */
export function rehydrateAiPanelStore(): void {
  if (rehydrateRequested || typeof window === "undefined") return;
  rehydrateRequested = true;
  void useAiPanelStore.persist.rehydrate();
}
