import "server-only";

import {
  getAccountsInternal,
  getCalendars,
  isWritable,
  markEventsCancelled,
  pruneCancelledEvents,
  pruneEventsMissingFrom,
  setAccountError,
  setAccountSyncedNow,
  updateCalendarSyncState,
  upsertCalendars,
  upsertEvents,
  type EventUpsertInput,
} from "@/lib/db/calendar";
import { categorizeEvent } from "./categorize";
import { syncPastDays } from "./config";
import { listCalendars, listEventsPage } from "./googleApi";
import { normalizeEvent } from "./normalize";
import { getAccessTokenForAccount, NeedsReauthError } from "./tokens";
import { GoogleApiError } from "./types";
import type { CalendarAccount, CalendarRow } from "@/lib/db/types";

/**
 * Pulling Google's calendars into the local mirror.
 *
 * The protocol is Google's `syncToken` incremental sync: the first pass over a
 * calendar is a bounded full listing that ends with a `nextSyncToken`, and every
 * pass after it hands that token back and receives only what changed. There is
 * no webhook path — `events.watch` requires a public HTTPS endpoint with a
 * real certificate, and this app is bound to localhost on purpose — so freshness
 * comes from polling: the calendar page syncs on open and on an interval, and
 * there is a manual "Sync now".
 *
 * https://developers.google.com/workspace/calendar/api/guides/sync
 */

/** Stops a pathological listing from paging forever. 250 events/page. */
const MAX_PAGES = 40;

export interface CalendarSyncStats {
  calendarId: string;
  summary: string;
  upserted: number;
  cancelled: number;
  pruned: number;
  /** True when this run had to fall back to (or start with) a full listing. */
  fullSync: boolean;
  error?: string;
}

export interface AccountSyncResult {
  accountId: string;
  accountEmail: string;
  calendars: CalendarSyncStats[];
  needsReauth: boolean;
  error?: string;
}

/** Sync every connected account. Never throws — failures land in the result. */
export async function syncAllAccounts(): Promise<AccountSyncResult[]> {
  const accounts = await getAccountsInternal();
  const results: AccountSyncResult[] = [];
  for (const account of accounts) {
    if (account.status === "disconnected") continue;
    results.push(await syncAccount(account));
  }
  return results;
}

