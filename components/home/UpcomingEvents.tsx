"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatRelativeDay, formatTime, fromDayKey } from "@/lib/calendar/grid";
import { CATEGORY_STYLES } from "@/components/calendar/colors";
import type { CalendarEventWithContext } from "@/lib/db/types";

/**
 * "Coming up" rail for Home.
 *
 * A client component, not a Server Component: the labels go through
 * toLocaleDateString/toLocaleTimeString, and only the browser knows the
 * viewer's locale and timezone.
 *
 * That is *not* a hydration guard, though — client components are still
 * server-rendered. Anything read off the clock (formatRelativeDay's
 * "Today"/"Tomorrow" hinge on *now*) has to be held back until mount instead,
 * which is what `now === null` below does. Same pattern as AgendaList,
 * MonthGrid and the calendar page's own UpcomingRail.
 *
 * Renders nothing when there are no events: Home shouldn't grow a dead
 * section for someone who hasn't connected a calendar.
 */
export default function UpcomingEvents({
  events,
}: {
  events: CalendarEventWithContext[];
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  if (events.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Coming up
      </h2>
      <ul className="mt-3 divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {events.map((event) => {
          const style = CATEGORY_STYLES[event.category];
          // All-day events must be read from start_date, not the UTC-midnight bounds.
          const day =
            event.is_all_day && event.start_date
              ? fromDayKey(event.start_date)
              : new Date(event.starts_at);

          return (
            <li key={event.id}>
              <Link
                href="/calendar"
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800/70"
              >
                <span
                  className={`size-2 shrink-0 rounded-full ${style.dot}`}
                  aria-hidden
                />
                {/* Fixed-width whether or not the label is there yet, so the
                    row doesn't reflow when it appears on mount. */}
                <span className="w-20 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                  {now === null ? "" : formatRelativeDay(day, now)}
                </span>
                <span className="w-16 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                  {event.is_all_day ? "All day" : formatTime(event.starts_at)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-neutral-900 dark:text-neutral-100">
                  {event.summary || "Untitled"}
                </span>
                {event.page_id && (
                  <span
                    className="shrink-0 text-xs"
                    title={event.note_title ?? "Note attached"}
                  >
                    📎
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
