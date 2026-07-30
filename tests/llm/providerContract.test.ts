import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOllamaEmbeddingProvider,
  createOllamaLLMProvider,
} from "@/lib/llm/providers/ollama";
import { createCustomFinetuneLLMProvider } from "@/lib/llm/providers/custom-finetune";
import type { ChatDelta, EmbeddingProvider, LLMProvider } from "@/lib/llm/types";
import { createFakeEmbeddingProvider, createFakeLLMProvider } from "./fakeProvider";

/**
 * One shared contract suite, run against every LLMProvider implementation.
 *
 * The point is that the SAME assertions run against the fake, Ollama and
 * custom-finetune. Each real provider supplies a `stubTransport` that fakes its
 * own wire format (Ollama NDJSON vs OpenAI SSE) — everything the suite asserts
 * about is provider-agnostic behaviour, which is what "implements the
 * interface consistently" actually has to mean.
 */

// --- helpers ---------------------------------------------------------------

/** A Response whose body streams the given string pieces. */
function streamResponse(pieces: string[], init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const p of pieces) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

async function collect(stream: AsyncIterable<ChatDelta>): Promise<ChatDelta[]> {
  const out: ChatDelta[] = [];
  for await (const d of stream) out.push(d);
  return out;
}

// --- per-provider transport stubs -----------------------------------------

interface Harness {
  name: string;
  make: () => LLMProvider;
  expectedId: string;
  /** Stub global fetch so the provider sees a well-formed streaming reply. */
  stubStream: (chunks: string[]) => void;
  /** Stub global fetch so the provider sees a well-formed non-stream reply. */
  stubGenerate: (text: string) => void;
  /** Stub global fetch returning a 200 whose JSON shape is unexpected. */
  stubMalformed: () => void;
  /** Stub global fetch returning an HTTP error. */
  stubHttpError: (status: number) => void;
  /** Stub global fetch that rejects (connection refused). */
  stubNetworkError: () => void;
  /** Stub global fetch so healthCheck() reports healthy. */
  stubHealthy: () => void;
}

/**
 * The fake has no transport to stub, so its "stubs" configure the next
 * provider instance instead. Same contract, same assertions, no fetch.
 */
let fakeNext: { chunks?: string[]; generateText?: string } = {};

const harnesses: Harness[] = [
  {
    name: "fake",
    make: () => createFakeLLMProvider(fakeNext),
    expectedId: "fake",
    stubStream: (chunks) => {
      fakeNext = { chunks };
    },
    stubGenerate: (text) => {
      fakeNext = { generateText: text };
    },
    stubMalformed: () => {},
    stubHttpError: () => {},
    stubNetworkError: () => {},
    stubHealthy: () => {},
  },
  {
    name: "ollama",
    make: () => createOllamaLLMProvider(),
    expectedId: "ollama",
    stubStream: (chunks) =>
      vi.stubGlobal("fetch", async () =>
        streamResponse([
          ...chunks.map(
            (c) => JSON.stringify({ message: { role: "assistant", content: c }, done: false }) + "\n"
          ),
          JSON.stringify({ message: { role: "assistant", content: "" }, done: true }) + "\n",
        ])
      ),
    stubGenerate: (text) =>
      vi.stubGlobal("fetch", async () =>
        Response.json({ message: { role: "assistant", content: text }, done: true })
      ),
    stubMalformed: () => vi.stubGlobal("fetch", async () => Response.json({ unexpected: true })),
    stubHttpError: (status) =>
      vi.stubGlobal("fetch", async () => new Response("upstream boom", { status })),
    stubNetworkError: () =>
      vi.stubGlobal("fetch", async () => {
        throw new TypeError("fetch failed");
      }),
    stubHealthy: () =>
      vi.stubGlobal("fetch", async () =>
        // Default OLLAMA_CHAT_MODEL is "llama3.1:8b".
        Response.json({ models: [{ name: "llama3.1:8b" }] })
      ),
  },
  {
    name: "custom-finetune",
    make: () => createCustomFinetuneLLMProvider(),
    expectedId: "custom-finetune",
    stubStream: (chunks) =>
      vi.stubGlobal("fetch", async () =>
        streamResponse([
          ...chunks.map(
            (c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`
          ),
          `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
          "data: [DONE]\n\n",
        ])
      ),
    stubGenerate: (text) =>
      vi.stubGlobal("fetch", async () =>
        Response.json({ choices: [{ message: { role: "assistant", content: text } }] })
      ),
    stubMalformed: () => vi.stubGlobal("fetch", async () => Response.json({ unexpected: true })),
    stubHttpError: (status) =>
      vi.stubGlobal("fetch", async () => new Response("upstream boom", { status })),
    stubNetworkError: () =>
      vi.stubGlobal("fetch", async () => {
        throw new TypeError("fetch failed");
      }),
    stubHealthy: () => vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 })),
  },
];

// --- the contract ----------------------------------------------------------