export async function syncAccount(
  account: CalendarAccount
): Promise<AccountSyncResult> {
  const base: AccountSyncResult = {
    accountId: account.id,
    accountEmail: account.account_email,
    calendars: [],
    needsReauth: false,
  };

  let accessToken: string;
  try {
    accessToken = await getAccessTokenForAccount(account);
  } catch (err) {
    if (err instanceof NeedsReauthError) {
      return { ...base, needsReauth: true, error: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    await setAccountError(account.id, message);
    return { ...base, error: message };
  }

  try {
    const entries = await listCalendars(accessToken);
    await upsertCalendars(
      account.id,
      entries
        .filter((entry) => entry.id && !entry.deleted)
        .map((entry) => ({
          googleCalendarId: entry.id as string,
          summary: entry.summaryOverride || entry.summary || "(untitled)",
          description: entry.description ?? null,
          timeZone: entry.timeZone ?? null,
          backgroundColor: entry.backgroundColor ?? null,
          foregroundColor: entry.foregroundColor ?? null,
          accessRole: entry.accessRole ?? null,
          isPrimary: entry.primary === true,
          selectedInGoogle: entry.selected !== false,
        }))
    );
  } catch (err) {
    if (err instanceof NeedsReauthError) {
      return { ...base, needsReauth: true, error: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    await setAccountError(account.id, message);
    return { ...base, error: message };
  }

  // Only calendars the user kept switched on are worth spending sync on.
  const calendars = (await getCalendars(account.id)).filter(
    (calendar) => calendar.is_selected
  );

  for (const calendar of calendars) {
    base.calendars.push(await syncCalendar(accessToken, calendar));
  }

  await setAccountSyncedNow(account.id);
  return base;
}

async function syncCalendar(
  accessToken: string,
  calendar: CalendarRow
): Promise<CalendarSyncStats> {
  const stats: CalendarSyncStats = {
    calendarId: calendar.id,
    summary: calendar.summary,
    upserted: 0,
    cancelled: 0,
    pruned: 0,
    fullSync: calendar.sync_token === null,
  };

  const timeMin = new Date(
    Date.now() - syncPastDays() * 86_400_000
  ).toISOString();

  try {
    let syncToken = calendar.sync_token ?? undefined;
    let attemptedFullResync = false;

    // Outer loop exists solely so a 410 can restart the listing as a full sync.
    for (;;) {
      const isFullSync = !syncToken;
      const seenIds = new Set<string>();
      const cancelledIds: string[] = [];
      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;
      let restart = false;

      for (let page = 0; page < MAX_PAGES; page++) {
        let response;
        try {
          response = await listEventsPage(accessToken, calendar.google_calendar_id, {
            syncToken,
            // Illegal to combine with syncToken — bounds the full listing only.
            timeMin: isFullSync ? timeMin : undefined,
            pageToken,
          });
        } catch (err) {
          if (
            err instanceof GoogleApiError &&
            err.isSyncTokenExpired &&
            !attemptedFullResync
          ) {
            // Google's only documented recovery: discard the cursor and do a
            // fresh full listing. Guarded so a persistently-410ing calendar
            // can't ping-pong forever.
            attemptedFullResync = true;
            await updateCalendarSyncState(calendar.id, null);
            syncToken = undefined;
            stats.fullSync = true;
            restart = true;
            break;
          }
          throw err;
        }

        const batch: EventUpsertInput[] = [];
        for (const item of response.items ?? []) {
          const result = normalizeEvent(item);
          if (result.kind === "cancelled") {
            cancelledIds.push(result.googleEventId);
            continue;
          }
          if (result.kind === "skip") continue;

          seenIds.add(result.event.google_event_id);
          if (result.event.status === "cancelled") {
            // A full event body that happens to be cancelled: store it (so the
            // note and category survive) rather than treating it as a tombstone.
            cancelledIds.push(result.event.google_event_id);
          }
          batch.push({
            ...result.event,
            category: categorizeEvent({
              summary: result.event.summary,
              location: result.event.location,
              isRecurring: Boolean(result.event.recurring_event_id),
              isAllDay: result.event.is_all_day,
            }),
            category_source: "auto",
          });
        }

        stats.upserted += await upsertEvents(calendar.id, batch);

        pageToken = response.nextPageToken;
        nextSyncToken = response.nextSyncToken;
        // nextPageToken and nextSyncToken are mutually exclusive: the token
        // arrives only on the final page.
        if (!pageToken) break;
      }

      if (restart) continue;

      // Did the listing actually reach the end? A still-set pageToken means the
      // MAX_PAGES guard cut it short, so `seenIds` holds only a prefix of what
      // Google would have returned.
      const truncated = Boolean(pageToken);

      if (cancelledIds.length > 0) {
        stats.cancelled = await markEventsCancelled(calendar.id, cancelledIds);
      }
      if (isFullSync && !truncated) {
        // Only safe on a listing that ran to completion. Pruning against a
        // truncated `seenIds` would read every event past the cut-off as
        // "Google no longer has this" and delete real, current events —
        // a whole semester of classes, on a calendar big enough to page.
        stats.pruned = await pruneEventsMissingFrom(calendar.id, seenIds, timeMin);
      } else if (isFullSync) {
        console.warn(
          `[calendar] full sync of "${calendar.summary}" hit the ${MAX_PAGES}-page ` +
            `limit; skipping the prune pass so nothing is deleted on partial data.`
        );
      }
      await pruneCancelledEvents(calendar.id);

      // No token means the listing was truncated by MAX_PAGES; leaving the old
      // (or null) cursor in place makes the next run redo the work rather than
      // skipping the tail forever.
      if (nextSyncToken) {
        await updateCalendarSyncState(calendar.id, nextSyncToken);
      }
      return stats;
    }
  } catch (err) {
    if (err instanceof NeedsReauthError) throw err;
    stats.error = err instanceof Error ? err.message : String(err);
    return stats;
  }
}

/** Aggregate counts for the "Synced N events" toast. */
export function summarizeSync(results: AccountSyncResult[]): {
  upserted: number;
  cancelled: number;
  pruned: number;
  needsReauth: boolean;
  errors: string[];
} {
  const summary = {
    upserted: 0,
    cancelled: 0,
    pruned: 0,
    needsReauth: false,
    errors: [] as string[],
  };
  for (const account of results) {
    if (account.needsReauth) summary.needsReauth = true;
    if (account.error) summary.errors.push(`${account.accountEmail}: ${account.error}`);
    for (const calendar of account.calendars) {
      summary.upserted += calendar.upserted;
      summary.cancelled += calendar.cancelled;
      summary.pruned += calendar.pruned;
      if (calendar.error) {
        summary.errors.push(`${calendar.summary}: ${calendar.error}`);
      }
    }
  }
  return summary;
}

/** Re-export so callers don't reach past sync.ts for the writability check. */
export { isWritable };
