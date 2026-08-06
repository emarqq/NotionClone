import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase/server";
import type {
  CalendarAccount,
  CalendarAccountPublic,
  CalendarEvent,
  CalendarEventCategory,
  CalendarEventWithContext,
  CalendarRow,
} from "@/lib/db/types";
import type { NormalizedEvent } from "@/lib/calendar/normalize";

/**
 * Data access for the Google Calendar mirror.
 *
 * Token columns never leave this module except through the `*Internal` reads,
 * which only lib/calendar/tokens.ts calls — everything the UI touches goes
 * through the `Public` shapes so a refresh token can't reach a client component
 * by accident.
 */

/**
 * PostgREST caps every response at `max_rows` (1000, set in supabase/config.toml)
 * and says so only in a `Content-Range` header — a query returning more just
 * comes back short, with no error. For a semester of classes that is not
 * hypothetical: five courses meeting three times a week is ~1100 rows across the
 * calendar page's window, and the truncation lands on the far end, so *next
 * spring's* deadlines would silently not exist.
 *
 * Any unbounded read of calendar_events must go through here, which pages with
 * `.range()` until a short page arrives.
 */
const PAGE_SIZE = 1000;
/** Backstop against an unbounded loop if a query is broader than intended. */
const MAX_ROWS = 50_000;

async function selectAllPages<T>(
  label: string,
  build: (
    client: SupabaseClient,
    offset: number,
    pageSize: number
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const supabase = createServiceSupabase();
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await build(supabase, offset, PAGE_SIZE);
    if (error) throw new Error(`${label} failed: ${error.message}`);
    const page = (data ?? []) as T[];
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    if (all.length >= MAX_ROWS) {
      console.warn(`[calendar] ${label} stopped at ${MAX_ROWS} rows; range too broad.`);
      break;
    }
  }
  return all;
}

/* -------------------------------------------------------------------------
 * Accounts
 * ---------------------------------------------------------------------- */

