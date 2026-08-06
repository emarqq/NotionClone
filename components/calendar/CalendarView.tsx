"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import {
  addDays,
  addMonths,
  buildWeek,
  startOfDay,
} from "@/lib/calendar/grid";
import type {
  CalendarAccountPublic,
  CalendarEventWithContext,
  CalendarRow,
  Space,
} from "@/lib/db/types";
import AgendaList from "./AgendaList";
import CalendarSettingsPanel from "./CalendarSettingsPanel";
import CalendarToolbar from "./CalendarToolbar";
import ConnectCard from "./ConnectCard";
import EventComposer from "./EventComposer";
import EventPanel from "./EventPanel";
import MonthGrid from "./MonthGrid";
import UpcomingRail from "./UpcomingRail";
import WeekGrid from "./WeekGrid";
import { hydrateCalendarPrefs, useCalendarStore } from "./store";

/** How often the page re-polls Google while it is open. The server throttles
 *  on top of this, so a burst of tab switches still costs one API call. */
const AUTO_SYNC_MS = 5 * 60_000;

/** Coverage the loaded event window must have on either side of the cursor
 *  before a fetch is skipped — a month grid paints ~6 weeks around its cursor
 *  and the agenda shows a whole month, so "the cursor is loaded" isn't enough. */
const REQUIRED_MARGIN_DAYS = 45;

/** The window fetched when the cursor does leave the loaded range. Comfortably
 *  under the events route's ~18-month ceiling. */
const FETCH_BACK_DAYS = 90;
const FETCH_AHEAD_DAYS = 275;

interface SyncResponse {
  ok?: boolean;
  connected?: boolean;
  skipped?: boolean;
  upserted?: number;
  cancelled?: number;
  pruned?: number;
  errors?: string[];
  error?: string;
}

