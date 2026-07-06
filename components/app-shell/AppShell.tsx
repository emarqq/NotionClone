"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import TabBar from "@/components/tabs/TabBar";
import {
  SCROLL_CONTAINER_ID,
  closeTabAndGetHref,
  focusTab,
  rehydrateTabsStore,
  useTabsStore,
} from "@/components/tabs/store";
import { useNewTab, type SpaceOption } from "@/components/tabs/useNewTab";
import AiPanel from "@/components/ai-panel/AiPanel";
import { rehydrateAiPanelStore, useAiPanelStore } from "@/components/ai-panel/store";
import ResizeHandle from "@/components/app-shell/ResizeHandle";

export interface AppShellProps {
  sidebar: React.ReactNode;
  spaces: SpaceOption[];
  children: React.ReactNode;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.isContentEditable
  );
}

/**
 * Client shell: collapsible sidebar on the left, tab strip + scrollable
 * content on the right, plus global keyboard shortcuts.
 */
export default function AppShell({ sidebar, spaces, children }: AppShellProps) {
  const router = useRouter();
  const sidebarOpen = useTabsStore((s) => s.sidebarOpen);
  const sidebarWidth = useTabsStore((s) => s.sidebarWidth);
  const setSidebarWidth = useTabsStore((s) => s.setSidebarWidth);
  const aiPanelOpen = useAiPanelStore((s) => s.open);
  const aiPanelWidth = useAiPanelStore((s) => s.width);
  const setAiPanelWidth = useAiPanelStore((s) => s.setWidth);
  const { createNewTab } = useNewTab(spaces);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [resizingAiPanel, setResizingAiPanel] = useState(false);

  useEffect(() => {
    rehydrateTabsStore();
    rehydrateAiPanelStore();
  }, []);

  // Global keyboard shortcuts:
  //   ⌘T new tab · ⌘W close active tab · ⌘1-9 activate Nth tab
  //   ⌘\ toggle sidebar · ⌘[ back · ⌘] forward · ⌘J toggle assistant panel
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      // ⌘J is treated like ⌘\ (a global panel toggle, safe from any field)
      // rather than like ⌘T/⌘W, since users may want to dismiss/summon the
      // assistant while typing in the editor or in the assistant's own box.
      const safeAnywhere =
        key === "\\" || key === "j" || (key >= "1" && key <= "9");
      if (isEditableTarget(e.target) && !safeAnywhere) return;

      const state = useTabsStore.getState();

      if (key >= "1" && key <= "9") {
        const tab = state.tabs[Number(key) - 1];
        if (tab) {
          e.preventDefault();
          router.push(focusTab(tab));
        }
        return;
      }

      switch (key) {
        case "t": {
          // Best effort: browsers may reserve ⌘T for themselves.
          e.preventDefault();
          createNewTab();
          break;
        }
        case "w": {
          // Best effort: browsers may reserve ⌘W for themselves.
          e.preventDefault();
          if (state.activeTabId) {
            const href = closeTabAndGetHref(state.activeTabId);
            if (href) router.push(href);
          }
          break;
        }
        case "\\": {
          e.preventDefault();
          state.toggleSidebar();
          break;
        }
        case "j": {
          e.preventDefault();
          useAiPanelStore.getState().toggle();
          break;
        }
        case "[": {
          e.preventDefault();
          const href = state.goBack();
          if (href) router.push(href);
          break;
        }
        case "]": {
          e.preventDefault();
          const href = state.goForward();
          if (href) router.push(href);
          break;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, createNewTab]);

  return (
    <div className="flex h-screen overflow-hidden">
      <div
        className={clsx(
          "flex shrink-0 overflow-hidden",
          !resizingSidebar && "transition-[width] duration-200 ease-in-out"
        )}
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        <div className="min-w-0 flex-1 overflow-hidden">{sidebar}</div>
        {sidebarOpen && (
          <ResizeHandle
            side="left"
            getWidth={() => useTabsStore.getState().sidebarWidth}
            onResize={setSidebarWidth}
            onDragChange={setResizingSidebar}
          />
        )}
      </div>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <TabBar spaces={spaces} />
        <main id={SCROLL_CONTAINER_ID} className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      <div
        className={clsx(
          "flex shrink-0 overflow-hidden",
          !resizingAiPanel && "transition-[width] duration-200 ease-in-out"
        )}
        style={{ width: aiPanelOpen ? aiPanelWidth : 0 }}
      >
        {aiPanelOpen && (
          <ResizeHandle
            side="right"
            getWidth={() => useAiPanelStore.getState().width}
            onResize={setAiPanelWidth}
            onDragChange={setResizingAiPanel}
          />
        )}
        <div className="min-w-0 flex-1 overflow-hidden">
          <AiPanel spaces={spaces} />
        </div>
      </div>
    </div>
  );
}
