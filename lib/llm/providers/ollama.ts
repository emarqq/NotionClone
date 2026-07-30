import "server-only";

import type {
  ChatDelta,
  ChatMessage,
  ChatRequest,
  EmbeddingProvider,
  GenerateRequest,
  GenerateResult,
  LLMProvider,
} from "../types";
import {
  describeFetchFailure,
  MalformedResponseError,
  embeddingTimeoutMs,
  healthCheckTimeoutMs,
  llmTimeoutMs,
  startDeadline,
} from "../timeout";

const BASE_URL = () => process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const CHAT_MODEL = () => process.env.OLLAMA_CHAT_MODEL ?? "llama3.1:8b";
const EMBED_MODEL = () => process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const EMBED_DIMENSIONS = 768;
const EMBED_BATCH_SIZE = 32;

/** Builds the Ollama chat message array: optional system prompt first, then the conversation. */
function toOllamaMessages(
  system: string | undefined,
  messages: ChatMessage[]
): ChatMessage[] {
  return system
    ? [{ role: "system" as const, content: system }, ...messages]
    : messages;
}

/** Shared options object mapping our request knobs to Ollama's `options`. */
function toOllamaOptions(req: { temperature?: number; maxTokens?: number }) {
  const options: Record<string, number> = {};
  if (req.temperature !== undefined) options.temperature = req.temperature;
  if (req.maxTokens !== undefined) options.num_predict = req.maxTokens;
  return options;
}

interface OllamaChatLine {
  message?: { role: string; content: string };
  done?: boolean;
}