function mergeById(
  base: CalendarEventWithContext[],
  incoming: CalendarEventWithContext[]
): CalendarEventWithContext[] {
  const byId = new Map(base.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return [...byId.values()];
}

async function postSync(force: boolean): Promise<SyncResponse> {
  const response = await fetch("/api/calendar/sync", {
    method: "POST",
    ...(force
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ force: true }),
        }
      : {}),
  });
  const body = (await response.json().catch(() => ({}))) as SyncResponse;
  if (!response.ok) {
    throw new Error(body.error ?? `Sync failed (${response.status}).`);
  }
  return body;
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: "amber" | "red" | "neutral";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const tones = {
    amber:
      "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
    red: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
    neutral:
      "border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300",
  } as const;

  return (
    <div
      className={`flex items-start gap-2 border-b px-4 py-2 text-xs ${tones[tone]}`}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

export default function CalendarView({
  configured,
  accounts,
  calendars,
  spaces,
  initialEvents,
  loadedFrom,
  loadedTo,
  connectStatus,
  connectDetail,
}: {
  configured: boolean;
  accounts: CalendarAccountPublic[];
  calendars: CalendarRow[];
  spaces: Space[];
  initialEvents: CalendarEventWithContext[];
  loadedFrom: string;
  loadedTo: string;
  connectStatus: string | null;
  connectDetail: string | null;
}) {
  const router = useRouter();

  const view = useCalendarStore((s) => s.view);
  const cursorIso = useCalendarStore((s) => s.cursorIso);
  const categoryFilter = useCalendarStore((s) => s.categoryFilter);
  const selectedEventId = useCalendarStore((s) => s.selectedEventId);
  const selectEvent = useCalendarStore((s) => s.selectEvent);
  const composerOpen = useCalendarStore((s) => s.composerOpen);
  const composerSeed = useCalendarStore((s) => s.composerSeed);
  const openComposer = useCalendarStore((s) => s.openComposer);
  const settingsOpen = useCalendarStore((s) => s.settingsOpen);

  const [syncing, setSyncing] = useState(connectStatus === "connected");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [reauthDismissed, setReauthDismissed] = useState(false);
  const [connectDismissed, setConnectDismissed] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  /** Events fetched on demand for ranges the server render didn't cover. */
  const [extras, setExtras] = useState<CalendarEventWithContext[]>([]);
  const [covered, setCovered] = useState({ from: loadedFrom, to: loadedTo });

  const hasAccounts = accounts.length > 0;
  const needsReauth = accounts.some((a) => a.status === "needs_reauth");

  useEffect(() => hydrateCalendarPrefs(), []);

  /* ---------------- sync ---------------- */

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const result = await postSync(true);
      if (result.errors && result.errors.length > 0) {
        setSyncError(result.errors.join(" · "));
      }
      router.refresh();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }, [router]);

  // Just came back from Google's consent screen: force a sync so the grid isn't
  // empty on the first paint, then drop the query params — a reload of
  // /calendar?connect=connected would otherwise re-fire the whole thing.
  const connectSyncRan = useRef(false);
  useEffect(() => {
    if (connectStatus !== "connected" || connectSyncRan.current) return;
    connectSyncRan.current = true;

    // Deliberately not cancelled on unmount: the ref makes this a one-shot, and
    // aborting it in StrictMode's double-invoke would leave the query params in
    // place and the "Syncing…" banner stuck on forever.
    void (async () => {
      try {
        await postSync(true);
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : "Sync failed.");
      }
      setSyncing(false);
      router.replace("/calendar");
      router.refresh();
    })();
  }, [connectStatus, router]);

  // Background polling. Skipped on the connect round-trip, which is already
  // running a forced sync of its own.
  useEffect(() => {
    if (!configured || !hasAccounts || connectStatus === "connected") return;

    let cancelled = false;
    const poll = async () => {
      try {
        const result = await postSync(false);
        if (cancelled || result.skipped) return;
        const changed =
          (result.upserted ?? 0) + (result.cancelled ?? 0) + (result.pruned ?? 0) > 0;
        if (changed) router.refresh();
      } catch {
        // A failed background poll is not worth a banner; "Sync now" surfaces
        // the error when the user actually asks for one.
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), AUTO_SYNC_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [configured, hasAccounts, connectStatus, router]);

  /* ---------------- event window ---------------- */

  // A fresh server render is authoritative: throw away the on-demand extras so
  // a deleted event can't survive in them, and let the effect below refetch if
  // the cursor is still outside the server's window.
  useEffect(() => {
    setExtras([]);
    setCovered({ from: loadedFrom, to: loadedTo });
  }, [initialEvents, loadedFrom, loadedTo]);

  useEffect(() => {
    if (cursorIso === null) return;
    const cursor = new Date(cursorIso);
    const needFrom = addDays(cursor, -REQUIRED_MARGIN_DAYS).getTime();
    const needTo = addDays(cursor, REQUIRED_MARGIN_DAYS).getTime();
    if (
      needFrom >= Date.parse(covered.from) &&
      needTo <= Date.parse(covered.to)
    ) {
      return;
    }

    const from = addDays(cursor, -FETCH_BACK_DAYS);
    const to = addDays(cursor, FETCH_AHEAD_DAYS);
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/calendar/events?from=${encodeURIComponent(
            from.toISOString()
          )}&to=${encodeURIComponent(to.toISOString())}`
        );
        if (!response.ok) return;
        const body = (await response.json()) as {
          events?: CalendarEventWithContext[];
        };
        if (cancelled) return;
        setExtras((prev) => mergeById(prev, body.events ?? []));
        setCovered((prev) => {
          // Only merge when the windows touch; a jump to next year replaces the
          // covered range outright rather than claiming the gap between them.
          const overlaps =
            from.getTime() <= Date.parse(prev.to) &&
            to.getTime() >= Date.parse(prev.from);
          if (!overlaps) return { from: from.toISOString(), to: to.toISOString() };
          return {
            from:
              from.getTime() < Date.parse(prev.from)
                ? from.toISOString()
                : prev.from,
            to: to.getTime() > Date.parse(prev.to) ? to.toISOString() : prev.to,
          };
        });
      } catch {
        // Offline or the server restarted — the loaded window still renders.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cursorIso, covered]);

  /* ---------------- derived ---------------- */

  const allEvents = useMemo(
    () => mergeById(extras, initialEvents),
    [extras, initialEvents]
  );

  const visibleEvents = useMemo(
    () =>
      categoryFilter.length === 0
        ? allEvents
        : allEvents.filter((event) => categoryFilter.includes(event.category)),
    [allEvents, categoryFilter]
  );

  // Null until the mount effect resolves it (see store.ts).
  const cursor = cursorIso === null ? null : new Date(cursorIso);

  // Agenda steps by month, so it lists the cursor's month rather than every
  // event ever loaded.
  const agendaEvents = useMemo(() => {
    if (cursorIso === null) return [];
    const anchor = new Date(cursorIso);
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const monthEnd = addMonths(monthStart, 1);
    return visibleEvents.filter(
      (event) =>
        Date.parse(event.starts_at) < monthEnd.getTime() &&
        Date.parse(event.ends_at) > monthStart.getTime()
    );
  }, [visibleEvents, cursorIso]);

  const selectedEvent = selectedEventId
    ? (allEvents.find((event) => event.id === selectedEventId) ?? null)
    : null;
  const editingEvent = editingEventId
    ? allEvents.find((event) => event.id === editingEventId)
    : undefined;

  const onSelect = useCallback(
    (event: CalendarEventWithContext) => selectEvent(event.id),
    [selectEvent]
  );

  // The composer owns `editingEventId` only for as long as it is open.
  useEffect(() => {
    if (!composerOpen) setEditingEventId(null);
  }, [composerOpen]);

  /* ---------------- empty states ---------------- */

  if (!configured) return <ConnectCard mode="unconfigured" />;
  if (!hasAccounts) return <ConnectCard mode="disconnected" />;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {connectStatus === "connected" && syncing && (
        <Banner tone="neutral">
          <span className="flex items-center gap-1.5">
            <RefreshCw size={12} className="animate-spin" />
            Syncing your calendars…
          </span>
        </Banner>
      )}

      {(connectStatus === "denied" || connectStatus === "error") &&
        !connectDismissed && (
          <Banner
            tone="red"
            onDismiss={() => {
              setConnectDismissed(true);
              router.replace("/calendar");
            }}
          >
            <strong className="font-medium">
              {connectStatus === "denied"
                ? "Google sign-in was cancelled."
                : "Google sign-in failed."}
            </strong>
            {connectDetail ? ` ${connectDetail}` : null}
          </Banner>
        )}

      {needsReauth && !reauthDismissed && (
        <Banner tone="amber" onDismiss={() => setReauthDismissed(true)}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <AlertTriangle size={13} className="shrink-0" />
            <strong className="font-medium">
              Google Calendar needs to be reconnected
            </strong>
            {/* Plain <a>: the OAuth start route redirects off-origin. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/calendar/auth/start"
              className="rounded border border-current px-2 py-0.5 font-medium hover:opacity-80"
            >
              Reconnect
            </a>
          </span>
          <p className="mt-1 opacity-80">
            Google expires refresh tokens after 7 days while the OAuth consent
            screen is in Testing mode, so this comes back about once a week.
            Reconnecting takes two clicks and nothing is lost.
          </p>
        </Banner>
      )}

      {syncError && (
        <Banner tone="red" onDismiss={() => setSyncError(null)}>
          {syncError}
        </Banner>
      )}

      <CalendarToolbar accounts={accounts} syncing={syncing} onSync={() => void syncNow()} />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Held back until the cursor is known rather than guessing a month:
              a grid painted from the server's "now" would flash the wrong month
              and hydrate-mismatch. The empty box is `flex-1` like the grids it
              stands in for, so nothing moves when they replace it. */}
          {cursor === null ? (
            <div className="min-h-0 flex-1" aria-hidden />
          ) : (
            <>
              {view === "month" && (
                <MonthGrid
                  cursor={cursor}
                  events={visibleEvents}
                  onSelect={onSelect}
                  onCreate={(dayKey) => openComposer({ dayKey })}
                />
              )}
              {view === "week" && (
                <WeekGrid
                  days={buildWeek(cursor)}
                  events={visibleEvents}
                  onSelect={onSelect}
                  onCreate={(instant) => openComposer({ instant })}
                />
              )}
              {view === "day" && (
                <WeekGrid
                  days={[startOfDay(cursor)]}
                  events={visibleEvents}
                  onSelect={onSelect}
                  onCreate={(instant) => openComposer({ instant })}
                />
              )}
              {view === "agenda" && (
                <AgendaList
                  events={agendaEvents}
                  onSelect={onSelect}
                  emptyText="Nothing on the calendar this month."
                />
              )}
            </>
          )}
        </div>

        <UpcomingRail events={allEvents} onSelect={onSelect} />
      </div>

      {selectedEvent && (
        <EventPanel
          key={selectedEvent.id}
          event={selectedEvent}
          spaces={spaces}
          onEdit={() => {
            setEditingEventId(selectedEvent.id);
            openComposer(null);
          }}
        />
      )}

      {composerOpen && (
        // Keyed so a new seed (or switching from create to edit) remounts the
        // form instead of leaving the previous draft's values in place.
        <EventComposer
          key={
            editingEventId ??
            `new:${composerSeed?.dayKey ?? ""}:${composerSeed?.instant ?? ""}`
          }
          event={editingEvent}
          calendars={calendars}
        />
      )}

      {settingsOpen && (
        <CalendarSettingsPanel accounts={accounts} calendars={calendars} />
      )}
    </div>
  );
}
