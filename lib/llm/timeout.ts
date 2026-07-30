import "server-only";

/**
 * Deadlines for every outbound LLM / embedding fetch.
 *
 * Why this exists: none of the provider fetches had a timeout, so a wedged
 * Ollama — a model still loading, a stuck GPU, a half-open socket — hung every
 * `/api/ai/chat` request *forever* and leaked one connection per edit for as
 * long as the outage lasted, in a Next server that stays up for days
 * (CODE_REVIEW §L1, BUG-4). Defaults are chosen here rather than asked about;
 * see decision D-009.
 *
 * **Streams get an *idle* deadline, not a total one.** A 30 s cap on the whole
 * response would kill legitimate long answers from an 8B local model, which is a
 * worse bug than the one being fixed. The rule is: 30 s to produce *the next*
 * token. A generating model refreshes the clock constantly; a wedged one does
 * not. Callers streaming a response must call `refresh()` for every chunk.
 */

/** 30 s to the next token / to a complete non-streamed generation (D-009). */
export const DEFAULT_LLM_TIMEOUT_MS = 30_000;
/** 15 s per embedding batch — embeddings are sub-second, so this is 20× headroom (D-009). */
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 15_000;
/**
 * 5 s for a health check. Deliberately much shorter than the request timeout:
 * the entire purpose of a health check is to answer "is this thing up?" quickly,
 * and a probe that takes 30 s to say "no" is useless to a UI.
 */
export const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 5_000;

/**
 * Reads a positive-integer millisecond value from the environment.
 * `0` explicitly disables the deadline — an escape hatch for a genuinely slow
 * model on a slow machine, so nobody has to patch the source to unblock
 * themselves. Anything unparseable falls back to the default rather than
 * silently disabling the protection.
 */
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export const llmTimeoutMs = () => envMs("LLM_TIMEOUT_MS", DEFAULT_LLM_TIMEOUT_MS);
export const embeddingTimeoutMs = () =>
  envMs("EMBEDDING_TIMEOUT_MS", DEFAULT_EMBEDDING_TIMEOUT_MS);
export const healthCheckTimeoutMs = () =>
  envMs("LLM_HEALTHCHECK_TIMEOUT_MS", DEFAULT_HEALTHCHECK_TIMEOUT_MS);

export interface Deadline {
  /** Pass to `fetch`. Aborts on timeout, or when `upstream` aborts. */
  readonly signal: AbortSignal;
  /** True once *this* deadline fired — distinguishes a timeout from a user abort. */
  readonly timedOut: boolean;
  /** The configured budget, for error messages. */
  readonly ms: number;
  /** Restart the clock. Call on every streamed chunk. No-op once fired. */
  refresh(): void;
  /** Stop the clock and detach listeners. Always call this in a `finally`. */
  clear(): void;
}

/**
 * A deadline that also forwards an upstream abort (the client disconnecting).
 *
 * Deliberately hand-rolled rather than `AbortSignal.any([s, AbortSignal.timeout(ms)])`:
 * that composition cannot be refreshed (so it can only express a total cap, not
 * an idle one) and gives no way to tell a timeout apart from a client abort —
 * and those two need different handling, because one is an error worth
 * surfacing and the other is not.
 */
export function startDeadline(ms: number, upstream?: AbortSignal): Deadline {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  let settled = false;

  const onUpstreamAbort = () => {
    settled = true;
    if (timer) clearTimeout(timer);
    timer = null;
    controller.abort(upstream?.reason);
  };

  const arm = () => {
    if (settled || ms <= 0) return;
    timer = setTimeout(() => {
      timedOut = true;
      settled = true;
      timer = null;
      controller.abort(new Error(`timed out after ${ms}ms`));
    }, ms);
    // Never let a pending deadline hold the process open.
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  if (upstream?.aborted) {
    settled = true;
    controller.abort(upstream.reason);
  } else {
    upstream?.addEventListener("abort", onUpstreamAbort, { once: true });
    arm();
  }

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    ms,
    refresh() {
      if (settled) return;
      if (timer) clearTimeout(timer);
      timer = null;
      arm();
    },
    clear() {
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      upstream?.removeEventListener("abort", onUpstreamAbort);
    },
  };
}

/**
 * Uniform message for a fetch that failed, so a timeout reads as a timeout
 * instead of as the generic `fetch failed` / `This operation was aborted` that
 * both a wedged model and a real network error otherwise produce.
 */
export function describeFetchFailure(
  who: string,
  url: string,
  deadline: Deadline,
  err: unknown
): Error {
  if (deadline.timedOut) {
    return new Error(
      `${who}: request to ${url} timed out after ${deadline.ms}ms — the model may still be ` +
        `loading or the server is wedged. Raise LLM_TIMEOUT_MS / EMBEDDING_TIMEOUT_MS if this is expected.`
    );
  }
  // A client abort must keep its identity. Callers distinguish "the user cancelled"
  // from "something broke" by `err.name === "AbortError"` (app/api/ai/edit/route.ts),
  // and rewrapping it as a plain Error made an abort look like a failure: the edit
  // route then wrote to a stream whose consumer was gone and threw
  // `TypeError: Invalid state` out of its own catch.
  if (isAbortError(err)) return err as Error;
  // Not every failure here is a transport failure — `readNdjson` / `readSse`
  // JSON.parse their input, so malformed output from a *reachable* server would
  // otherwise be reported as "failed to reach", and (since D-011 writes the reason
  // into the conversation) that wrong diagnosis becomes part of Erik's notes.
  if (err instanceof SyntaxError) {
    return new Error(`${who}: malformed response from ${url}: ${err.message}`);
  }
  return new Error(`${who}: failed to reach ${url}: ${(err as Error)?.message ?? String(err)}`);
}

/** True for a DOMException/Error raised by an aborted fetch or stream read. */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}