/** Includes tokens. Server-internal — never pass the result to a component. */
export async function getAccountsInternal(): Promise<CalendarAccount[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("calendar_accounts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getAccountsInternal failed: ${error.message}`);
  return (data ?? []) as CalendarAccount[];
}

export async function getAccountInternal(
  accountId: string
): Promise<CalendarAccount | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("calendar_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`getAccountInternal failed: ${error.message}`);
  return (data as CalendarAccount | null) ?? null;
}

/** Token-free account rows, safe to render. */
export async function getAccounts(): Promise<CalendarAccountPublic[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("calendar_accounts")
    .select(
      "id, provider, account_email, status, last_error, last_synced_at, created_at, updated_at"
    )
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getAccounts failed: ${error.message}`);
  return (data ?? []) as CalendarAccountPublic[];
}

export interface UpsertAccountInput {
  email: string;
  accessToken: string;
  /** Absent when Google declined to reissue one; the caller keeps the old one. */
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
}

/**
 * Create or refresh the row for a Google account.
 *
 * Keyed on (provider, account_email) so reconnecting — which happens roughly
 * weekly while the OAuth consent screen is in Testing — updates the same row
 * and keeps every calendar, category override and linked note attached to it.
 * A null `refreshToken` deliberately does NOT overwrite the stored one: Google
 * only reissues on some grants, and clobbering a good token with null would
 * turn a successful reconnect into a dead integration.
 */
export async function upsertAccount(
  input: UpsertAccountInput
): Promise<CalendarAccount> {
  const supabase = createServiceSupabase();
  const existing = await supabase
    .from("calendar_accounts")
    .select("id, refresh_token")
    .eq("provider", "google")
    .eq("account_email", input.email)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`upsertAccount lookup failed: ${existing.error.message}`);
  }

  const patch = {
    provider: "google" as const,
    account_email: input.email,
    access_token: input.accessToken,
    refresh_token:
      input.refreshToken ??
      (existing.data as { refresh_token: string | null } | null)?.refresh_token ??
      null,
    token_expires_at: input.expiresAt,
    scope: input.scope,
    status: "connected" as const,
    last_error: null,
  };

  const query = existing.data
    ? supabase
        .from("calendar_accounts")
        .update(patch)
        .eq("id", (existing.data as { id: string }).id)
    : supabase.from("calendar_accounts").insert(patch);

  const { data, error } = await query.select("*").single();
  if (error) throw new Error(`upsertAccount failed: ${error.message}`);
  return data as CalendarAccount;
}

/** Persist a freshly refreshed access token. */
export async function updateAccessToken(
  accountId: string,
  accessToken: string,
  expiresAt: string
): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendar_accounts")
    .update({
      access_token: accessToken,
      token_expires_at: expiresAt,
      status: "connected",
      last_error: null,
    })
    .eq("id", accountId);
  if (error) throw new Error(`updateAccessToken failed: ${error.message}`);
}

/** Flip an account into the state the UI renders a "Reconnect" banner for. */
export async function markAccountNeedsReauth(
  accountId: string,
  reason: string
): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendar_accounts")
    .update({ status: "needs_reauth", last_error: reason, access_token: null })
    .eq("id", accountId);
  if (error) throw new Error(`markAccountNeedsReauth failed: ${error.message}`);
}

export async function setAccountSyncedNow(accountId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendar_accounts")
    .update({ last_synced_at: new Date().toISOString(), last_error: null })
    .eq("id", accountId);
  if (error) throw new Error(`setAccountSyncedNow failed: ${error.message}`);
}

export async function setAccountError(
  accountId: string,
  message: string
): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendar_accounts")
    .update({ last_error: message })
    .eq("id", accountId);
  if (error) throw new Error(`setAccountError failed: ${error.message}`);
}

/** Removes the account and, by cascade, its calendars and mirrored events. */
export async function deleteAccount(accountId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendar_accounts")
    .delete()
    .eq("id", accountId);
  if (error) throw new Error(`deleteAccount failed: ${error.message}`);
}

/* -------------------------------------------------------------------------
 * Calendars
 * ---------------------------------------------------------------------- */

export async function getCalendars(accountId?: string): Promise<CalendarRow[]> {
  const supabase = createServiceSupabase();
  let query = supabase.from("calendars").select("*");
  if (accountId) query = query.eq("account_id", accountId);
  const { data, error } = await query
    .order("is_primary", { ascending: false })
    .order("summary", { ascending: true });
  if (error) throw new Error(`getCalendars failed: ${error.message}`);
  return (data ?? []) as CalendarRow[];
}

export async function getCalendar(id: string): Promise<CalendarRow | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("calendars")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getCalendar failed: ${error.message}`);
  return (data as CalendarRow | null) ?? null;
}

export interface CalendarUpsertInput {
  googleCalendarId: string;
  summary: string;
  description: string | null;
  timeZone: string | null;
  backgroundColor: string | null;
  foregroundColor: string | null;
  accessRole: string | null;
  isPrimary: boolean;
  /** Google's own visibility flag; seeds `is_selected` on first insert only. */
  selectedInGoogle: boolean;
}

/**
 * Reconcile the calendar list for an account.
 *
 * Metadata (name, colour, access role) is refreshed on every sync, but
 * `is_selected` and `is_write_target` are written only when the row is created:
 * they are the user's choices inside this app, and re-deriving them from Google
 * would silently re-enable a calendar the user had hidden here.
 */
