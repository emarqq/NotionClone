"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** Id of the scrollable content container rendered by AppShell. */
export const SCROLL_CONTAINER_ID = "page-scroll";

export interface Tab {
  /** Stable uuid for the tab itself (not the page). */
  id: string;
  pageId: string;
  spaceSlug: string;
  title: string;
  /** Last saved scrollTop of the content container for this tab. */
  scrollPos: number;
}

export interface OpenPageInput {
  pageId: string;
  spaceSlug: string;
  title: string;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
  history: { back: string[]; forward: string[] };
  sidebarOpen: boolean;
  /** True once the persisted state has been rehydrated on the client. */
  hasHydrated: boolean;

  /**
   * Notion-style navigate-in-tab: activates the existing tab for `pageId`
   * if one exists, otherwise repoints the ACTIVE tab at the new page.
   * Creates a tab only when there is no active tab (empty state).
   */
  openPage: (input: OpenPageInput) => void;
  /** Opens the page in a new tab at the end of the strip (dedupes by pageId). */
  openInNewTab: (input: OpenPageInput) => void;
  /**
   * Closes a tab; if it was active, activates its neighbor. Closing the last
   * tab leaves the empty state. Returns the newly activated tab when the
   * active tab changed (so callers can navigate), otherwise null.
   */
  closeTab: (id: string) => Tab | null;
  setActive: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateTitle: (pageId: string, title: string) => void;
  saveScroll: (id: string, pos: number) => void;
  /** Records a visited href (deduped against the current entry; clears forward). */
  pushHistory: (href: string) => void;
  /** Returns the href to navigate back to, or null. */
  goBack: () => string | null;
  /** Returns the href to navigate forward to, or null. */
  goForward: () => string | null;
  toggleSidebar: () => void;
  setHasHydrated: (value: boolean) => void;
}

const PLACEHOLDER_TITLE = "…";

function makeTab(input: OpenPageInput): Tab {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    pageId: input.pageId,
    spaceSlug: input.spaceSlug,
    title: input.title,
    scrollPos: 0,
  };
}

/** Keeps a real title when the caller only knows the placeholder. */
function mergeTitle(existing: string, incoming: string): string {
  return incoming === PLACEHOLDER_TITLE && existing ? existing : incoming;
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,
      history: { back: [], forward: [] },
      sidebarOpen: true,
      hasHydrated: false,

      openPage: (input) => {
        const { tabs, activeTabId } = get();
        const existing = tabs.find((t) => t.pageId === input.pageId);
        if (existing) {
          set({
            activeTabId: existing.id,
            tabs: tabs.map((t) =>
              t.id === existing.id
                ? {
                    ...t,
                    spaceSlug: input.spaceSlug,
                    title: mergeTitle(t.title, input.title),
                  }
                : t
            ),
          });
          return;
        }
        const active = tabs.find((t) => t.id === activeTabId);
        if (active) {
          set({
            tabs: tabs.map((t) =>
              t.id === active.id
                ? {
                    ...t,
                    pageId: input.pageId,
                    spaceSlug: input.spaceSlug,
                    title: input.title,
                    scrollPos: 0,
                  }
                : t
            ),
          });
          return;
        }
        const tab = makeTab(input);
        set({ tabs: [...tabs, tab], activeTabId: tab.id });
      },

      openInNewTab: (input) => {
        const { tabs } = get();
        const existing = tabs.find((t) => t.pageId === input.pageId);
        if (existing) {
          set({
            activeTabId: existing.id,
            tabs: tabs.map((t) =>
              t.id === existing.id
                ? { ...t, title: mergeTitle(t.title, input.title) }
                : t
            ),
          });
          return;
        }
        const tab = makeTab(input);
        set({ tabs: [...tabs, tab], activeTabId: tab.id });
      },

      closeTab: (id) => {
        const { tabs, activeTabId } = get();
        const index = tabs.findIndex((t) => t.id === id);
        if (index === -1) return null;
        const nextTabs = tabs.filter((t) => t.id !== id);
        if (activeTabId !== id) {
          set({ tabs: nextTabs });
          return null;
        }
        const neighbor =
          nextTabs.length > 0
            ? nextTabs[Math.min(index, nextTabs.length - 1)]
            : null;
        set({ tabs: nextTabs, activeTabId: neighbor?.id ?? null });
        return neighbor;
      },

      setActive: (id) => {
        if (get().tabs.some((t) => t.id === id)) set({ activeTabId: id });
      },

      reorderTabs: (fromIndex, toIndex) => {
        const tabs = [...get().tabs];
        if (
          fromIndex === toIndex ||
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= tabs.length ||
          toIndex >= tabs.length
        ) {
          return;
        }
        const [moved] = tabs.splice(fromIndex, 1);
        tabs.splice(toIndex, 0, moved);
        set({ tabs });
      },

      updateTitle: (pageId, title) => {
        set({
          tabs: get().tabs.map((t) =>
            t.pageId === pageId ? { ...t, title } : t
          ),
        });
      },

      saveScroll: (id, pos) => {
        set({
          tabs: get().tabs.map((t) =>
            t.id === id ? { ...t, scrollPos: pos } : t
          ),
        });
      },

      pushHistory: (href) => {
        const { history } = get();
        if (history.back[history.back.length - 1] === href) return;
        set({ history: { back: [...history.back, href], forward: [] } });
      },

      goBack: () => {
        const { history } = get();
        if (history.back.length < 2) return null;
        const back = [...history.back];
        const current = back.pop() as string;
        const target = back[back.length - 1];
        set({ history: { back, forward: [...history.forward, current] } });
        return target;
      },

      goForward: () => {
        const { history } = get();
        if (history.forward.length === 0) return null;
        const forward = [...history.forward];
        const target = forward.pop() as string;
        set({ history: { back: [...history.back, target], forward } });
        return target;
      },

      toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),

      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "kh-tabs",
      storage: createJSONStorage(() => localStorage),
      // Skip automatic hydration so server render and first client render
      // both use the defaults (no hydration mismatch); we rehydrate on mount.
      skipHydration: true,
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        history: state.history,
        sidebarOpen: state.sidebarOpen,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

let rehydrateRequested = false;

/**
 * Triggers persist rehydration exactly once on the client. Safe to call from
 * every component that reads the store (AppShell, TabBar, TabSync), so the
 * store hydrates no matter which of them mounts first.
 */
export function rehydrateTabsStore(): void {
  if (rehydrateRequested || typeof window === "undefined") return;
  rehydrateRequested = true;
  void useTabsStore.persist.rehydrate();
}

/**
 * Saves the current scroll position into the active tab, activates `tab`,
 * and returns its href for the caller to router.push.
 */
export function focusTab(tab: Tab): string {
  const state = useTabsStore.getState();
  if (typeof document !== "undefined" && state.activeTabId) {
    const el = document.getElementById(SCROLL_CONTAINER_ID);
    if (el) state.saveScroll(state.activeTabId, el.scrollTop);
  }
  state.setActive(tab.id);
  return `/${tab.spaceSlug}/${tab.pageId}`;
}

/**
 * Closes a tab and returns the href of the newly activated neighbor when the
 * active tab changed (callers should navigate there), otherwise null.
 */
export function closeTabAndGetHref(id: string): string | null {
  const next = useTabsStore.getState().closeTab(id);
  return next ? `/${next.spaceSlug}/${next.pageId}` : null;
}
