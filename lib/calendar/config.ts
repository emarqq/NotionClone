import "server-only";

import { requireEnv } from "@/lib/env";

/**
 * Google Calendar connector configuration.
 *
 * Setup instructions for the two env vars are in docs/GOOGLE-CALENDAR.md; the
 * app degrades gracefully without them (the /calendar page renders a setup card
 * instead of throwing), so `isConfigured()` is the guard every entry point uses
 * before touching `googleClientId()` / `googleClientSecret()`.
 */

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/**
 * Scopes requested at connect time.
 *
 * `calendar.events` (not `calendar`) is the minimum that covers read + create +
 * update + delete of events on every calendar the user can write to, including
 * secondary calendars like a dedicated "School" one — which is exactly the
 * boundary we want. `calendar.readonly` is added for calendarList metadata
 * (names, colours, timezones); `calendar.events` alone does not grant it.
 * userinfo.email is what lets us label the connected account in the UI.
 *
 * Changing this list requires the user to reconnect: Google grants scopes at
 * consent time and a stored refresh token keeps the scopes it was issued with.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

/**
 * Origins the OAuth callback is allowed to run on.
 *
 * Google matches `redirect_uri` byte-for-byte against the list registered in
 * Cloud Console, and this app is reachable on two ports — :3000 (the dev
 * server) and :3777 (the production server the Electron desktop shell loads).
 * Both must be registered there and both are allowed here. The allowlist exists
 * so a request arriving with a spoofed Host header can't redirect the consent
 * code somewhere else.
 */
const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3777",
  "http://127.0.0.1:3777",
];

export const OAUTH_CALLBACK_PATH = "/api/calendar/auth/callback";

export function googleClientId(): string {
  return requireEnv("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID);
}

export function googleClientSecret(): string {
  return requireEnv("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET);
}

/** True when both OAuth credentials are present. */
export function isConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * The redirect URI to use for a request that arrived at `requestUrl`.
 *
 * Derived from the request rather than hard-coded because the same build serves
 * both ports, and the URI sent to Google must match the one the browser comes
 * back to. `GOOGLE_OAUTH_REDIRECT_URI` overrides it for unusual setups (a
 * different port, or a reverse proxy).
 */
export function redirectUriFor(requestUrl: string | URL): string {
  const override = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (override) return override;

  const origin = new URL(requestUrl).origin;
  if (!ALLOWED_ORIGINS.includes(origin)) {
    throw new Error(
      `Google Calendar OAuth refused for origin ${origin}. Allowed: ` +
        `${ALLOWED_ORIGINS.join(", ")}. Set GOOGLE_OAUTH_REDIRECT_URI to use a ` +
        `different one, and register it in the Google Cloud Console client.`
    );
  }
  return `${origin}${OAUTH_CALLBACK_PATH}`;
}

/**
 * How much history the first (full) sync of a calendar pulls.
 *
 * A full sync is bounded by `timeMin` so connecting an account with ten years of
 * history doesn't page through thousands of events; incremental syncs after it
 * are unbounded because `syncToken` forbids being combined with a time filter.
 * The practical consequence: events older than this that later get *edited*
 * will appear, and older ones that are never touched stay invisible. That is
 * the right trade for a class-schedule and recruiting calendar.
 */
export function syncPastDays(): number {
  // Must be >= the calendar page's backward render window (WINDOW_PAST_DAYS in
  // app/(workspace)/calendar/page.tsx), or the oldest weeks the grid can scroll
  // to are guaranteed empty because sync never fetched them.
  return positiveInt(process.env.CALENDAR_SYNC_PAST_DAYS, 120);
}

/** Minimum gap between automatic background syncs, in seconds. */
export function autoSyncIntervalSeconds(): number {
  return positiveInt(process.env.CALENDAR_SYNC_INTERVAL_SECONDS, 300);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Re-exported for callers that already import from config; defined in
 *  types.ts so the pure normalizer can use them without pulling server-only. */
export { MANAGED_MARKER_KEY, MANAGED_PAGE_KEY } from "./types";
