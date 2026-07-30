import "server-only";

import type {
  ChatDelta,
  ChatMessage,
  ChatRequest,
  GenerateRequest,
  GenerateResult,
  LLMProvider,
} from "../../types";
import {
  describeFetchFailure,
  healthCheckTimeoutMs,
  llmTimeoutMs,
  startDeadline,
} from "../../timeout";

const BASE_URL = () =>
  process.env.CUSTOM_LLM_BASE_URL ?? "http://localhost:8000/v1";
const MODEL = () => process.env.CUSTOM_LLM_MODEL ?? "custom-finetune";

/** Authorization header, present only when an API key is configured. */
function authHeaders(): Record<string, string> {
  const key = process.env.CUSTOM_LLM_API_KEY;
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function toOpenAiMessages(
  system: string | undefined,
  messages: ChatMessage[]
): ChatMessage[] {
  return system
    ? [{ role: "system" as const, content: system }, ...messages]
    : messages;
}

interface OpenAiChunk {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
}

interface OpenAiCompletion {
  choices?: { message?: { content?: string } }[];
}

/** Parses an OpenAI-style SSE stream ("data: {...}\n\n", terminated by "data: [DONE]"). */
async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<OpenAiChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, sepIndex).trim();
        buffer = buffer.slice(sepIndex + 2);
        for (const line of event.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") return;
          if (data) yield JSON.parse(data) as OpenAiChunk;
        }
      }
    }
  } finally {
    // Cancel rather than only releasing the lock — see the same note in
    // providers/ollama.ts readNdjson.
    try {
      await reader.cancel();
    } catch {
      /* already errored or closed */
    }
    try {
      reader.releaseLock();
    } catch {
      /* cancel() may have released it already */
    }
  }
}

/**
 * Working stub for a self-hosted, OpenAI-compatible chat endpoint (llama.cpp
 * server, vLLM, or Ollama's own /v1 route) — swap env vars to point this at a
 * LoRA fine-tune with no app-layer changes. See ./README.md.
 */
export function createCustomFinetuneLLMProvider(): LLMProvider {
  return {
    id: "custom-finetune",

    async *chatStream(req: ChatRequest): AsyncIterable<ChatDelta> {
      const baseUrl = BASE_URL();
      const model = MODEL();
      // Idle deadline, refreshed per SSE event — see lib/llm/timeout.ts for why
      // this is not a cap on the whole response.
      const deadline = startDeadline(llmTimeoutMs(), req.signal);
      const url = `${baseUrl}/chat/completions`;
      try {
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              model,
              messages: toOpenAiMessages(req.system, req.messages),
              stream: true,
              temperature: req.temperature,
              max_tokens: req.maxTokens,
            }),
            signal: deadline.signal,
          });
        } catch (err) {
          throw describeFetchFailure("custom-finetune provider", url, deadline, err);
        }
        if (!res.ok || !res.body) {
          throw new Error(
            `custom-finetune provider: chat request to ${baseUrl} failed (${res.status} ${res.statusText})`
          );
        }
        try {
          for await (const chunk of readSse(res.body)) {
            deadline.refresh();
            const choice = chunk.choices?.[0];
            const text = choice?.delta?.content ?? "";
            const done = choice?.finish_reason != null;
            if (text || done) yield { text, done };
          }
        } catch (err) {
          throw describeFetchFailure("custom-finetune provider", url, deadline, err);
        }
      } finally {
        deadline.clear();
      }
    },

    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const baseUrl = BASE_URL();
      const model = MODEL();
      const messages: ChatMessage[] = toOpenAiMessages(req.system, [
        { role: "user", content: req.prompt },
      ]);
      const deadline = startDeadline(llmTimeoutMs(), req.signal);
      const url = `${baseUrl}/chat/completions`;
      try {
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              model,
              messages,
              stream: false,
              temperature: req.temperature,
              max_tokens: req.maxTokens,
            }),
            signal: deadline.signal,
          });
        } catch (err) {
          throw describeFetchFailure("custom-finetune provider", url, deadline, err);
        }
        if (!res.ok) {
          throw new Error(
            `custom-finetune provider: generate request to ${baseUrl} failed (${res.status} ${res.statusText})`
          );
        }
        let json: OpenAiCompletion;
        try {
          json = (await res.json()) as OpenAiCompletion;
        } catch (err) {
          throw describeFetchFailure("custom-finetune provider", url, deadline, err);
        }
        return { text: json.choices?.[0]?.message?.content ?? "" };
      } finally {
        deadline.clear();
      }
    },

    capabilities() {
      return { contextWindow: 8192, supportsJsonMode: false };
    },

    async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
      const baseUrl = BASE_URL();
      // Short, dedicated budget — and note this method can make *two* requests,
      // so each gets its own rather than sharing one (a probe that reports
      // "unreachable" must never itself be the slow thing).
      const unreachable = (deadline: { timedOut: boolean; ms: number }, err: unknown) => ({
        ok: false as const,
        detail: deadline.timedOut
          ? `custom-finetune provider: ${baseUrl} did not respond within ${deadline.ms}ms`
          : `custom-finetune provider: cannot reach ${baseUrl}: ${(err as Error).message}`,
      });

      const modelsDeadline = startDeadline(healthCheckTimeoutMs());
      try {
        const res = await fetch(`${baseUrl}/models`, {
          headers: authHeaders(),
          signal: modelsDeadline.signal,
        });
        if (res.ok) return { ok: true };
        if (res.status !== 404) {
          return {
            ok: false,
            detail: `custom-finetune provider: ${baseUrl}/models returned ${res.status} ${res.statusText}`,
          };
        }
        // Some OpenAI-compatible servers don't implement /models — fall back
        // to a minimal chat completion to prove liveness.
      } catch (err) {
        return unreachable(modelsDeadline, err);
      } finally {
        modelsDeadline.clear();
      }

      const pingDeadline = startDeadline(healthCheckTimeoutMs());
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            model: MODEL(),
            messages: [{ role: "user", content: "ping" }],
            stream: false,
            max_tokens: 1,
          }),
          signal: pingDeadline.signal,
        });
        if (!res.ok) {
          return {
            ok: false,
            detail: `custom-finetune provider: fallback chat request to ${baseUrl} failed (${res.status} ${res.statusText})`,
          };
        }
        return { ok: true };
      } catch (err) {
        return unreachable(pingDeadline, err);
      } finally {
        pingDeadline.clear();
      }
    },
  };
}
