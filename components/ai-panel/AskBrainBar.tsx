"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useAiPanelStore } from "./store";

/**
 * Prominent "ask a question" entry point for the Home dashboard. Queues the
 * question and opens the AI panel, which sends it through the normal
 * useAiChat -> /api/ai/chat path — no chat logic lives here.
 */
export default function AskBrainBar() {
  const setOpen = useAiPanelStore((s) => s.setOpen);
  const setPendingQuery = useAiPanelStore((s) => s.setPendingQuery);
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    setPendingQuery(text);
    setOpen(true);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-4 py-3 shadow-sm transition-colors focus-within:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900 dark:focus-within:border-neutral-500"
    >
      <Sparkles className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" />
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ask your brain anything about your notes…"
        className="flex-1 bg-transparent text-sm text-neutral-800 outline-none placeholder:text-neutral-400 dark:text-neutral-100 dark:placeholder:text-neutral-500"
      />
      <button
        type="submit"
        disabled={!input.trim()}
        className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-35"
      >
        Ask
      </button>
    </form>
  );
}
