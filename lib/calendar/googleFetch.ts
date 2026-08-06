import "server-only";

import { GoogleApiError } from "./types";

/**
 * The one place outbound Google requests are made.
 *
 * Adds three things every call needs and none should re-implement: a deadline
 * (a wedged socket must never hang a route the way BUG-4 hung /api/ai/chat),
 * error bodies parsed into a `reason` string so callers can branch on
 * `invalid_grant` / `rateLimitExceeded` without re-parsing JSON, and truncated
 * exponential backoff on the retryable classes Google documents.
 */

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 4;

/**
 * Google returns two different error envelopes: the OAuth token endpoint uses
 * `{ error, error_description }` while the Calendar API uses
 * `{ error: { code, message, errors: [{ reason }] } }`. Both collapse to a
 * reason string here.
 */
function parseErrorReason(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { errors?: { reason?: string }[]; status?: string };
    };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error && typeof parsed.error === "object") {
      return parsed.error.errors?.[0]?.reason ?? parsed.error.status ?? null;
    }
  } catch {
    // Non-JSON body (an HTML error page from a proxy, say) — no reason to give.
  }
  return null;
}

/** 5xx and rate limits are transient; everything else is the caller's problem. */
function isRetryable(error: GoogleApiError): boolean {
  return error.status >= 500 || error.isRateLimited;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch a Google endpoint, returning parsed JSON or throwing GoogleApiError.
 *
 * `attempt` jitter is deliberately deterministic-free (Math.random) — this runs
 * server-side only and never in a workflow script.
 */
export async function googleFetch<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  let lastError: GoogleApiError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...rest,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (err) {
      // Network failure / timeout. Treat like a 503 so it gets the same backoff.
      lastError = new GoogleApiError(
        503,
        "network",
        String(err),
        `Google request failed: ${err instanceof Error ? err.message : String(err)}`
      );
      if (attempt === MAX_ATTEMPTS - 1) throw lastError;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) {
      // 204 (events.delete) and any empty body parse as undefined, not a throw.
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }

    const body = await response.text();
    const error = new GoogleApiError(
      response.status,
      parseErrorReason(body),
      body
    );
    if (!isRetryable(error) || attempt === MAX_ATTEMPTS - 1) throw error;

    // Honour Retry-After when Google sends one, else truncated exponential.
    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : backoffMs(attempt)
    );
    lastError = error;
  }

  throw lastError ?? new GoogleApiError(500, null, "", "Google request failed");
}

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 500, 8_000) + Math.floor(Math.random() * 400);
}
