/**
 * Tests for POST /api/ai/chat's stream lifecycle — specifically C2 / CODE_REVIEW
 * §R1: a provider failure *after* tokens started arriving used to rethrow, which
 * jumped to the outer catch and skipped persistence entirely. The user watched 30
 * tokens stream in, then the assistant turn vanished from history on the next
 * refresh. The client-abort path had always persisted correctly, which is what
 * made the gap easy to miss.
 *
 * Everything below the route is mocked: the point is the route's own control flow
 * (what gets persisted, with what marker, and what the client is told), not
 * Postgres, not Ollama.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatDelta } from "@/lib/llm/types";

// --- mocks (must be declared before the route is imported) -----------------

interface PersistedMessage {
  conversationId: string;
  role: string;
  content: string;
}

const persisted: PersistedMessage[] = [];
let streamScript: () => AsyncIterable<ChatDelta>;

vi.mock("@/lib/db/ai", () => ({
  getConversation: vi.fn(async () => null),
  createConversation: vi.fn(async () => ({ id: "conv-1" })),
  getMessages: vi.fn(async () => []),
  addMessage: vi.fn(async (conversationId: string, role: string, content: string) => {
    persisted.push({ conversationId, role, content });
  }),
}));

vi.mock("@/lib/rag/retriever", () => ({
  retrieve: vi.fn(async () => []),
}));

vi.mock("@/lib/rag/prompt", () => ({
  buildRagPrompt: () => ({ system: "sys", user: "usr" }),
}));

vi.mock("@/lib/llm/registry", () => ({
  getLLMProvider: async () => ({
    id: "scripted",
    chatStream: () => streamScript(),
    generate: async () => ({ text: "" }),
    capabilities: () => ({ contextWindow: 8192, supportsJsonMode: true }),
    healthCheck: async () => ({ ok: true }),
  }),
}));

// enrichSources() short-circuits on an empty source list, so Supabase is never
// reached — but the module is imported at load time and must still resolve.
vi.mock("@/lib/supabase/server", () => ({
  createServiceSupabase: () => {
    throw new Error("createServiceSupabase should not be called with zero sources");
  },
}));

const { POST } = await import("@/app/api/ai/chat/route");

// --- helpers ---------------------------------------------------------------

interface SseEvent {
  type: string;
  text?: string;
  message?: string;
  partial?: boolean;
  retryable?: boolean;
}

async function post(signal?: AbortSignal): Promise<SseEvent[]> {
  const request = new Request("http://localhost/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message: "what did we decide about X?" }),
    ...(signal ? { signal } : {}),
  });
  // The route only uses `.json()` and `.signal`, both of which a plain Request has.
  const res = await POST(request as never);
  const text = await res.text();
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((l) => l.startsWith("data:")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(5).trim()) as SseEvent);
}

function scripted(chunks: string[], failAfter?: Error) {
  streamScript = async function* () {
    for (const text of chunks) yield { text, done: false };
    if (failAfter) throw failAfter;
    yield { text: "", done: true };
  };
}

beforeEach(() => {
  persisted.length = 0;
  scripted(["Hello", " world"]);
});

// --- the happy path, as a control -----------------------------------------

describe("POST /api/ai/chat — successful stream", () => {
  it("streams deltas and persists the user turn then the full assistant turn", async () => {
    const events = await post();

    expect(events.map((e) => e.type)).toEqual(["meta", "delta", "delta", "done"]);
    expect(events.filter((e) => e.type === "delta").map((e) => e.text).join("")).toBe(
      "Hello world"
    );
    expect(persisted).toEqual([
      { conversationId: "conv-1", role: "user", content: "what did we decide about X?" },
      { conversationId: "conv-1", role: "assistant", content: "Hello world" },
    ]);
  });

  it("does not tag a complete answer with any marker", async () => {
    await post();
    const assistant = persisted.find((m) => m.role === "assistant")!;
    expect(assistant.content).not.toMatch(/_\(/);
  });
});

// --- §R1: the regression this file exists for ------------------------------

describe("POST /api/ai/chat — provider fails mid-stream (§R1 / C2)", () => {
  it("persists what streamed instead of dropping it", async () => {
    scripted(["Partial ", "answer"], new Error("ollama provider: connection reset"));

    await post();

    const assistant = persisted.find((m) => m.role === "assistant");
    expect(assistant, "the partial answer was dropped — this is R1").toBeDefined();
    expect(assistant!.content).toContain("Partial answer");
  });

  it("marks the saved turn as incomplete and says why", async () => {
    scripted(["Partial ", "answer"], new Error("ollama provider: connection reset"));

    await post();

    const assistant = persisted.find((m) => m.role === "assistant")!;
    // Distinguishable from a client abort, which uses `_(response interrupted)_`.
    expect(assistant.content).toMatch(/_\(response incomplete — .*connection reset.*\)_/);
  });

  it("tells the client the failure is retryable and that a partial was saved", async () => {
    scripted(["Partial"], new Error("boom"));

    const events = await post();
    const error = events.find((e) => e.type === "error")!;

    expect(error.message).toBe("boom");
    expect(error.partial).toBe(true);
    expect(error.retryable).toBe(true);
    // An error and a done would let the UI think the answer finished cleanly.
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("reports partial:false when the failure came before any token", async () => {
    streamScript = async function* () {
      // Fails before yielding anything — a model that is not loaded yet.
      if (true as boolean) throw new Error("model not loaded");
      yield { text: "", done: true };
    };

    const events = await post();
    const error = events.find((e) => e.type === "error")!;

    expect(error.partial).toBe(false);
    expect(error.retryable).toBe(true);
    // Nothing streamed, so there is no assistant turn worth keeping.
    expect(persisted.filter((m) => m.role === "assistant")).toHaveLength(0);
  });

  it("still records the user's question, so a retry has something to retry", async () => {
    scripted([], new Error("boom"));
    await post();
    expect(persisted.some((m) => m.role === "user")).toBe(true);
  });
});