export async function upsertCalendars(
  accountId: string,
  entries: CalendarUpsertInput[]
): Promise<CalendarRow[]> {
  const supabase = createServiceSupabase();
  const existing = await getCalendars(accountId);
  const byGoogleId = new Map(existing.map((row) => [row.google_calendar_id, row]));

  for (const entry of entries) {
    const found = byGoogleId.get(entry.googleCalendarId);
    const metadata = {
      summary: entry.summary,
      description: entry.description,
      time_zone: entry.timeZone,
      background_color: entry.backgroundColor,
      foreground_color: entry.foregroundColor,
      access_role: entry.accessRole,
      is_primary: entry.isPrimary,
    };

    if (found) {
      const { error } = await supabase
        .from("calendars")
        .update(metadata)
        .eq("id", found.id);
      if (error) throw new Error(`upsertCalendars update failed: ${error.message}`);
    } else {
      const { error } = await supabase.from("calendars").insert({
        account_id: accountId,
        google_calendar_id: entry.googleCalendarId,
        ...metadata,
        // Mirror what the user already sees in Google on first connect, so the
        // app doesn't open showing eight subscribed holiday calendars.
        is_selected: entry.selectedInGoogle || entry.isPrimary,
      });
      if (error) throw new Error(`upsertCalendars insert failed: ${error.message}`);
    }
  }

  // A calendar that stops appearing in the list is DESELECTED, never deleted.
  //
  // Deleting looks tidier and is a data-loss bug: `calendar_events.calendar_id`
  // cascades, so dropping the row destroys every mirrored event on it — including
  // rows carrying a linked note (`page_id`) or a hand-set category. And a
  // calendar can leave the list for entirely temporary reasons: the user hid it
  // in Google's UI, or a shared calendar's permissions blipped. Un-hiding it
  // would then re-sync the events with fresh row ids and no notes attached.
  //
  // Deselected rows are skipped by sync and shown unchecked in Calendar
  // settings, which costs one stale line in a list; the alternative costs work.
  const seen = new Set(entries.map((entry) => entry.googleCalendarId));
  const vanished = existing.filter(
    (row) => !seen.has(row.google_calendar_id) && row.is_selected
  );
  if (vanished.length > 0) {
    const { error } = await supabase
      .from("calendars")
      .update({ is_selected: false })
      .in(
        "id",
        vanished.map((row) => row.id)
      );
    if (error) throw new Error(`upsertCalendars deselect failed: ${error.message}`);
  }

  const refreshed = await getCalendars(accountId);
  // Guarantee exactly one write target: without one, "New event" has nowhere
  // to go. Prefer the primary calendar.
  if (!refreshed.some((row) => row.is_write_target)) {
    const target =
      refreshed.find((row) => row.is_primary && isWritable(row)) ??
      refreshed.find(isWritable);
    if (target) {
      await setWriteTarget(target.id);
      return getCalendars(accountId);
    }
  }
  return refreshed;
}

export function isWritable(calendar: CalendarRow): boolean {
  return calendar.access_role === "owner" || calendar.access_role === "writer";
}

export async function setCalendarSelected(
  calendarId: string,
  selected: boolean
): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendars")
    .update({ is_selected: selected })
    .eq("id", calendarId);
  if (error) throw new Error(`setCalendarSelected failed: ${error.message}`);
}

/** Makes `calendarId` its account's sole write target (partial unique index). */
export async function setWriteTarget(calendarId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const calendar = await getCalendar(calendarId);
  if (!calendar) throw new Error(`setWriteTarget: no calendar ${calendarId}`);

  // Clear first — the partial unique index rejects a second `true` row.
  const cleared = await supabase
    .from("calendars")
    .update({ is_write_target: false })
    .eq("account_id", calendar.account_id)
    .eq("is_write_target", true);
  if (cleared.error) {
    throw new Error(`setWriteTarget clear failed: ${cleared.error.message}`);
  }

  const { error } = await supabase
    .from("calendars")
    .update({ is_write_target: true })
    .eq("id", calendarId);
  if (error) throw new Error(`setWriteTarget failed: ${error.message}`);
}

/**
 * The calendar new events are created on.
 *
 * The unique index that guarantees a single write target is per-account, so
 * with two accounts connected this must be told which one — otherwise the
 * choice between them is whatever Postgres returns first.
 */
