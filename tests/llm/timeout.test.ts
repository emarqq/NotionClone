/**
 * Tests for the deadline layer added in C1 (BUG-4 / CODE_REVIEW §L1 / D-009).
 *
 * The bug being pinned: before this, *no* LLM or embedding fetch had a timeout,
 * so a wedged Ollama — a model still loading, a stuck GPU, a half-open socket —
 * hung every `/api/ai/chat` forever and leaked a connection per edit for the
 * duration of the outage, in a server that stays up for days.
 *
 * The subtle half is that the fix must NOT be a cap on total response time: an
 * 8B local model can legitimately spend minutes on a long answer. Streams get an
 * *idle* deadline (time to the next token), and "a slow-but-alive stream is not
 * killed" is asserted here explicitly, because getting that wrong would trade a
 * hang for truncated answers, which is worse.
 *
 * Timeouts here are deliberately tiny (20–60 ms real time) so the suite stays
 * fast; the env getters are read per call, so setting `LLM_TIMEOUT_MS` per test
 * is enough.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EMBEDDING_TIMEOUT_MS,
  DEFAULT_HEALTHCHECK_TIMEOUT_MS,
  DEFAULT_LLM_TIMEOUT_MS,
  embeddingTimeoutMs,
  healthCheckTimeoutMs,
  llmTimeoutMs,
  startDeadline,
} from "@/lib/llm/timeout";
import {
  createOllamaEmbeddingProvider,
  createOllamaLLMProvider,
} from "@/lib/llm/providers/ollama";
import { createCustomFinetuneLLMProvider } from "@/lib/llm/providers/custom-finetune";
import type { ChatDelta } from "@/lib/llm/types";

const ENV_KEYS = [
  "LLM_TIMEOUT_MS",
  "EMBEDDING_TIMEOUT_MS",
  "LLM_HEALTHCHECK_TIMEOUT_MS",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A fetch that never resolves on its own — only the abort signal ends it. */
function stubHangingFetch(): { aborts: number } {
  const state = { aborts: 0 };
  vi.stubGlobal(
    "fetch",
    (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // hangs forever — which is the bug, and must not happen
        const onAbort = () => {
          state.aborts += 1;
          reject(signal.reason ?? new Error("aborted"));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      })
  );
  return state;
}

async function collect(stream: AsyncIterable<ChatDelta>): Promise<ChatDelta[]> {
  const out: ChatDelta[] = [];
  for await (const d of stream) out.push(d);
  return out;
}

// --- configuration ---------------------------------------------------------

describe("timeout configuration", () => {
  it("uses the D-009 defaults when the environment says nothing", () => {
    for (const k of ENV_KEYS) delete process.env[k];
    expect(llmTimeoutMs()).toBe(DEFAULT_LLM_TIMEOUT_MS);
    expect(embeddingTimeoutMs()).toBe(DEFAULT_EMBEDDING_TIMEOUT_MS);
    expect(healthCheckTimeoutMs()).toBe(DEFAULT_HEALTHCHECK_TIMEOUT_MS);
    // The health check must be much snappier than a real request, or a UI
    // asking "is Ollama up?" blocks for the full request budget.
    expect(healthCheckTimeoutMs()).toBeLessThan(llmTimeoutMs());
  });

  it("is overridable by env", () => {
    process.env.LLM_TIMEOUT_MS = "1234";
    process.env.EMBEDDING_TIMEOUT_MS = "77";
    expect(llmTimeoutMs()).toBe(1234);
    expect(embeddingTimeoutMs()).toBe(77);
  });

  it("treats 0 as an explicit opt-out rather than as 'immediately'", () => {
    process.env.LLM_TIMEOUT_MS = "0";
    expect(llmTimeoutMs()).toBe(0);
  });

  it("falls back to the default on junk instead of silently disabling protection", () => {
    // Silently turning the timeout off because someone typed 'thirty' would
    // reintroduce BUG-4 invisibly.
    for (const junk of ["thirty", "-5", "", "  "]) {
      process.env.LLM_TIMEOUT_MS = junk;
      expect(llmTimeoutMs()).toBe(DEFAULT_LLM_TIMEOUT_MS);
    }
  });
});

// --- the Deadline primitive ------------------------------------------------

describe("startDeadline", () => {
  it("aborts after the budget and reports timedOut", async () => {
    const d = startDeadline(20);
    expect(d.signal.aborted).toBe(false);
    await sleep(45);
    expect(d.signal.aborted).toBe(true);
    expect(d.timedOut).toBe(true);
    d.clear();
  });

  it("refresh() restarts the clock, so a busy stream is never killed", async () => {
    const d = startDeadline(40);
    for (let i = 0; i < 5; i++) {
      await sleep(20);
      d.refresh();
    }
    // 100 ms elapsed against a 40 ms budget, but never 40 ms idle.
    expect(d.signal.aborted).toBe(false);
    await sleep(60);
    expect(d.timedOut).toBe(true);
    d.clear();
  });

  it("clear() stops the clock, so a finished request cannot abort later", async () => {
    const d = startDeadline(20);
    d.clear();
    await sleep(45);
    expect(d.signal.aborted).toBe(false);
    expect(d.timedOut).toBe(false);
  });

  it("forwards an upstream abort and does not call it a timeout", () => {
    const ac = new AbortController();
    const d = startDeadline(10_000, ac.signal);
    ac.abort(new Error("client went away"));
    expect(d.signal.aborted).toBe(true);
    // The distinction matters: a client disconnect is not an error to surface.
    expect(d.timedOut).toBe(false);
    d.clear();
  });

  it("is already aborted when the upstream signal was aborted before it started", () => {
    const ac = new AbortController();
    ac.abort();
    const d = startDeadline(10_000, ac.signal);
    expect(d.signal.aborted).toBe(true);
    expect(d.timedOut).toBe(false);
    d.clear();
  });

  it("never fires when the budget is 0 (opt-out)", async () => {
    const d = startDeadline(0);
    await sleep(30);
    expect(d.signal.aborted).toBe(false);
    d.clear();
  });
});

