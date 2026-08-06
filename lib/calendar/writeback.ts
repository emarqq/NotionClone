import "server-only";

import {
  deleteEventRow,
  getCalendar,
  getEventRow,
  getWriteTargetCalendar,
  isWritable,
  upsertEvents,
} from "@/lib/db/calendar";
import { getAccessToken } from "./tokens";
import {
  deleteEvent as deleteGoogleEvent,
  insertEvent,
  patchEvent,
} from "./googleApi";
import { categorizeEvent } from "./categorize";
import { normalizeEvent, toGoogleEvent, type EventDraft } from "./normalize";
import { GoogleApiError, MANAGED_PAGE_KEY } from "./types";
import type { CalendarEventCategory, CalendarRow } from "@/lib/db/types";

/**
 * Writing back to Google.
 *
 * Google is the source of truth for event data, so every write here is
 * "send it, then store what Google echoes back" rather than "write locally and
 * hope". That means the mirror always holds Google's canonical ids, etags and
 * resolved times — including the ones Google rewrites, like an all-day event's
 * exclusive end — and a failed write leaves no phantom local row behind.
 *
 * Everything created here is stamped with `extendedProperties.private` markers
 * (see types.ts). Inbound sync reads them to recognise its own writes, which is
 * what keeps a two-way sync from echoing forever.
 */

export interface CreateEventInput extends EventDraft {
  /** Defaults to the account's write-target calendar. */
  calendarId?: string;
  /** Overrides the keyword guess when the user picked one in the composer. */
  category?: CalendarEventCategory;
}

export class CalendarWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarWriteError";
  }
}

async function resolveWritableCalendar(
  calendarId?: string
): Promise<CalendarRow> {
  const calendar = calendarId
    ? await getCalendar(calendarId)
    : await getWriteTargetCalendar();
  if (!calendar) {
    throw new CalendarWriteError(
      "No Google calendar is set as the write target. Connect an account, or pick a calendar in Calendar settings."
    );
  }
  if (!isWritable(calendar)) {
    throw new CalendarWriteError(
      `"${calendar.summary}" is read-only (access role: ${calendar.access_role ?? "unknown"}).`
    );
  }
  return calendar;
}

/** Store Google's echo of an event in the local mirror; returns the row id. */
async function mirror(
  calendar: CalendarRow,
  googleEvent: Parameters<typeof normalizeEvent>[0],
  categoryOverride?: CalendarEventCategory
): Promise<string> {
  const result = normalizeEvent(googleEvent);
  if (result.kind !== "event") {
    throw new CalendarWriteError(
      `Google accepted the event but returned something unusable (${result.kind}).`
    );
  }
  await upsertEvents(calendar.id, [
    {
      ...result.event,
      category:
        categoryOverride ??
        categorizeEvent({
          summary: result.event.summary,
          location: result.event.location,
          isAllDay: result.event.is_all_day,
        }),
      category_source: categoryOverride ? "manual" : "auto",
    },
  ]);

  const stored = await findByGoogleId(calendar.id, result.event.google_event_id);
  if (!stored) throw new CalendarWriteError("Event was not persisted locally.");
  return stored;
}