describe.each(harnesses)("LLMProvider contract: $name", (h) => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fakeNext = {};
  });

  it("exposes a stable non-empty string id", () => {
    const p = h.make();
    expect(p.id).toBe(h.expectedId);
    // id is declared `readonly` — it must not change between calls.
    expect(h.make().id).toBe(p.id);
  });

  it("implements every member of the interface as a function", () => {
    const p = h.make();
    expect(typeof p.chatStream).toBe("function");
    expect(typeof p.generate).toBe("function");
    expect(typeof p.capabilities).toBe("function");
    expect(typeof p.healthCheck).toBe("function");
  });

  it("capabilities() reports a positive context window and a boolean json-mode flag", () => {
    const caps = h.make().capabilities();
    expect(typeof caps.contextWindow).toBe("number");
    expect(caps.contextWindow).toBeGreaterThan(0);
    expect(typeof caps.supportsJsonMode).toBe("boolean");
  });

  it("chatStream() returns an async iterable whose deltas concatenate to the full reply", async () => {
    h.stubStream(["Hello", " world"]);
    const stream = h.make().chatStream({ messages: [{ role: "user", content: "hi" }] });
    expect(typeof (stream as AsyncIterable<ChatDelta>)[Symbol.asyncIterator]).toBe("function");

    const deltas = await collect(stream);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.map((d) => d.text).join("")).toBe("Hello world");
    // Every delta must carry a string `text`, even the terminal one.
    for (const d of deltas) expect(typeof d.text).toBe("string");
  });

  it("chatStream() signals completion with a final done delta", async () => {
    h.stubStream(["a"]);
    const deltas = await collect(h.make().chatStream({ messages: [{ role: "user", content: "hi" }] }));
    expect(deltas.at(-1)?.done).toBe(true);
  });

  it("generate() resolves to { text }", async () => {
    h.stubGenerate("the answer");
    const res = await h.make().generate({ prompt: "q" });
    expect(res).toHaveProperty("text");
    expect(res.text).toBe("the answer");
  });

  it("healthCheck() resolves to an { ok } verdict rather than throwing", async () => {
    h.stubHealthy();
    const res = await h.make().healthCheck();
    expect(typeof res.ok).toBe("boolean");
    expect(res.ok).toBe(true);
  });

  it("healthCheck() reports ok:false with a detail instead of throwing when the backend is unreachable", async () => {
    if (h.name === "fake") {
      const res = await createFakeLLMProvider({ healthy: false }).healthCheck();
      expect(res.ok).toBe(false);
      expect(res.detail).toBeTruthy();
      return;
    }
    h.stubNetworkError();
    const res = await h.make().healthCheck();
    expect(res.ok).toBe(false);
    // A failed health check must explain itself — this is the whole point of it.
    expect(res.detail).toBeTruthy();
  });

  it("propagates a transport failure out of generate() as an Error", async () => {
    if (h.name === "fake") {
      await expect(
        createFakeLLMProvider({ failWith: new Error("boom") }).generate({ prompt: "q" })
      ).rejects.toThrow("boom");
      return;
    }
    h.stubNetworkError();
    await expect(h.make().generate({ prompt: "q" })).rejects.toThrow(/failed to reach/i);
  });

  it("propagates a non-ok HTTP status out of generate() as an Error", async () => {
    if (h.name === "fake") return; // no transport to fail
    h.stubHttpError(500);
    await expect(h.make().generate({ prompt: "q" })).rejects.toThrow(/failed \(500/);
  });

  it("propagates a non-ok HTTP status out of chatStream() as an Error", async () => {
    if (h.name === "fake") return;
    h.stubHttpError(503);
    await expect(
      collect(h.make().chatStream({ messages: [{ role: "user", content: "hi" }] }))
    ).rejects.toThrow(/failed \(503/);
  });

  it("respects an already-aborted signal", async () => {
    h.stubGenerate("unused");
    const ac = new AbortController();
    ac.abort();
    // The fake checks the signal itself; the real providers hand it to fetch,
    // which rejects. Either way the caller must not get a normal result.
    if (h.name === "fake") {
      await expect(h.make().generate({ prompt: "q", signal: ac.signal })).rejects.toThrow();
      return;
    }
    // With fetch stubbed the signal is not honoured by the stub, so assert the
    // narrower, still-meaningful property: the provider passes fetch a signal
    // that is *already aborted* because the caller's was.
    //
    // Note it is deliberately NOT the caller's own signal object any more — since
    // C1 the providers wrap it in a deadline (lib/llm/timeout.ts) so a wedged
    // backend cannot hang forever. Identity would be the wrong assertion; the
    // behaviour that matters is that the abort propagates.
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init);
      return Response.json(
        h.name === "ollama"
          ? { message: { content: "x" } }
          : { choices: [{ message: { content: "x" } }] }
      );
    });
    await h.make().generate({ prompt: "q", signal: ac.signal });
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.signal?.aborted).toBe(true);
  });

  it("passes fetch a live (non-aborted) signal when the caller gives none", async () => {
    // Every outbound request must carry a deadline signal even when the caller
    // supplied nothing — that is the whole point of BUG-4's fix.
    if (h.name === "fake") return;
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init);
      return Response.json(
        h.name === "ollama"
          ? { message: { content: "x" } }
          : { choices: [{ message: { content: "x" } }] }
      );
    });
    await h.make().generate({ prompt: "q" });
    expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(seen[0]?.signal?.aborted).toBe(false);
  });

  /**
   * Documents a KNOWN SHARED WEAKNESS rather than asserting desired behaviour:
   * a 200 response whose JSON doesn't match the expected shape yields "" on
   * both real providers, making "the model returned nothing" indistinguishable
   * from "the upstream response was malformed".
   * See CODE_REVIEW.md. If that is ever fixed, this test SHOULD fail — update it.
   */
  it("KNOWN GAP: a malformed 200 response yields empty text instead of an error", async () => {
    if (h.name === "fake") return;
    h.stubMalformed();
    const res = await h.make().generate({ prompt: "q" });
    expect(res.text).toBe("");
  });
});

