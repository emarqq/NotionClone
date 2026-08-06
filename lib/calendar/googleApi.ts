import "server-only";

import { GOOGLE_CALENDAR_API } from "./config";
import { googleFetch } from "./googleFetch";
import type {
  GoogleCalendarListResponse,
  GoogleEvent,
  GoogleEventsListResponse,
} from "./types";

/**
 * The five Google Calendar v3 endpoints this app uses, over plain fetch.
 *
 * Every function takes an already-fresh access token; refreshing is tokens.ts's
 * job, so nothing here has to know about the account row or the 7-day refresh
 * token expiry.
 */

function authHeaders(accessToken: string): HeadersInit {
  return { authorization: `Bearer ${accessToken}` };
}

/** The user's calendar list. Paged, but a personal account never exceeds one page. */
export async function listCalendars(accessToken: string) {
  const entries: NonNullable<GoogleCalendarListResponse["items"]> = [];
  let pageToken: string | undefined;

  do {
    // showHidden=true on purpose. A calendar the user merely *hides* in Google's
    // UI otherwise drops out of this list, and upsertCalendars would read that
    // as "unsubscribed" — see the deselect-don't-delete note there.
    const params = new URLSearchParams({ maxResults: "250", showHidden: "true" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await googleFetch<GoogleCalendarListResponse>(
      `${GOOGLE_CALENDAR_API}/users/me/calendarList?${params}`,
      { headers: authHeaders(accessToken) }
    );
    entries.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return entries;
}

export interface ListEventsOptions {
  /** Incremental cursor. Mutually exclusive with `timeMin` — see below. */
  syncToken?: string;
  /** Full-sync lower bound (RFC3339). Only legal when `syncToken` is absent. */
  timeMin?: string;
  pageToken?: string;
}

/**
 * One page of `events.list`.
 *
 * Two parameters are pinned and must never vary across the life of a sync
 * token, because Google rejects an incremental request whose filters differ
 * from the full sync that produced the token:
 *
 *   singleEvents=true  — expands a recurring series into one concrete instance
 *                        per occurrence. A weekly class becomes 15 rows the
 *                        grid can draw, instead of one RRULE the app would have
 *                        to expand itself (and get wrong around DST).
 *   showDeleted=true   — deletions arrive as `status: "cancelled"` stubs rather
 *                        than silently vanishing, which is the only way an
 *                        incremental sync can learn an event is gone.
 *
 * `timeMin` bounds the *initial* full sync only; passing it alongside a
 * syncToken is a 400 from Google.
 */
export async function listEventsPage(
  accessToken: string,
  calendarId: string,
  options: ListEventsOptions = {}
): Promise<GoogleEventsListResponse> {
  const params = new URLSearchParams({
    singleEvents: "true",
    showDeleted: "true",
    maxResults: "250",
  });
  if (options.syncToken) params.set("syncToken", options.syncToken);
  else if (options.timeMin) params.set("timeMin", options.timeMin);
  if (options.pageToken) params.set("pageToken", options.pageToken);

  return googleFetch<GoogleEventsListResponse>(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
      calendarId
    )}/events?${params}`,
    { headers: authHeaders(accessToken) }
  );
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  body: GoogleEvent
): Promise<GoogleEvent> {
  return googleFetch<GoogleEvent>(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { ...authHeaders(accessToken), "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

/**
 * Partial update. `patch`, never `update`: `events.update` is a full PUT that
 * replaces the resource, so changing a title with it would wipe the attendees,
 * reminders and conference data the app doesn't model.
 */
export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: Partial<GoogleEvent>
): Promise<GoogleEvent> {
  return googleFetch<GoogleEvent>(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
      calendarId
    )}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { ...authHeaders(accessToken), "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  await googleFetch<void>(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
      calendarId
    )}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: authHeaders(accessToken) }
  );
}
