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
  /** Some of the answer streamed before the failure and has been persisted (§R1). */
  partial?: boolean;
  /** The question can be re-sent as-is; the user turn is already saved. */
  retryable?: boolean;
}
type SseEvent = SseMeta | SseDelta | SseDone | SseError;

export interface AiChatError {
  message: string;
  partial: boolean;
  retryable: boolean;
}

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
  const [error, setError] = useState<AiChatError | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Real mutual exclusion for sends. `isStreaming` is state and lags a task. */
  const inFlightRef = useRef(false);
  /**
   * The arguments of the last send, so a failed turn can be retried without the
   * user retyping. Kept in a ref rather than state: it must not re-render, and it
   * must be readable from a callback created before the send happened.
   */
  const lastSendRef = useRef<
    | { text: string; conversationId: string | null; spaceId: string | null; graphExpand: boolean }
    | null
  >(null);

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
      graphExpand: boolean,
      /**
       * Re-asking a question whose user turn is already persisted. The server
       * uses this to avoid writing the same question twice — see `isRetry` in
       * app/api/ai/chat/route.ts.
       */
      isRetry = false
    ) => {
      const trimmed = text.trim();
      // `inFlightRef`, not `isStreaming`: both are guards, but `isStreaming` is
      // state, so two calls inside a single task (a programmatic retry, a
      // StrictMode double-invoked effect) would both read `false` and both fire —
      // two POSTs, two persisted user turns, and `abortRef` overwritten so abort()
      // only cancels the second. `isStreaming` stays, purely for rendering.
      if (!trimmed || inFlightRef.current) return;
      inFlightRef.current = true;
      setError(null);
      lastSendRef.current = { text: trimmed, conversationId, spaceId, graphExpand };

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
            isRetry,
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
              // The first message of a conversation is sent with
              // conversationId=null and the server mints one. Without writing it
              // back here, a retry of that first turn would post null again and
              // fork a SECOND conversation — orphaning the first, which is holding
              // the partial answer the UI just promised had been saved.
              if (lastSendRef.current) {
                lastSendRef.current.conversationId = event.conversationId;
              }
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
              // The partial text already in `content` stays on screen — the
              // server has persisted it too (§R1), so a refresh no longer loses
              // an answer the user was mid-way through reading.
              setError({
                message: event.message,
                partial: event.partial ?? false,
                retryable: event.retryable ?? false,
              });
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
          setError({
            message: (err as Error).message || "Something went wrong.",
            partial: false,
            // Safe to re-send: the server either never saw the turn, or saved it
            // and will recognise the retry rather than duplicating it.
            retryable: true,
          });
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m
          )
        );
      } finally {
        inFlightRef.current = false;
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [onConversationId]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * Re-asks the last question after a failed turn. Deliberately re-sends rather
   * than resuming: a resume would need the provider to continue from arbitrary
   * mid-text, which no local model does reliably, and a half-answer stitched to a
   * second half-answer is worse than a clean second attempt. The failed partial
   * stays in history, tagged, so nothing the user read is thrown away.
   */
  const retry = useCallback(async () => {
    const last = lastSendRef.current;
    if (!last || inFlightRef.current) return;
    // Drop the failed assistant turn from the *local* view so the retry does not
    // render two answers to one question. The persisted one is untouched.
    setMessages((prev) => {
      const lastUser = prev.map((m) => m.role).lastIndexOf("user");
      return lastUser === -1 ? prev : prev.slice(0, lastUser);
    });
    await send(last.text, last.conversationId, last.spaceId, last.graphExpand, true);
  }, [send]);

  return { messages, isStreaming, error, send, retry, abort, load, clear };
}