// --- the EmbeddingProvider contract ---------------------------------------

/**
 * `embed()` gained an `AbortSignal` in C1/D-009, and until then EmbeddingProvider
 * had no contract suite at all — which is how a HIGH-severity hang (a wedged
 * embedder blocking every /api/ai/chat before the first token) survived three
 * code reviews. Same shape as the LLMProvider suite: the same assertions run
 * against the fake and against Ollama.
 */
interface EmbedHarness {
  name: string;
  make: () => EmbeddingProvider;
  expectedId: string;
  /** Stub the transport to return `count` well-formed 768-dim vectors. */
  stubOk: (count: number) => void;
}

const embedHarnesses: EmbedHarness[] = [
  {
    name: "fake",
    make: () => createFakeEmbeddingProvider(),
    expectedId: "fake",
    stubOk: () => {},
  },
  {
    name: "ollama",
    make: () => createOllamaEmbeddingProvider(),
    expectedId: "ollama",
    stubOk: (count) =>
      // Honours the abort signal, as a real fetch does — a stub that ignored it
      // would let a provider that never passes the signal through pass this suite.
      vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) throw init.signal.reason ?? new Error("aborted");
        return Response.json({
          embeddings: Array.from({ length: count }, () => new Array(768).fill(0.5)),
        });
      }),
  },
];

describe.each(embedHarnesses)("EmbeddingProvider contract: $name", (h) => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes a stable id and the 768 dimensions the chunks.embedding column expects", () => {
    const p = h.make();
    expect(p.id).toBe(h.expectedId);
    // A mismatch here is a silent vector-space corruption, not a type error.
    expect(p.dimensions).toBe(768);
  });

  it("returns one vector per input text, each of the declared dimensionality", async () => {
    h.stubOk(2);
    const vectors = await h.make().embed(["alpha", "beta"]);
    expect(vectors).toHaveLength(2);
    for (const v of vectors) expect(v).toHaveLength(768);
  });

  it("accepts an AbortSignal and refuses to run when it is already aborted", async () => {
    h.stubOk(1);
    const ac = new AbortController();
    ac.abort();
    await expect(h.make().embed(["x"], ac.signal)).rejects.toThrow();
  });

  it("returns an empty array for no input without calling the transport", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", async (...args: unknown[]) => {
      calls.push(args);
      return Response.json({ embeddings: [] });
    });
    expect(await h.make().embed([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("rejects vectors of the wrong dimensionality rather than storing them", async () => {
    // The failure this guards is BUG-5's cousin: a model swap that returns
    // 1024-dim vectors must fail loudly, not half-fill a vector(768) column.
    if (h.name === "fake") return;
    vi.stubGlobal("fetch", async () =>
      Response.json({ embeddings: [new Array(1024).fill(0.1)] })
    );
    await expect(h.make().embed(["x"])).rejects.toThrow(/768-dim/);
  });
});

describe("fake provider (contract control)", () => {
  it("is a complete LLMProvider, so the suite above tests the contract, not the wire format", async () => {
    const p: LLMProvider = createFakeLLMProvider();
    const deltas = await collect(p.chatStream({ messages: [{ role: "user", content: "hi" }] }));
    expect(deltas.map((d) => d.text).join("")).toBe("Hello world");
    expect((await p.generate({ prompt: "x" })).text).toBe("Hello world");
    expect((await p.healthCheck()).ok).toBe(true);
  });

  it("stops yielding when the caller aborts mid-stream", async () => {
    const ac = new AbortController();
    const p = createFakeLLMProvider({ chunks: ["a", "b", "c"] });
    const stream = p.chatStream({ messages: [{ role: "user", content: "hi" }], signal: ac.signal });
    const iter = stream[Symbol.asyncIterator]();
    expect((await iter.next()).value).toEqual({ text: "a", done: false });
    ac.abort();
    await expect(iter.next()).rejects.toThrow(/abort/i);
  });
});
