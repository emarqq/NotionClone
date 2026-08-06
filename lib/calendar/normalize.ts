/**
 * Google event resource → the column shape `calendar_events` stores.
 *
 * Pure and dependency-free (no "server-only", no I/O) so the whole inbound
 * translation is unit-testable — `tests/calendar/normalize.test.ts` pins the
 * behaviour that actually breaks in practice: all-day boundaries.
 *
 * The one rule worth internalising: **Google's `end.date` on an all-day event
 * is EXCLUSIVE.** A single-day event on Aug 4 arrives as
 * `{ start: { date: "2026-08-04" }, end: { date: "2026-08-05" } }`. Rendered
 * naively, every all-day event — which is most of a class-schedule and every
 * application deadline — is one day too long. It is undone exactly once, here,
 * and `calendar_events.end_date` is inclusive from that point on.
 */

import type {
  CalendarAttendee,
  CalendarEventCategory,
} from "@/lib/db/types";
import {
  MANAGED_MARKER_KEY,
  MANAGED_PAGE_KEY,
  type GoogleEvent,
  type GoogleEventDateTime,
} from "./types";

export interface NormalizedEvent {
  google_event_id: string;
  ical_uid: string | null;
  recurring_event_id: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  summary: string;
  description: string | null;
  location: string | null;
  is_all_day: boolean;
  starts_at: string;
  ends_at: string;
  /** All-day only. Inclusive. */
  start_date: string | null;
  /** All-day only. Inclusive — Google's exclusive end already undone. */
  end_date: string | null;
  time_zone: string | null;
  html_link: string | null;
  meeting_url: string | null;
  color_id: string | null;
  attendees: CalendarAttendee[];
  organizer: { email: string | null; displayName: string | null } | null;
  etag: string | null;
  google_updated_at: string | null;
  /** This app created the event (tagged via extendedProperties.private). */
  managed_by_app: boolean;
  /** The note page id we stamped on the event when we created it, if any. */
  managed_page_id: string | null;
  raw: GoogleEvent;
}