export async function getWriteTargetCalendar(
  accountId?: string
): Promise<CalendarRow | null> {
  const supabase = createServiceSupabase();
  let query = supabase.from("calendars").select("*").eq("is_write_target", true);
  if (accountId) query = query.eq("account_id", accountId);
  const { data, error } = await query
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getWriteTargetCalendar failed: ${error.message}`);
  return (data as CalendarRow | null) ?? null;
}

export async function updateCalendarSyncState(
  calendarId: string,
  syncToken: string | null
): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendars")
    .update({ sync_token: syncToken, last_synced_at: new Date().toISOString() })
    .eq("id", calendarId);
  if (error) throw new Error(`updateCalendarSyncState failed: ${error.message}`);
}

/* -------------------------------------------------------------------------
 * Events
 * ---------------------------------------------------------------------- */

export interface EventUpsertInput extends NormalizedEvent {
  category: CalendarEventCategory;
  category_source: "auto" | "manual";
}

/**
 * Write a batch of synced events.
 *
 * Uses the `(calendar_id, google_event_id)` unique key, and takes care never to
 * clobber the two app-local columns:
 *   - `category` is only overwritten when the existing row's source is 'auto'.
 *   - `page_id` is preserved unless the incoming event carries a page id we
 *     stamped ourselves (which recovers the link after a wipe-and-resync).
 */
export async function upsertEvents(
  calendarId: string,
  events: EventUpsertInput[]
): Promise<number> {
  if (events.length === 0) return 0;
  const supabase = createServiceSupabase();

  const existing = await supabase
    .from("calendar_events")
    .select("google_event_id, category, category_source, page_id")
    .eq("calendar_id", calendarId)
    .in(
      "google_event_id",
      events.map((event) => event.google_event_id)
    );
  if (existing.error) {
    throw new Error(`upsertEvents lookup failed: ${existing.error.message}`);
  }
  const priorByGoogleId = new Map(
    ((existing.data ?? []) as {
      google_event_id: string;
      category: CalendarEventCategory;
      category_source: "auto" | "manual";
      page_id: string | null;
    }[]).map((row) => [row.google_event_id, row])
  );

  // A page id stamped on the Google event is only a *hint*: the page it names
  // may since have been deleted here, and `page_id` is a real FK. Writing a
  // dangling uuid would fail the whole batch with a 23503 and wedge that
  // calendar's sync permanently, since the stale stamp lives in Google.
  const claimedPageIds = [
    ...new Set(
      events
        .map((event) => event.managed_page_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const livePageIds = new Set<string>();
  if (claimedPageIds.length > 0) {
    const { data, error } = await supabase
      .from("pages")
      .select("id")
      .in("id", claimedPageIds);
    if (error) throw new Error(`upsertEvents page check failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string }[]) livePageIds.add(row.id);
  }

  const rows = events.map((event) => {
    const prior = priorByGoogleId.get(event.google_event_id);
    const { managed_page_id, raw, ...columns } = event;
    const recoveredPageId =
      managed_page_id && livePageIds.has(managed_page_id) ? managed_page_id : null;
    return {
      ...columns,
      calendar_id: calendarId,
      raw: raw as unknown as Record<string, unknown>,
      category:
        prior?.category_source === "manual" ? prior.category : event.category,
      // Falls back to the INCOMING source, not a bare "auto": an event created
      // in the app with an explicitly chosen category has no prior row, and
      // defaulting it to "auto" let the next sync's keyword guess overwrite the
      // user's choice — the exact thing category_source exists to prevent.
      category_source: prior?.category_source ?? event.category_source,
      page_id: prior?.page_id ?? recoveredPageId,
    };
  });

  const { error } = await supabase
    .from("calendar_events")
    .upsert(rows, { onConflict: "calendar_id,google_event_id" });
  if (error) throw new Error(`upsertEvents failed: ${error.message}`);
  return rows.length;
}

