/**
 * Shapes of the Google Calendar API v3 resources this app reads.
 *
 * Hand-written rather than pulled from `googleapis`: we call five endpoints,
 * and the generated client is a ~72 MB dependency carrying every Google API's
 * typings. Everything here is optional-by-default because the API omits fields
 * freely — an event with no description has no `description` key at all.
 *
 * Pure types + pure helpers only (no "server-only"): normalize.ts and the tests
 * import this in plain Node.
 *
 * Reference: https://developers.google.com/workspace/calendar/api/v3/reference/events
 */

/**
 * Markers written into `extendedProperties.private` on every event this app
 * creates in Google. Inbound sync uses them to recognise its own writes, which
 * is what stops the classic two-way-sync echo loop.
 */
export const MANAGED_MARKER_KEY = "notionCloneManaged";
export const MANAGED_PAGE_KEY = "notionClonePageId";

/** `{ date }` for an all-day event, `{ dateTime, timeZone }` for a timed one. */
export interface GoogleEventDateTime {
  /** All-day: "YYYY-MM-DD". On `end`, Google's value is EXCLUSIVE. */
  date?: string | null;
  /** Timed: RFC3339 with offset, e.g. "2026-08-04T14:30:00-04:00". */
  dateTime?: string | null;
  timeZone?: string | null;
}

export interface GoogleEventAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  organizer?: boolean;
  self?: boolean;
  optional?: boolean;
  resource?: boolean;
}

export interface GoogleConferenceEntryPoint {
  entryPointType?: string;
  uri?: string;
  label?: string;
}

export interface GoogleEvent {
  id?: string;
  etag?: string;
  status?: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  creator?: { email?: string; displayName?: string; self?: boolean };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  /** Only present on the series master (i.e. when singleEvents is false). */
  recurrence?: string[];
  /** Only present on expanded instances; the series master's `id`. */
  recurringEventId?: string;
  originalStartTime?: GoogleEventDateTime;
  iCalUID?: string;
  attendees?: GoogleEventAttendee[];
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: GoogleConferenceEntryPoint[];
    conferenceSolution?: { name?: string };
  };
  extendedProperties?: {
    /** A null value on a PATCH is how Google is told to REMOVE a key. */
    private?: Record<string, string | null>;
    shared?: Record<string, string | null>;
  };
  transparency?: string;
  visibility?: string;
}

export interface GoogleEventsListResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
  /** Present only on the LAST page of a listing; the cursor for the next sync. */
  nextSyncToken?: string;
  timeZone?: string;
}

export interface GoogleCalendarListEntry {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  timeZone?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
  deleted?: boolean;
  hidden?: boolean;
}

export interface GoogleCalendarListResponse {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
}

/** Token endpoint response (both authorization_code and refresh_token grants). */
export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

/** Thrown for any non-2xx from Google, carrying enough to branch on. */
export class GoogleApiError extends Error {
  readonly status: number;
  readonly reason: string | null;
  readonly body: string;

  constructor(status: number, reason: string | null, body: string, message?: string) {
    super(message ?? `Google API error ${status}${reason ? ` (${reason})` : ""}`);
    this.name = "GoogleApiError";
    this.status = status;
    this.reason = reason;
    this.body = body;
  }

  /**
   * The stored sync token is too old. Google's documented recovery is a full
   * wipe and resync — there is no partial path.
   * https://developers.google.com/workspace/calendar/api/guides/sync
   */
  get isSyncTokenExpired(): boolean {
    return this.status === 410;
  }

  /** The refresh token is dead (expired, revoked, or password changed). Only a
   *  fresh interactive consent recovers it. */
  get isInvalidGrant(): boolean {
    return this.reason === "invalid_grant";
  }

  get isRateLimited(): boolean {
    return (
      this.status === 429 ||
      (this.status === 403 &&
        (this.reason === "rateLimitExceeded" ||
          this.reason === "userRateLimitExceeded"))
    );
  }
}
