"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { diffWords } from "diff";
import { Check, Loader2, StopCircle, X } from "lucide-react";

import { useAIProposalStore, type ProposalRequest } from "./aiProposalStore";
import { textToNodes } from "./aiContext";

type Phase = "streaming" | "done" | "error";

interface StreamEvent {
  type: "delta" | "done" | "error";
  text?: string;
  message?: string;
}

const TOOL_LABEL: Record<ProposalRequest["tool"], string> = {
  summarize: "Summarize",
  format: "Format",
  organize: "Organize",
  rewrite: "Rewrite",
  continue: "Continue writing",
};

/** Streams one line at a time from an SSE `data: <json>\n\n` body. */
async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = raw.startsWith("data:") ? raw.slice(5).trim() : raw.trim();
        if (line) yield JSON.parse(line) as StreamEvent;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * The one floating proposal panel shared by AIToolsMenu (selection) and the
 * SlashMenu "Continue writing" item. Streams the model's replacement text,
 * then renders a word-level diff against the original selection and lets the
 * user Accept (dispatches a single editor transaction — the only write path
 * remains the existing debounced saveBlocksAction) or Reject. Never touches
 * the stored page itself.
 */
export default function AIProposalCard({ editor }: { editor: Editor }) {
  const request = useAIProposalStore((s) => s.request);
  const close = useAIProposalStore((s) => s.close);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("streaming");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!request) return;
    setText("");
    setPhase("streaming");
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const res = await fetch("/api/ai/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: request.tool,
            text: request.selectedText,
            instruction: request.instruction,
            breadcrumb: request.breadcrumb,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          let message = `request failed (${res.status})`;
          try {
            const errBody = (await res.json()) as { error?: string };
            if (errBody.error) message = errBody.error;
          } catch {
            // Non-JSON error body — keep the generic message.
          }
          throw new Error(message);
        }
        for await (const evt of readSseEvents(res.body)) {
          if (evt.type === "delta" && evt.text) {
            setText((prev) => prev + evt.text);
          } else if (evt.type === "error") {
            throw new Error(evt.message ?? "stream error");
          }
        }
        setPhase("done");
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // Stopped by the user — keep whatever streamed so far and let them
          // review/accept a partial proposal instead of losing it.
          setPhase("done");
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
    })();

    return () => controller.abort();
  }, [request]);

  // Esc rejects while the card is open.
  useEffect(() => {
    if (!request) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [request, close]);

  if (!request) return null;

  const stale = editor.state.doc.content.size !== request.docSize;

  const diffParts: { added?: boolean; removed?: boolean; value: string }[] =
    phase === "done"
      ? request.tool === "continue"
        ? [{ added: true, value: text }]
        : diffWords(request.selectedText, text)
      : [];

  const accept = () => {
    if (stale || text.trim().length === 0) return;
    const nodes = textToNodes(text);
    editor
      .chain()
      .focus()
      .insertContentAt({ from: request.from, to: request.to }, nodes)
      .run();
    close();
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {TOOL_LABEL[request.tool]}
        </span>
        {phase === "streaming" ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <StopCircle size={13} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={close}
            className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto px-3 py-2.5 text-sm leading-relaxed">
        {phase === "error" ? (
          <p className="text-red-600 dark:text-red-400">{error}</p>
        ) : phase === "streaming" ? (
          <p className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-200">
            {text || (
              <span className="inline-flex items-center gap-1.5 text-neutral-400 dark:text-neutral-500">
                <Loader2 size={13} className="animate-spin" />
                Thinking…
              </span>
            )}
          </p>
        ) : (
          <p className="whitespace-pre-wrap">
            {diffParts.map((part, i) =>
              part.removed ? (
                <span
                  key={i}
                  className="text-red-600 line-through decoration-red-400/70 dark:text-red-400"
                >
                  {part.value}
                </span>
              ) : part.added ? (
                <span
                  key={i}
                  className="rounded-sm bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                >
                  {part.value}
                </span>
              ) : (
                <span key={i} className="text-neutral-700 dark:text-neutral-200">
                  {part.value}
                </span>
              )
            )}
          </p>
        )}
      </div>

      {phase === "done" && (
        <div className="flex items-center justify-between gap-2 border-t border-neutral-200 px-3 py-2 dark:border-neutral-700">
          {stale ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Selection changed — re-run
            </p>
          ) : (
            <span />
          )}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={close}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <X size={13} />
              Reject
            </button>
            <button
              type="button"
              disabled={stale || text.trim().length === 0}
              onClick={accept}
              className="flex items-center gap-1 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              <Check size={13} />
              Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