async function findByGoogleId(
  calendarId: string,
  googleEventId: string
): Promise<string | null> {
  const { createServiceSupabase } = await import("@/lib/supabase/server");
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("calendar_events")
    .select("id")
    .eq("calendar_id", calendarId)
    .eq("google_event_id", googleEventId)
    .maybeSingle();
  if (error) throw new Error(`findByGoogleId failed: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}

/** Create an event in Google and mirror it locally. Returns the local row id. */
export async function createEvent(input: CreateEventInput): Promise<string> {
  const calendar = await resolveWritableCalendar(input.calendarId);
  const accessToken = await getAccessToken(calendar.account_id);
  const body = toGoogleEvent({
    ...input,
    timeZone: input.timeZone ?? calendar.time_zone,
  });
  const created = await insertEvent(
    accessToken,
    calendar.google_calendar_id,
    body
  );
  return mirror(calendar, created, input.category);
}

export interface UpdateEventInput {
  summary?: string;
  description?: string | null;
  location?: string | null;
  /** Supply all four together when changing the time; partial is rejected. */
  isAllDay?: boolean;
  start?: string;
  end?: string;
  timeZone?: string | null;
}

/** Patch an existing event in Google and re-mirror Google's response. */
export async function updateEvent(
  eventId: string,
  input: UpdateEventInput
): Promise<void> {
  const row = await getEventRow(eventId);
  if (!row) throw new CalendarWriteError(`No calendar event ${eventId}`);
  const calendar = await resolveWritableCalendar(row.calendar_id);
  const accessToken = await getAccessToken(calendar.account_id);

  const body: Record<string, unknown> = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description ?? "";
  if (input.location !== undefined) body.location = input.location ?? "";

  if (input.start !== undefined || input.end !== undefined) {
    if (input.start === undefined || input.end === undefined) {
      throw new CalendarWriteError(
        "Changing an event's time requires both a start and an end."
      );
    }
    const nextIsAllDay = input.isAllDay ?? row.is_all_day;
    const timed = toGoogleEvent({
      summary: input.summary ?? row.summary,
      isAllDay: nextIsAllDay,
      start: input.start,
      end: input.end,
      timeZone: input.timeZone ?? row.time_zone ?? calendar.time_zone,
    });

    // Flipping between all-day and timed needs the OTHER field explicitly
    // nulled. `events.patch` merges nested objects key by key, so patching
    // `{ date }` onto a stored `{ dateTime, timeZone }` leaves both present and
    // Google rejects the whole request with "Cannot specify both date and
    // dateTime". Sending the clear is harmless when the kind hasn't changed.
    const clear = nextIsAllDay
      ? { dateTime: null, timeZone: null }
      : { date: null };
    body.start = { ...timed.start, ...clear };
    body.end = { ...timed.end, ...clear };
  }

  const updated = await patchEvent(
    accessToken,
    calendar.google_calendar_id,
    row.google_event_id,
    body
  );
  await mirror(calendar, updated);
}

/**
 * Delete an event from Google, then locally.
 *
 * A 404/410 from Google means it is already gone — that is a success for our
 * purposes, so the local row is still removed rather than being left as an
 * undeletable ghost.
 */
export async function deleteEvent(eventId: string): Promise<void> {
  const row = await getEventRow(eventId);
  if (!row) return;
  const calendar = await getCalendar(row.calendar_id);
  if (!calendar) {
    await deleteEventRow(eventId);
    return;
  }

  try {
    const accessToken = await getAccessToken(calendar.account_id);
    await deleteGoogleEvent(
      accessToken,
      calendar.google_calendar_id,
      row.google_event_id
    );
  } catch (err) {
    const alreadyGone =
      err instanceof GoogleApiError && (err.status === 404 || err.status === 410);
    if (!alreadyGone) throw err;
  }

  await deleteEventRow(eventId);
}

/**
 * Stamp the linked note's page id onto the Google event.
 *
 * Best-effort and non-fatal: the authoritative link is `calendar_events.page_id`
 * in Postgres. Writing it to Google as well means the link is recoverable if
 * the mirror is ever wiped and rebuilt by a full resync, and it shows up when
 * the same event is seen from another device.
 */
export async function tagEventWithPage(
  eventId: string,
  pageId: string | null
): Promise<void> {
  const row = await getEventRow(eventId);
  if (!row) return;
  const calendar = await getCalendar(row.calendar_id);
  if (!calendar || !isWritable(calendar)) return;

  try {
    const accessToken = await getAccessToken(calendar.account_id);
    await patchEvent(
      accessToken,
      calendar.google_calendar_id,
      row.google_event_id,
      {
        extendedProperties: {
          // A patch merges extendedProperties key by key, and an explicit null
          // is how Google is told to REMOVE one. It must not be "": Google
          // echoes the empty string straight back on the next sync, and it
          // survives a `?? null` guard all the way into a uuid column, where it
          // fails the insert and wedges that calendar's sync for good.
          private: { [MANAGED_PAGE_KEY]: pageId },
        },
      }
    );
  } catch (err) {
    console.error(`tagEventWithPage: could not tag event ${eventId} in Google:`, err);
  }
}