/**
 * Tombstone an event Google says was deleted.
 *
 * An update, not a delete: the row may carry the user's meeting note and a
 * hand-set category, and a cancelled interview is worth still seeing (struck
 * through) rather than vanishing. Rows with no note and no manual category are
 * pruned by `pruneCancelledEvents` once they're in the past.
 */
export async function markEventsCancelled(
  calendarId: string,
  googleEventIds: string[]
): Promise<number> {
  if (googleEventIds.length === 0) return 0;
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("calendar_events")
    .update({ status: "cancelled" })
    .eq("calendar_id", calendarId)
    .in("google_event_id", googleEventIds)
    .select("id");
  if (error) throw new Error(`markEventsCancelled failed: ${error.message}`);
  return (data ?? []).length;
}

/** Drop cancelled events nobody attached anything to, once they're in the past. */
export async function pruneCancelledEvents(calendarId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("calendar_id", calendarId)
    .eq("status", "cancelled")
    .eq("category_source", "auto")
    .is("page_id", null)
    .lt("ends_at", new Date().toISOString());
  if (error) throw new Error(`pruneCancelledEvents failed: ${error.message}`);
}

/**
 * After a full resync, delete mirrored events Google no longer returns.
 *
 * Only touches the window the full sync actually covered (`from` onward), so
 * older history the sync never asked for isn't collateral damage. Rows with a
 * linked note or a hand-set category are spared, for the same reason
 * cancellations are tombstoned rather than deleted.
 *
 * Callers must not invoke this after a truncated listing — see the MAX_PAGES
 * guard in sync.ts. `seenGoogleEventIds` being incomplete turns this into a
 * mass delete of perfectly current events.
 */
export async function pruneEventsMissingFrom(
  calendarId: string,
  seenGoogleEventIds: Set<string>,
  from: string
): Promise<number> {
  const supabase = createServiceSupabase();
  const rows = await selectAllPages<{
    id: string;
    google_event_id: string;
    page_id: string | null;
    category_source: "auto" | "manual";
  }>("pruneEventsMissingFrom", (client, offset, pageSize) =>
    client
      .from("calendar_events")
      .select("id, google_event_id, page_id, category_source")
      .eq("calendar_id", calendarId)
      .gte("starts_at", from)
      .order("starts_at", { ascending: true })
      .range(offset, offset + pageSize - 1)
  );

  const doomed = rows
    .filter(
      (row) =>
        !seenGoogleEventIds.has(row.google_event_id) &&
        !row.page_id &&
        row.category_source !== "manual"
    )
    .map((row) => row.id);
  if (doomed.length === 0) return 0;

  // Chunked: a `.in()` of a few thousand ids overflows the request URL.
  for (let i = 0; i < doomed.length; i += 200) {
    const { error: deleteError } = await supabase
      .from("calendar_events")
      .delete()
      .in("id", doomed.slice(i, i + 200));
    if (deleteError) {
      throw new Error(`pruneEventsMissingFrom delete failed: ${deleteError.message}`);
    }
  }
  return doomed.length;
}

/**
 * Select shape shared by the range and upcoming queries.
 *
 * Columns are enumerated rather than `*` for one reason: `raw` holds the entire
 * untouched Google event resource, and these rows are serialised into a Server
 * Component payload. Selecting it would put several KB of unused JSON per event
 * on the wire — roughly a megabyte for a semester of classes.
 */
const EVENT_WITH_CONTEXT_SELECT = [
  "id, calendar_id, google_event_id, ical_uid, recurring_event_id, status",
  "summary, description, location",
  "is_all_day, starts_at, ends_at, start_date, end_date, time_zone",
  "html_link, meeting_url, color_id, attendees, organizer",
  "etag, google_updated_at, category, category_source, page_id, managed_by_app",
  "created_at, updated_at",
  "calendars!inner(summary, background_color, access_role, is_selected)",
  "pages(title, spaces(slug))",
].join(", ");

