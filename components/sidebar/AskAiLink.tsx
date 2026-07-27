"use client";

import { Sparkles } from "lucide-react";
import { useAiPanelStore } from "@/components/ai-panel/store";

/**
 * Sidebar entry point for the AI panel, styled like SidebarLink but a button
 * (opens the panel in place rather than navigating to a route).
 */
export default function AskAiLink() {
  const setOpen = useAiPanelStore((s) => s.setOpen);

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Ask AI (⌘J)"
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        <Sparkles size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">Ask AI</span>
    </button>
  );
}
