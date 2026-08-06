"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import clsx from "clsx";
import type { CalendarEventWithContext } from "@/lib/db/types";
import {
  addDays,
  eventDaySpan,
  formatDayHeading,
  formatRelativeDay,
  fromDayKey,
  isSameDay,
  toDayKey,
} from "@/lib/calendar/grid";
import EventChip from "./EventChip";

/**
 * Guard against a corrupt row (a 3000-year "all-day" event) turning the grouping
 * loop into a hang. Two years of day rows is already far past useful.
 */
const MAX_DAYS_PER_EVENT = 732;

interface DayGroup {
  key: string;
  date: Date;
  events: CalendarEventWithContext[];
}

export default function AgendaList({
  events,
  onSelect,
  emptyText,
}: {
  events: CalendarEventWithContext[];
  onSelect: (event: CalendarEventWithContext) => void;
  emptyText?: string;
}): ReactElement {
  // Relative labels ("Today", "Tomorrow") depend on the viewer's clock, so they
  // can only be rendered after mount without risking a hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const groups = useMemo<DayGroup[]>(() => {
    const byDay = new Map<string, CalendarEventWithContext[]>();

    for (const event of events) {
      const { startKey, endKey } = eventDaySpan(event);
      // A multi-day event is listed under every day it covers — an agenda that
      // only showed it on day one would leave the middle days looking free.
      let day = fromDayKey(startKey);
      for (let step = 0; step < MAX_DAYS_PER_EVENT; step++) {
        const key = toDayKey(day);
        if (key > endKey) break;
        const bucket = byDay.get(key);
        if (bucket) bucket.push(event);
        else byDay.set(key, [event]);
        day = addDays(day, 1);
      }
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, dayEvents]) => ({
        key,
        date: fromDayKey(key),
        // All-day items head the day; timed ones follow in clock order.
        events: [...dayEvents].sort((a, b) => {
          if (a.is_all_day !== b.is_all_day) return a.is_all_day ? -1 : 1;
          if (a.starts_at !== b.starts_at) return a.starts_at < b.starts_at ? -1 : 1;
          return a.id < b.id ? -1 : 1;
        }),
      }));
  }, [events]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
        {emptyText ?? "Nothing scheduled."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {groups.map((group) => {
        const isToday = now !== null && isSameDay(group.date, now);
        return (
          <section key={group.key}>
            <header className="sticky top-0 z-10 flex items-baseline justify-between gap-2 bg-background px-2 py-1">
              <h3
                className={clsx(
                  "text-sm",
                  isToday
                    ? "font-semibold text-neutral-900 dark:text-neutral-50"
                    : "font-medium text-neutral-600 dark:text-neutral-300"
                )}
              >
                {formatDayHeading(group.date)}
              </h3>
              {now !== null && (
                <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                  {formatRelativeDay(group.date, now)}
                </span>
              )}
            </header>
            <div className="mt-0.5 flex flex-col">
              {group.events.map((event) => (
                <EventChip
                  key={event.id}
                  event={event}
                  variant="list"
                  onSelect={onSelect}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
