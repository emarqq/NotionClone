"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { formatRelativeDay, formatTime, fromDayKey } from "@/lib/calendar/grid";
import type { CalendarEventCategory, CalendarEventWithContext } from "@/lib/db/types";
import { CATEGORY_STYLES } from "./colors";

/** How many rows the rail shows before it stops being a glance and starts
 *  being a second agenda view. */
const LIMIT = 8;

/**
 * The categories that carry a due date rather than an appointment.
 *
 * These are what actually bite: an application closing on Friday is invisible
 * in a month grid full of recurring classes, so it gets its own heading.
 */
const DUE_SOON: CalendarEventCategory[] = [
  "application",
  "deadline",
  "assignment",
  "exam",
  "quiz",
];

function Row({
  event,
  now,
  onSelect,
}: {
  event: CalendarEventWithContext;
  now: Date;
  onSelect: (event: CalendarEventWithContext) => void;
}) {
  const style = CATEGORY_STYLES[event.category];
  // All-day events must be read from start_date, not the UTC-midnight bounds.
  const day = event.is_all_day && event.start_date
    ? fromDayKey(event.start_date)
    : new Date(event.starts_at);

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className="group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800/70"
    >
      <span
        className={clsx("mt-1.5 size-2 shrink-0 rounded-full", style.dot)}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-neutral-800 dark:text-neutral-100">
            {event.summary || "Untitled"}
          </span>
          {event.page_id && (
            <span title={event.note_title ?? "Note attached"} className="shrink-0 text-[10px]">
              📎
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-neutral-500 dark:text-neutral-400">
          {formatRelativeDay(day, now)}
          {" · "}
          {event.is_all_day ? "All day" : formatTime(event.starts_at)}
        </span>
      </span>
    </button>
  );
}

function Group({
  label,
  events,
  now,
  onSelect,
}: {
  label: string;
  events: CalendarEventWithContext[];
  now: Date;
  onSelect: (event: CalendarEventWithContext) => void;
}) {
  if (events.length === 0) return null;
  return (
    <section>
      <h2 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </h2>
      <div className="space-y-0.5">
        {events.map((event) => (
          <Row key={event.id} event={event} now={now} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

/**
 * The "what's next" column, drawn from every loaded event rather than the
 * visible range — the point is to still see Friday's deadline while you're
 * paging around next semester.
 */
export default function UpcomingRail({
  events,
  onSelect,
}: {
  events: CalendarEventWithContext[];
  onSelect: (event: CalendarEventWithContext) => void;
}) {
  // Both the cutoff and the "Tomorrow"/"In 3 days" labels are read off the
  // viewer's clock. `"use client"` does not stop this component being rendered
  // on the server, so computing them during the first render is a hydration
  // mismatch waiting for the server process and the browser to disagree on the
  // date. Null until mounted, exactly like AgendaList/MonthGrid; the rail's
  // width is fixed, so the late content costs no layout shift.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const upcoming = useMemo(() => {
    if (now === null) return [];
    const cutoff = now.getTime();
    return events
      .filter(
        (event) =>
          event.status !== "cancelled" && Date.parse(event.ends_at) > cutoff
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .slice(0, LIMIT);
  }, [events, now]);

  const due = upcoming.filter((event) => DUE_SOON.includes(event.category));
  const other = upcoming.filter((event) => !DUE_SOON.includes(event.category));

  return (
    <aside className="hidden w-[280px] shrink-0 overflow-y-auto border-l border-neutral-200 px-2 py-3 lg:block dark:border-neutral-800">
      {now === null ? null : upcoming.length === 0 ? (
        <p className="px-2 text-xs text-neutral-400 dark:text-neutral-500">
          Nothing coming up.
        </p>
      ) : (
        <div className="space-y-4">
          <Group label="Due soon" events={due} now={now} onSelect={onSelect} />
          <Group label="Coming up" events={other} now={now} onSelect={onSelect} />
        </div>
      )}
    </aside>
  );
}
