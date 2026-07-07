"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, PanelLeft, Plus, Sparkles, X } from "lucide-react";
import clsx from "clsx";
import {
  closeTabAndGetHref,
  focusTab,
  rehydrateTabsStore,
  useTabsStore,
  type Tab,
} from "./store";
import { useNewTab, type SpaceOption } from "./useNewTab";
import { useAiPanelStore } from "@/components/ai-panel/store";

const ICON_BTN_CLASS =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-800 disabled:pointer-events-none disabled:opacity-35 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

/** Matches workspace page routes: /[spaceSlug]/[pageId] */
const PAGE_ROUTE_RE = /^\/([^/]+)\/([^/]+)\/?$/;

export interface TabBarProps {
  spaces: SpaceOption[];
}

/**
 * Notion-style tab strip: sidebar toggle, back/forward, draggable tabs, and a
 * "+" button that creates a new page in the current space.
 */
export default function TabBar({ spaces }: TabBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { createNewTab, isCreating } = useNewTab(spaces);

  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const hasHydrated = useTabsStore((s) => s.hasHydrated);
  const canGoBack = useTabsStore((s) => s.history.back.length > 1);
  const canGoForward = useTabsStore((s) => s.history.forward.length > 0);
  const toggleSidebar = useTabsStore((s) => s.toggleSidebar);
  const aiPanelOpen = useAiPanelStore((s) => s.open);
  const toggleAiPanel = useAiPanelStore((s) => s.toggle);

  // Render the tab strip only after mount + rehydration (no SSR mismatch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    rehydrateTabsStore();
  }, []);

  // Standalone sync: keep tabs in line with the URL even if TabSync is not
  // rendered by the page route. Creates a placeholder-titled tab when the
  // user lands on a page (via URL or sidebar) that has no tab yet.
  useEffect(() => {
    if (!hasHydrated || !pathname) return;
    const match = PAGE_ROUTE_RE.exec(pathname);
    if (!match) return;
    const [, spaceSlug, pageId] = match;
    const state = useTabsStore.getState();
    const existing = state.tabs.find((t) => t.pageId === pageId);
    if (existing) {
      if (state.activeTabId !== existing.id) state.setActive(existing.id);
    } else {
      state.openPage({ pageId, spaceSlug, title: "…" });
    }
    state.pushHistory(pathname);
  }, [hasHydrated, pathname]);

  const dragIndex = useRef<number | null>(null);

  const handleActivate = (tab: Tab) => {
    router.push(focusTab(tab));
  };

  const handleClose = (id: string) => {
    const href = closeTabAndGetHref(id);
    if (href) router.push(href);
  };

  const handleBack = () => {
    const href = useTabsStore.getState().goBack();
    if (href) router.push(href);
  };

  const handleForward = () => {
    const href = useTabsStore.getState().goForward();
    if (href) router.push(href);
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-neutral-200 bg-neutral-50 px-1.5 dark:border-neutral-800 dark:bg-neutral-950">
      <button
        type="button"
        onClick={toggleSidebar}
        className={ICON_BTN_CLASS}
        title="Toggle sidebar (⌘\)"
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleBack}
        disabled={!canGoBack}
        className={ICON_BTN_CLASS}
        title="Back (⌘[)"
        aria-label="Go back"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={handleForward}
        disabled={!canGoForward}
        className={ICON_BTN_CLASS}
        title="Forward (⌘])"
        aria-label="Go forward"
      >
        <ArrowRight className="h-4 w-4" />
      </button>

      <div className="ml-1 flex min-w-0 flex-1 items-end gap-0.5 self-stretch overflow-x-auto">
        {mounted &&
          hasHydrated &&
          tabs.map((tab, index) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                draggable
                onDragStart={(e) => {
                  dragIndex.current = index;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", tab.id);
                }}
                onDragOver={(e) => {
                  if (dragIndex.current === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (
                    dragIndex.current !== null &&
                    dragIndex.current !== index
                  ) {
                    useTabsStore
                      .getState()
                      .reorderTabs(dragIndex.current, index);
                  }
                  dragIndex.current = null;
                }}
                onDragEnd={() => {
                  dragIndex.current = null;
                }}
                onClick={() => handleActivate(tab)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    handleClose(tab.id);
                  }
                }}
                className={clsx(
                  "group flex h-[30px] min-w-[100px] max-w-[200px] shrink-0 cursor-pointer select-none items-center gap-1 rounded-t-md border-b-2 px-2 text-[13px]",
                  isActive
                    ? "border-neutral-700 bg-secondary/10 font-medium text-neutral-900 dark:border-neutral-200 dark:bg-secondary/15 dark:text-neutral-100"
                    : "border-transparent text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200"
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {tab.title || "Untitled"}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClose(tab.id);
                  }}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-300/70 hover:text-neutral-700 group-hover:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                  title="Close tab (⌘W)"
                  aria-label={`Close ${tab.title || "Untitled"}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        <button
          type="button"
          onClick={createNewTab}
          disabled={isCreating || spaces.length === 0}
          className={clsx(ICON_BTN_CLASS, "mb-[3px]")}
          title="New tab (⌘T)"
          aria-label="New tab"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={toggleAiPanel}
        className={clsx(
          ICON_BTN_CLASS,
          "ml-1",
          aiPanelOpen &&
            "bg-neutral-200/70 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
        )}
        title="Toggle Assistant (⌘J)"
        aria-label="Toggle Assistant"
      >
        <Sparkles className="h-4 w-4" />
      </button>
    </div>
  );
}