// --- provider behaviour ----------------------------------------------------

describe("ollama provider honours the deadline", () => {
  it("chatStream() gives up on a hung backend instead of hanging forever", async () => {
    process.env.LLM_TIMEOUT_MS = "30";
    const state = stubHangingFetch();
    await expect(
      collect(createOllamaLLMProvider().chatStream({ messages: [{ role: "user", content: "hi" }] }))
    ).rejects.toThrow(/timed out after 30ms/);
    expect(state.aborts).toBe(1);
  });

  it("generate() gives up on a hung backend", async () => {
    process.env.LLM_TIMEOUT_MS = "30";
    stubHangingFetch();
    await expect(createOllamaLLMProvider().generate({ prompt: "q" })).rejects.toThrow(
      /timed out after 30ms/
    );
  });

  it("the timeout message names the env var, so it is self-servicing", async () => {
    process.env.LLM_TIMEOUT_MS = "20";
    stubHangingFetch();
    await expect(createOllamaLLMProvider().generate({ prompt: "q" })).rejects.toThrow(
      /LLM_TIMEOUT_MS/
    );
  });

  it("does NOT kill a slow-but-alive stream — the deadline is idle, not total", async () => {
    // The regression this guards against is trading a hang for truncated
    // answers: 6 chunks × 25 ms = 150 ms total against a 60 ms budget, all fine
    // because no single gap exceeds it.
    process.env.LLM_TIMEOUT_MS = "60";
    vi.stubGlobal("fetch", async () => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const piece of ["a", "b", "c", "d", "e"]) {
            await sleep(25);
            controller.enqueue(
              enc.encode(JSON.stringify({ message: { content: piece }, done: false }) + "\n")
            );
          }
          await sleep(25);
          controller.enqueue(
            enc.encode(JSON.stringify({ message: { content: "" }, done: true }) + "\n")
          );
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });

    const deltas = await collect(
      createOllamaLLMProvider().chatStream({ messages: [{ role: "user", content: "hi" }] })
    );
    expect(deltas.map((d) => d.text).join("")).toBe("abcde");
    expect(deltas.at(-1)?.done).toBe(true);
  });

  it("embed() gives up on a hung backend, per batch", async () => {
    process.env.EMBEDDING_TIMEOUT_MS = "30";
    stubHangingFetch();
    await expect(createOllamaEmbeddingProvider().embed(["x"])).rejects.toThrow(
      /timed out after 30ms/
    );
  });

  it("embed() forwards a caller abort without calling it a timeout", async () => {
    process.env.EMBEDDING_TIMEOUT_MS = "10000";
    stubHangingFetch();
    const ac = new AbortController();
    const pending = createOllamaEmbeddingProvider().embed(["x"], ac.signal);
    ac.abort(new Error("client went away"));
    await expect(pending).rejects.toThrow(/failed to reach/);
    await expect(pending).rejects.not.toThrow(/timed out/);
  });

  it("healthCheck() answers ok:false on a hung backend instead of blocking", async () => {
    process.env.LLM_HEALTHCHECK_TIMEOUT_MS = "30";
    stubHangingFetch();
    const res = await createOllamaLLMProvider().healthCheck();
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/did not respond within 30ms/);
  });
});

describe("custom-finetune provider honours the deadline", () => {
  it("chatStream() gives up on a hung backend", async () => {
    process.env.LLM_TIMEOUT_MS = "30";
    stubHangingFetch();
    await expect(
      collect(
        createCustomFinetuneLLMProvider().chatStream({
          messages: [{ role: "user", content: "hi" }],
        })
      )
    ).rejects.toThrow(/timed out after 30ms/);
  });

  it("generate() gives up on a hung backend", async () => {
    process.env.LLM_TIMEOUT_MS = "30";
    stubHangingFetch();
    await expect(createCustomFinetuneLLMProvider().generate({ prompt: "q" })).rejects.toThrow(
      /timed out after 30ms/
    );
  });

  it("healthCheck() answers ok:false on a hung backend", async () => {
    process.env.LLM_HEALTHCHECK_TIMEOUT_MS = "30";
    stubHangingFetch();
    const res = await createCustomFinetuneLLMProvider().healthCheck();
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/did not respond within 30ms/);
  });
});
