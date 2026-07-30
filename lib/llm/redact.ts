import "server-only";

/**
 * Strips internal endpoint details out of an error message before it is sent to
 * the browser (CODE_REVIEW §L4).
 *
 * The providers deliberately put `baseUrl` into their errors — that is what makes
 * a server log useful — but `/api/ai/chat` and `/api/ai/edit` forward the message
 * verbatim over SSE, so `http://localhost:11434` and any custom endpoint went
 * straight to the client. Low impact for a single-user local app (and no API key
 * has ever been in these messages — `authHeaders()` is never stringified), but
 * there is no reason for the renderer to learn the backend's address, and the
 * habit is wrong if this ever runs anywhere else.
 *
 * A URL is replaced rather than removed so the message still reads as a sentence:
 * "failed to reach the model server" beats "failed to reach : ECONNREFUSED".
 */
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s,)'"]+/gi;

export function clientSafeMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const redacted = raw.replace(URL_PATTERN, "the model server").trim();
  return redacted.length > 0 ? redacted : "The model server could not be reached.";
}

/**
 * Log the full message (endpoints included) server-side, return the redacted one
 * for the client. Keeping these together makes it hard to accidentally do only
 * half of it — the failure mode of §L4 was that the detailed message was the
 * *only* message.
 */
export function logAndRedact(context: string, err: unknown): string {
  console.error(`${context}:`, err);
  return clientSafeMessage(err);
}
