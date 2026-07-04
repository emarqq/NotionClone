"use client";

import { useEffect } from "react";
import {
  SCROLL_CONTAINER_ID,
  rehydrateTabsStore,
  useTabsStore,
} from "./store";

export interface TabSyncProps {
  pageId: string;
  spaceSlug: string;
  title: string;
}

/**
 * Invisible per-page sync component (rendered inside the page route).
 * Keeps the tab store in line with the currently displayed page: opens or
 * activates the tab, fixes its title, records the href in the back/forward
 * history, and wires scroll save/restore against the #page-scroll container.
 */
export function TabSync({ pageId, spaceSlug, title }: TabSyncProps) {
  const hasHydrated = useTabsStore((s) => s.hasHydrated);

  useEffect(() => {
    rehydrateTabsStore();
  }, []);

  // Tab + title + history sync.
  useEffect(() => {
    if (!hasHydrated) return;
    const state = useTabsStore.getState();
    state.openPage({ pageId, spaceSlug, title });
    state.updateTitle(pageId, title);
    state.pushHistory(`/${spaceSlug}/${pageId}`);
  }, [hasHydrated, pageId, spaceSlug, title]);

  // Scroll restore on mount + throttled scroll save into the active tab.
  useEffect(() => {
    if (!hasHydrated) return;
    const el = document.getElementById(SCROLL_CONTAINER_ID);
    if (!el) return;

    const state = useTabsStore.getState();
    const active = state.tabs.find((t) => t.id === state.activeTabId);
    if (active && active.pageId === pageId && active.scrollPos > 0) {
      const pos = active.scrollPos;
      requestAnimationFrame(() => {
        el.scrollTop = pos;
      });
    }

    let timeout: number | null = null;
    const onScroll = () => {
      if (timeout !== null) return;
      timeout = window.setTimeout(() => {
        timeout = null;
        const s = useTabsStore.getState();
        const activeTab = s.tabs.find((t) => t.id === s.activeTabId);
        if (activeTab && activeTab.pageId === pageId) {
          s.saveScroll(activeTab.id, el.scrollTop);
        }
      }, 150);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [hasHydrated, pageId]);

  return null;
}

export default TabSync;