/** Reads an Ollama NDJSON stream response body, yielding one parsed line at a time. */
async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<OllamaChatLine> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        // A newline-terminated line is a COMPLETE record, so a parse failure here
        // means the server genuinely emitted something that is not NDJSON. Say so
        // (CODE_REVIEW §R8): the raw SyntaxError was indistinguishable from any
        // other stream failure, and D-011 now writes the reason into the user's
        // conversation, so a wrong diagnosis becomes part of their notes.
        let parsed: OllamaChatLine;
        try {
          parsed = JSON.parse(line) as OllamaChatLine;
        } catch (err) {
          throw new MalformedResponseError(
            `ollama provider: expected NDJSON, got ${JSON.stringify(line.slice(0, 120))} (${
              (err as Error).message
            })`
          );
        }
        yield parsed;
      }
    }
    // Trailing bytes with no newline: the normal cause is a stream cut short
    // mid-record (Ollama killed, socket dropped). Everything complete has already
    // been yielded, so dropping a partial record is right — throwing here would
    // turn a clean truncation into an error and, via §R1, tag the user's saved
    // answer with a parse error that explains nothing.
    const rest = buffer.trim();
    if (rest) {
      try {
        yield JSON.parse(rest) as OllamaChatLine;
      } catch {
        /* truncated final record — ignore */
      }
    }
  } finally {
    // Cancel, not merely release. A consumer that breaks out of the for-await
    // (which `for await` turns into iterator.return(), so this block does run)
    // would otherwise leave the response body unconsumed and the model still
    // generating — the exact connection leak the deadlines exist to close.
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

/** Chat/generation provider backed by a local Ollama server (default 'llama3.1:8b'). */
export function createOllamaLLMProvider(): LLMProvider {
  return {
    id: "ollama",

    async *chatStream(req: ChatRequest): AsyncIterable<ChatDelta> {
      const baseUrl = BASE_URL();
      const model = CHAT_MODEL();
      // Idle deadline, refreshed per line: 30 s to produce the *next* token, not
      // 30 s for the whole answer (see lib/llm/timeout.ts).
      const deadline = startDeadline(llmTimeoutMs(), req.signal);
      try {
        let res: Response;
        try {
          res = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages: toOllamaMessages(req.system, req.messages),
              stream: true,
              options: toOllamaOptions(req),
            }),
            signal: deadline.signal,
          });
        } catch (err) {
          throw describeFetchFailure("ollama provider", `${baseUrl}/api/chat`, deadline, err);
        }
        if (!res.ok || !res.body) {
          throw new Error(
            `ollama provider: chat request to ${baseUrl} failed (${res.status} ${res.statusText})`
          );
        }
        try {
          for await (const line of readNdjson(res.body)) {
            deadline.refresh();
            const text = line.message?.content ?? "";
            if (text || line.done) yield { text, done: line.done };
          }
        } catch (err) {
          throw describeFetchFailure("ollama provider", `${baseUrl}/api/chat`, deadline, err);
        }
      } finally {
        deadline.clear();
      }
    },

    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const baseUrl = BASE_URL();
      const model = CHAT_MODEL();
      const messages: ChatMessage[] = toOllamaMessages(req.system, [
        { role: "user", content: req.prompt },
      ]);
      const deadline = startDeadline(llmTimeoutMs(), req.signal);
      try {
        let res: Response;
        try {
          res = await fetch(`${baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages,
              stream: false,
              options: toOllamaOptions(req),
            }),
            signal: deadline.signal,
          });
        } catch (err) {
          throw describeFetchFailure("ollama provider", `${baseUrl}/api/chat`, deadline, err);
        }
        if (!res.ok) {
          throw new Error(
            `ollama provider: generate request to ${baseUrl} failed (${res.status} ${res.statusText})`
          );
        }
        // Also wrapped: fetch() resolves on headers, so a body-read timeout lands
        // here — unwrapped it surfaced as a bare "This operation was aborted"
        // with nobody reporting that a deadline had fired.
        let json: OllamaChatLine;
        try {
          json = (await res.json()) as OllamaChatLine;
        } catch (err) {
          throw describeFetchFailure("ollama provider", `${baseUrl}/api/chat`, deadline, err);
        }
        return { text: json.message?.content ?? "" };
      } finally {
        deadline.clear();
      }
    },

    capabilities() {
      return { contextWindow: 8192, supportsJsonMode: true };
    },

    async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
      const baseUrl = BASE_URL();
      const model = CHAT_MODEL();
      // A health check that takes 30 s to say "no" is useless to a UI, so this
      // gets its own much shorter budget.
      const deadline = startDeadline(healthCheckTimeoutMs());
      try {
        let res: Response;
        try {
          res = await fetch(`${baseUrl}/api/tags`, { signal: deadline.signal });
        } catch (err) {
          return {
            ok: false,
            detail: deadline.timedOut
              ? `ollama provider: ${baseUrl} did not respond within ${deadline.ms}ms`
              : `ollama provider: cannot reach ${baseUrl}: ${(err as Error).message}`,
          };
        }
        if (!res.ok) {
          return {
            ok: false,
            detail: `ollama provider: ${baseUrl}/api/tags returned ${res.status} ${res.statusText}`,
          };
        }
        const json = (await res.json()) as { models?: { name: string }[] };
        const names = json.models?.map((m) => m.name) ?? [];
        const hasModel = names.some(
          (name) => name === model || name.startsWith(`${model}:`)
        );
        if (!hasModel) {
          return {
            ok: false,
            detail: `ollama provider: model '${model}' not found at ${baseUrl}. Available: ${
              names.join(", ") || "(none)"
            }`,
          };
        }
        return { ok: true };
      } finally {
        deadline.clear();
      }
    },
  };
}

interface OllamaEmbedResponse {
  embeddings: number[][];
}

/** Embedding provider backed by a local Ollama server (default 'nomic-embed-text', 768-dim). */
export function createOllamaEmbeddingProvider(): EmbeddingProvider {
  return {
    id: "ollama",
    dimensions: EMBED_DIMENSIONS,

    async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
      const baseUrl = BASE_URL();
      const model = EMBED_MODEL();
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        // Per batch, not per call: a 300-chunk ingest is 10 batches and must not
        // share one 15 s budget.
        const deadline = startDeadline(embeddingTimeoutMs(), signal);
        try {
          let res: Response;
          try {
            res = await fetch(`${baseUrl}/api/embed`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ model, input: batch }),
              signal: deadline.signal,
            });
          } catch (err) {
            throw describeFetchFailure(
              "ollama embedding provider",
              `${baseUrl}/api/embed`,
              deadline,
              err
            );
          }
          if (!res.ok) {
            throw new Error(
              `ollama embedding provider: embed request to ${baseUrl} failed (${res.status} ${res.statusText})`
            );
          }
          // Inside the deadline: fetch() resolves as soon as the headers arrive,
          // so reading the body is its own opportunity to hang — and to time out,
          // which must be reported as a timeout rather than as a bare abort.
          let json: OllamaEmbedResponse;
          try {
            json = (await res.json()) as OllamaEmbedResponse;
          } catch (err) {
            throw describeFetchFailure(
              "ollama embedding provider",
              `${baseUrl}/api/embed`,
              deadline,
              err
            );
          }
          for (const vector of json.embeddings ?? []) {
            if (vector.length !== EMBED_DIMENSIONS) {
              throw new Error(
                `ollama embedding provider: expected ${EMBED_DIMENSIONS}-dim vectors from '${model}', got ${vector.length}`
              );
            }
            results.push(vector);
          }
        } finally {
          deadline.clear();
        }
      }
      return results;
    },
  };
}
