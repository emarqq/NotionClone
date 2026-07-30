/**
 * Tests for `lib/llm/redact.ts` — CODE_REVIEW §L4.
 *
 * Provider errors deliberately embed the model server's base URL, which is what
 * makes a server log useful; the problem was that `/api/ai/chat` and
 * `/api/ai/edit` forwarded that message to the browser verbatim. Low impact for a
 * single-user local app, and no API key was ever in these strings, but the
 * renderer has no business learning the backend's address.
 */

import { describe, expect, it, vi } from "vitest";
import { clientSafeMessage, logAndRedact } from "@/lib/llm/redact";

describe("clientSafeMessage", () => {
  it("replaces an http URL with a neutral phrase", () => {
    const msg = clientSafeMessage(
      new Error("ollama provider: failed to reach http://localhost:11434/api/chat: ECONNREFUSED")
    );
    expect(msg).not.toContain("localhost");
    expect(msg).not.toContain("11434");
    expect(msg).toContain("the model server");
    // Still a readable sentence — that is why it substitutes rather than deletes.
    expect(msg).toContain("ECONNREFUSED");
  });

  it("replaces every URL in a message, not just the first", () => {
    const msg = clientSafeMessage(
      new Error("tried http://a.internal:8000/v1 then https://b.internal:8443/v1")
    );
    expect(msg).not.toMatch(/internal/);
  });

  it("handles non-http schemes too", () => {
    expect(clientSafeMessage(new Error("cannot reach unix:///var/run/ollama.sock"))).not.toContain(
      "/var/run"
    );
  });

  it("leaves a message with no URL untouched", () => {
    const text = "ollama provider: request timed out after 30000ms — the model may still be loading";
    expect(clientSafeMessage(new Error(text))).toBe(text);
  });

  it("keeps the env-var hint, which is the actionable part of a timeout message", () => {
    const msg = clientSafeMessage(
      new Error("ollama provider: request to http://localhost:11434 timed out. Raise LLM_TIMEOUT_MS")
    );
    expect(msg).toContain("LLM_TIMEOUT_MS");
  });

  it("copes with a non-Error and with an empty message", () => {
    expect(clientSafeMessage("plain string")).toBe("plain string");
    expect(clientSafeMessage(new Error(""))).toBe("The model server could not be reached.");
    expect(clientSafeMessage(undefined)).toBe("The model server could not be reached.");
  });

  it("does not leave a bare colon when the URL was the whole message", () => {
    expect(clientSafeMessage(new Error("http://localhost:11434"))).toBe("the model server");
  });
});

describe("logAndRedact", () => {
  it("logs the full message server-side and returns only the redacted one", () => {
    // The §L4 failure mode was that the detailed message was the ONLY message —
    // keeping the log and the redaction in one call makes it hard to do half of it.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = new Error("failed to reach http://localhost:11434/api/chat");
      const out = logAndRedact("ai/chat stream failed", err);
      expect(out).not.toContain("11434");
      expect(spy).toHaveBeenCalledWith("ai/chat stream failed:", err);
    } finally {
      spy.mockRestore();
    }
  });
});