/** What an incremental sync does with one item from `events.list`. */
export type NormalizeResult =
  | { kind: "event"; event: NormalizedEvent }
  /**
   * A tombstone. With `showDeleted=true`, a deleted event comes back as little
   * more than `{ id, status: "cancelled" }` — no times, no title. It cannot be
   * built into a row, so the sync marks any existing row cancelled instead of
   * deleting it: the row may carry a `page_id` (the user's meeting note) and a
   * manually chosen category, and a cancelled interview is information worth
   * keeping on screen, struck through.
   */
  | { kind: "cancelled"; googleEventId: string }
  /** Unusable (no id, or no times on a live event) — skipped, counted. */
  | { kind: "skip"; reason: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeEvent(raw: GoogleEvent): NormalizeResult {
  const id = raw.id;
  if (!id) return { kind: "skip", reason: "event has no id" };

  const status = coerceStatus(raw.status);
  const times = resolveTimes(raw.start, raw.end);
  if (!times) {
    // A cancelled event legitimately arrives without times; a live one that
    // does is malformed and would violate the NOT NULL on starts_at.
    if (status === "cancelled") return { kind: "cancelled", googleEventId: id };
    return { kind: "skip", reason: `event ${id} has no usable start/end` };
  }

  const priv = raw.extendedProperties?.private ?? {};

  return {
    kind: "event",
    event: {
      google_event_id: id,
      ical_uid: raw.iCalUID ?? null,
      recurring_event_id: raw.recurringEventId ?? null,
      status,
      summary: raw.summary?.trim() || "(no title)",
      description: raw.description ?? null,
      location: raw.location ?? null,
      ...times,
      html_link: raw.htmlLink ?? null,
      meeting_url: meetingUrl(raw),
      color_id: raw.colorId ?? null,
      attendees: normalizeAttendees(raw.attendees),
      organizer: raw.organizer
        ? {
            email: raw.organizer.email ?? null,
            displayName: raw.organizer.displayName ?? null,
          }
        : null,
      etag: raw.etag ?? null,
      google_updated_at: raw.updated ?? null,
      managed_by_app: priv[MANAGED_MARKER_KEY] === "true",
      // `|| null`, not `?? null`: unlinking a note clears the property, and
      // Google can hand the cleared value back as "" rather than omitting it.
      // An empty string is not nullish, so `??` would let it through to a uuid
      // column and fail the insert.
      managed_page_id: priv[MANAGED_PAGE_KEY] || null,
      raw,
    },
  };
}

type ResolvedTimes = Pick<
  NormalizedEvent,
  "is_all_day" | "starts_at" | "ends_at" | "start_date" | "end_date" | "time_zone"
>;

function resolveTimes(
  start: GoogleEventDateTime | undefined,
  end: GoogleEventDateTime | undefined
): ResolvedTimes | null {
  if (start?.date && ISO_DATE.test(start.date)) {
    const startDate = start.date;
    // Fall back to a one-day event when `end` is missing or nonsensical.
    const exclusiveEnd =
      end?.date && ISO_DATE.test(end.date) && end.date > startDate
        ? end.date
        : addDays(startDate, 1);

    return {
      is_all_day: true,
      // UTC midnights bracketing the span. Half-open, matching the exclusive
      // end, so an overlap query `starts_at < windowEnd AND ends_at > windowStart`
      // treats all-day and timed events identically.
      starts_at: `${startDate}T00:00:00.000Z`,
      ends_at: `${exclusiveEnd}T00:00:00.000Z`,
      start_date: startDate,
      end_date: addDays(exclusiveEnd, -1),
      time_zone: start.timeZone ?? null,
    };
  }

  if (start?.dateTime) {
    const startsAt = toIso(start.dateTime);
    if (!startsAt) return null;
    // A zero-length event (some imported ICS feeds do this) keeps its instant;
    // the UI gives it a minimum visual height rather than the data being lied to.
    const endsAt = (end?.dateTime && toIso(end.dateTime)) || startsAt;
    return {
      is_all_day: false,
      starts_at: startsAt,
      ends_at: endsAt < startsAt ? startsAt : endsAt,
      start_date: null,
      end_date: null,
      time_zone: start.timeZone ?? end?.timeZone ?? null,
    };
  }

  return null;
}

/**
 * Shift a "YYYY-MM-DD" by whole days.
 *
 * Done in UTC on purpose. `new Date("2026-08-04")` is parsed as UTC midnight,
 * but `getDate()` reads it back in local time — so the obvious implementation
 * returns Aug 3 for anyone west of Greenwich. Everything here is UTC in, UTC
 * out, and no local-time accessor is ever touched.
 */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

function toIso(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function coerceStatus(raw: string | undefined): NormalizedEvent["status"] {
  return raw === "cancelled" || raw === "tentative" ? raw : "confirmed";
}

/** The join link, from modern conferenceData first and legacy hangoutLink after. */
function meetingUrl(raw: GoogleEvent): string | null {
  const entry = raw.conferenceData?.entryPoints?.find(
    (point) => point.entryPointType === "video" && point.uri
  );
  if (entry?.uri) return entry.uri;
  if (raw.hangoutLink) return raw.hangoutLink;
  // Zoom/Teams links routinely live in `location` for invites sent from
  // outside Google — worth surfacing as a join button for a recruiting call.
  const fromLocation = raw.location?.match(/https?:\/\/\S+/)?.[0];
  return fromLocation ?? null;
}

function normalizeAttendees(
  raw: GoogleEvent["attendees"]
): CalendarAttendee[] {
  if (!raw?.length) return [];
  return raw
    // Meeting rooms and equipment are attendees to Google; they're noise here.
    .filter((attendee) => !attendee.resource)
    .map((attendee) => ({
      email: attendee.email ?? null,
      displayName: attendee.displayName ?? null,
      responseStatus: attendee.responseStatus ?? null,
      organizer: attendee.organizer === true,
      self: attendee.self === true,
      optional: attendee.optional === true,
    }));
}

/* --------------------------------------------------------------------------
 * Outbound: the app's event shape → a Google event resource.
 * ------------------------------------------------------------------------ */

export interface EventDraft {
  summary: string;
  description?: string | null;
  location?: string | null;
  isAllDay: boolean;
  /** Timed: an ISO instant. All-day: "YYYY-MM-DD". */
  start: string;
  /** Timed: an ISO instant. All-day: "YYYY-MM-DD", INCLUSIVE (as stored). */
  end: string;
  timeZone?: string | null;
  /** Stamped into extendedProperties so the note survives a resync. */
  pageId?: string | null;
}

/**
 * Build the request body for events.insert / events.patch.
 *
 * Re-applies the exclusive-end convention on the way out: callers work in the
 * inclusive dates the rest of the app uses, and the +1 lives only here and in
 * `resolveTimes`, so the two can't drift apart.
 */
export function toGoogleEvent(draft: EventDraft): GoogleEvent {
  const timing: Pick<GoogleEvent, "start" | "end"> = draft.isAllDay
    ? {
        start: { date: draft.start },
        end: { date: addDays(draft.end, 1) },
      }
    : {
        start: {
          dateTime: new Date(draft.start).toISOString(),
          ...(draft.timeZone ? { timeZone: draft.timeZone } : {}),
        },
        end: {
          dateTime: new Date(draft.end).toISOString(),
          ...(draft.timeZone ? { timeZone: draft.timeZone } : {}),
        },
      };

  return {
    summary: draft.summary,
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.location ? { location: draft.location } : {}),
    ...timing,
    extendedProperties: {
      private: {
        [MANAGED_MARKER_KEY]: "true",
        ...(draft.pageId ? { [MANAGED_PAGE_KEY]: draft.pageId } : {}),
      },
    },
  };
}

/** Categories in the order the UI lists them, with their human labels. */
export const CATEGORY_LABELS: Record<CalendarEventCategory, string> = {
  class: "Class",
  quiz: "Quiz",
  exam: "Exam",
  assignment: "Assignment",
  interview: "Interview",
  coffee_chat: "Coffee chat",
  application: "Application",
  deadline: "Deadline",
  other: "Other",
};