type EventJoinRow = CalendarEvent & {
  calendars: {
    summary: string;
    background_color: string | null;
    access_role: string | null;
    is_selected: boolean;
  } | null;
  pages: { title: string; spaces: { slug: string } | null } | null;
};

function flatten(row: EventJoinRow): CalendarEventWithContext {
  const { calendars, pages, ...event } = row;
  return {
    ...event,
    calendar_summary: calendars?.summary ?? "",
    calendar_color: calendars?.background_color ?? null,
    calendar_access_role: calendars?.access_role ?? null,
    note_title: pages?.title ?? null,
    note_space_slug: pages?.spaces?.slug ?? null,
  };
}

/**
 * Every event overlapping [from, to) on calendars the user has selected.
 *
 * The overlap predicate is `starts_at < to AND ends_at > from`, which is why
 * normalize.ts stores an all-day event's bounds as half-open UTC midnights:
 * one comparison covers timed and all-day events alike.
 */
export async function getEventsInRange(
  from: string,
  to: string
): Promise<CalendarEventWithContext[]> {
  const rows = await selectAllPages<EventJoinRow>(
    "getEventsInRange",
    (client, offset, pageSize) =>
      client
        .from("calendar_events")
        .select(EVENT_WITH_CONTEXT_SELECT)
        .eq("calendars.is_selected", true)
        .lt("starts_at", to)
        .gt("ends_at", from)
        .order("starts_at", { ascending: true })
        // A stable tiebreaker. Without it, rows sharing a `starts_at` (a day of
        // back-to-back classes all at 09:00) can land in a different order per
        // page request, which duplicates some and drops others across the seam.
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1)
  );
  return rows.map(flatten);
}

/** The next `limit` non-cancelled events from now, for the upcoming rail. */
export async function getUpcomingEvents(
  limit = 12
): Promise<CalendarEventWithContext[]> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("calendar_events")
    .select(EVENT_WITH_CONTEXT_SELECT)
    .eq("calendars.is_selected", true)
    .neq("status", "cancelled")
    .gt("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`getUpcomingEvents failed: ${error.message}`);
  return ((data ?? []) as unknown as EventJoinRow[]).map(flatten);
}

export async function getEvent(
  eventId: string
): Promise<CalendarEventWithContext | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("calendar_events")
    .select(EVENT_WITH_CONTEXT_SELECT)
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(`getEvent failed: ${error.message}`);
  return data ? flatten(data as unknown as EventJoinRow) : null;
}

/** The raw row, including which Google calendar it lives on — for write-back. */
export async function getEventRow(eventId: string): Promise<CalendarEvent | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("calendar_events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(`getEventRow failed: ${error.message}`);
  return (data as CalendarEvent | null) ?? null;
}

/** A manual choice; sets `category_source` so no sync can undo it. */
export async function setEventCategory(
  eventId: string,
  category: CalendarEventCategory
): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendar_events")
    .update({ category, category_source: "manual" })
    .eq("id", eventId);
  if (error) throw new Error(`setEventCategory failed: ${error.message}`);
}

export async function linkEventToPage(
  eventId: string,
  pageId: string | null
): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendar_events")
    .update({ page_id: pageId })
    .eq("id", eventId);
  if (error) throw new Error(`linkEventToPage failed: ${error.message}`);
}

/** The event a page is the meeting note for, if any (page → event backlink). */
export async function getEventForPage(
  pageId: string
): Promise<CalendarEventWithContext | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase
    .from("calendar_events")
    .select(EVENT_WITH_CONTEXT_SELECT)
    .eq("page_id", pageId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getEventForPage failed: ${error.message}`);
  return data ? flatten(data as unknown as EventJoinRow) : null;
}

export async function deleteEventRow(eventId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const { error } = await supabase
    .from("calendar_events")
    .delete()
    .eq("id", eventId);
  if (error) throw new Error(`deleteEventRow failed: ${error.message}`);
}
