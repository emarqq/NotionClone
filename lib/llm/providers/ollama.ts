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
        if (line) yield JSON.parse(line) as OllamaChatLine;
      }
    }
    const rest = buffer.trim();
    if (rest) yield JSON.parse(rest) as OllamaChatLine;
  } finally {
    reader.releaseLock();
  }
}

/** Chat/generation provider backed by a local Ollama server (default 'llama3.1:8b'). */
export function createOllamaLLMProvider(): LLMProvider {
  return {
    id: "ollama",

    async *chatStream(req: ChatRequest): AsyncIterable<ChatDelta> {
      const baseUrl = BASE_URL();
      const model = CHAT_MODEL();
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
          signal: req.signal,
        });
      } catch (err) {
        throw new Error(
          `ollama provider: failed to reach ${baseUrl}/api/chat: ${(err as Error).message}`
        );
      }
      if (!res.ok || !res.body) {
        throw new Error(
          `ollama provider: chat request to ${baseUrl} failed (${res.status} ${res.statusText})`
        );
      }
      for await (const line of readNdjson(res.body)) {
        const text = line.message?.content ?? "";
        if (text || line.done) yield { text, done: line.done };
      }
    },

    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const baseUrl = BASE_URL();
      const model = CHAT_MODEL();
      const messages: ChatMessage[] = toOllamaMessages(req.system, [
        { role: "user", content: req.prompt },
      ]);
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
          signal: req.signal,
        });
      } catch (err) {
        throw new Error(
          `ollama provider: failed to reach ${baseUrl}/api/chat: ${(err as Error).message}`
        );
      }
      if (!res.ok) {
        throw new Error(
          `ollama provider: generate request to ${baseUrl} failed (${res.status} ${res.statusText})`
        );
      }
      const json = (await res.json()) as OllamaChatLine;
      return { text: json.message?.content ?? "" };
    },

    capabilities() {
      return { contextWindow: 8192, supportsJsonMode: true };
    },

    async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
      const baseUrl = BASE_URL();
      const model = CHAT_MODEL();
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/tags`);
      } catch (err) {
        return {
          ok: false,
          detail: `ollama provider: cannot reach ${baseUrl}: ${(err as Error).message}`,
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

    async embed(texts: string[]): Promise<number[][]> {
      const baseUrl = BASE_URL();
      const model = EMBED_MODEL();
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        let res: Response;
        try {
          res = await fetch(`${baseUrl}/api/embed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, input: batch }),
          });
        } catch (err) {
          throw new Error(
            `ollama embedding provider: failed to reach ${baseUrl}/api/embed: ${
              (err as Error).message
            }`
          );
        }
        if (!res.ok) {
          throw new Error(
            `ollama embedding provider: embed request to ${baseUrl} failed (${res.status} ${res.statusText})`
          );
        }
        const json = (await res.json()) as OllamaEmbedResponse;
        for (const vector of json.embeddings ?? []) {
          if (vector.length !== EMBED_DIMENSIONS) {
            throw new Error(
              `ollama embedding provider: expected ${EMBED_DIMENSIONS}-dim vectors from '${model}', got ${vector.length}`
            );
          }
          results.push(vector);
        }
      }
      return results;
    },
  };
}
