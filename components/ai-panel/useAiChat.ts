"use client";

import { useCallback, useRef, useState } from "react";
import type { EnrichedSource } from "@/app/api/ai/chat/route";

export interface AiChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: EnrichedSource[];
  /** True while this assistant message is still receiving deltas. */
  streaming?: boolean;
}

interface SseMeta {
  type: "meta";
  conversationId: string;
  sources: EnrichedSource[];
}
interface SseDelta {
  type: "delta";
  text: string;
}
interface SseDone {
  type: "done";
}
interface SseError {
  type: "error";
  message: string;
}
type SseEvent = SseMeta | SseDelta | SseDone | SseError;

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Drives POST /api/ai/chat: sends a message, parses the `data: {...}\n\n`
 * event stream, and keeps local message state (with live-streamed assistant
 * text + resolved sources) in sync. One instance per active conversation.
 */
export function useAiChat(onConversationId: (id: string) => void) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback((initial: AiChatMessage[]) => {
    setMessages(initial);
    setError(null);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const send = useCallback(
    async (
      text: string,
      conversationId: string | null,
      spaceId: string | null,
      graphExpand: boolean
    ) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;
      setError(null);

      const assistantId = makeId();
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: "user", content: trimmed },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            message: trimmed,
            spaceId,
            graphExpand,
          }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            const rawEvent = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const dataLine = rawEvent
              .split("\n")
              .find((line) => line.startsWith("data:"));
            if (!dataLine) continue;
            const json = dataLine.slice(5).trim();
            if (!json) continue;

            const event = JSON.parse(json) as SseEvent;
            if (event.type === "meta") {
              onConversationId(event.conversationId);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, sources: event.sources } : m
                )
              );
            } else if (event.type === "delta") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + event.text }
                    : m
                )
              );
            } else if (event.type === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, streaming: false } : m
                )
              );
            } else if (event.type === "error") {
              setError(event.message);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, streaming: false } : m
                )
              );
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message || "Something went wrong.");
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m
          )
        );
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [isStreaming, onConversationId]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, isStreaming, error, send, abort, load, clear };
}
