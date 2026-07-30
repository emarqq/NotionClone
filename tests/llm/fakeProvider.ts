import type {
  ChatDelta,
  ChatRequest,
  EmbeddingProvider,
  GenerateRequest,
  GenerateResult,
  LLMProvider,
} from "@/lib/llm/types";

/**
 * An in-memory LLMProvider used to test the *interface contract itself*.
 *
 * Two jobs:
 *  1. It is the control for the shared contract suite — if a deliberately
 *     correct, dependency-free implementation cannot pass the suite, the suite
 *     is testing the wire format rather than the contract.
 *  2. It is the reference for anyone adding a third provider (the Anthropic
 *     provider in ARCHITECTURE §2/§5 is still unwritten): implement these five
 *     members with these semantics and the contract suite will accept it.
 *
 * Deliberately has no `fetch`, no env vars, and no I/O.
 */
export function createFakeLLMProvider(opts?: {
  id?: string;
  /** Deltas chatStream will emit, in order. Defaults to "Hello" + " world". */
  chunks?: string[];
  /** Text generate() resolves to. Defaults to the chunks joined. */
  generateText?: string;
  /** When set, chatStream and generate reject with this error. */
  failWith?: Error;
  healthy?: boolean;
  contextWindow?: number;
  supportsJsonMode?: boolean;
}): LLMProvider {
  const chunks = opts?.chunks ?? ["Hello", " world"];
  return {
    id: opts?.id ?? "fake",

    async *chatStream(req: ChatRequest): AsyncIterable<ChatDelta> {
      if (opts?.failWith) throw opts.failWith;
      for (const text of chunks) {
        // Honour cooperative cancellation the way a real provider must: a
        // caller that aborts mid-stream should stop receiving deltas.
        if (req.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        yield { text, done: false };
      }
      yield { text: "", done: true };
    },

    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (opts?.failWith) throw opts.failWith;
      if (req.signal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return { text: opts?.generateText ?? chunks.join("") };
    },

    capabilities() {
      return {
        contextWindow: opts?.contextWindow ?? 8192,
        supportsJsonMode: opts?.supportsJsonMode ?? true,
      };
    },

    async healthCheck() {
      return opts?.healthy === false
        ? { ok: false as const, detail: "fake provider: forced unhealthy" }
        : { ok: true as const };
    },
  };
}

/** In-memory EmbeddingProvider — deterministic vectors, correct dimensionality. */
export function createFakeEmbeddingProvider(dimensions = 768): EmbeddingProvider {
  return {
    id: "fake",
    dimensions,
    async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
      // The signal is part of the interface (D-009), so the fake honours it —
      // otherwise the contract suite would pass on the fake while a real
      // provider that ignored it also passed.
      if (signal?.aborted) {
        throw new Error("fake embedding provider: aborted before embedding");
      }
      // Deterministic and content-dependent, so a test can assert that two
      // different strings do not collide.
      return texts.map((t) => {
        const seed = [...t].reduce((acc, ch) => (acc + ch.charCodeAt(0)) % 997, 7);
        return Array.from({ length: dimensions }, (_, i) => ((seed + i) % 100) / 100);
      });
    },
  };
}
