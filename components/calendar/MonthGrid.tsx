"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import clsx from "clsx";
import type { CalendarEventWithContext } from "@/lib/db/types";
import {
  buildMonthMatrix,
  eventDaySpan,
  isMultiDay,
  isSameDay,
  layoutSpans,
  toDayKey,
} from "@/lib/calendar/grid";
import EventChip from "./EventChip";

/** Height of one chip row, and of the lane grid the spanning bars sit in. */
const BAR_HEIGHT = 18;
const BAR_ROW = BAR_HEIGHT + 1;
/** Chips a cell shows before collapsing the rest into "+N more". */
const MAX_CHIPS_PER_CELL = 3;

export default function MonthGrid({
  cursor,
  events,
  onSelect,
  onCreate,
  weekStartsOn = 0,
}: {
  cursor: Date;
  events: CalendarEventWithContext[];
  onSelect: (event: CalendarEventWithContext) => void;
  onCreate: (dayKey: string) => void;
  weekStartsOn?: 0 | 1;
}): ReactElement {
  const [expandedDays, setExpandedDays] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  // "Today" is only known correctly in the browser: the server renders in its
  // own timezone, so highlighting a day during SSR would hydrate-mismatch for
  // any viewer not sitting in that zone. Null until mounted = nothing highlighted.
  const [today, setToday] = useState<Date | null>(null);
  useEffect(() => setToday(new Date()), []);

  const matrix = useMemo(
    () => buildMonthMatrix(cursor, weekStartsOn),
    [cursor, weekStartsOn]
  );

  // Multi-day events become spanning bars; everything else is bucketed by its
  // single local day so each cell is an O(1) lookup instead of a filter pass.
  const { spanEvents, singlesByDay } = useMemo(() => {
    const spans: CalendarEventWithContext[] = [];
    const byDay = new Map<string, CalendarEventWithContext[]>();
    for (const event of events) {
      if (isMultiDay(event)) {
        spans.push(event);
        continue;
      }
      const key = eventDaySpan(event).startKey;
      const bucket = byDay.get(key);
      if (bucket) bucket.push(event);
      else byDay.set(key, [event]);
    }
    for (const bucket of byDay.values()) {
      bucket.sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : 0));
    }
    return { spanEvents: spans, singlesByDay: byDay };
  }, [events]);

  const toggleDay = (dayKey: string) => {
    setExpandedDays((previous) => {
      const next = new Set(previous);
      if (!next.delete(dayKey)) next.add(dayKey);
      return next;
    });
  };

  const monthIndex = matrix.monthStart.getMonth();
  const monthYear = matrix.monthStart.getFullYear();

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Weekday header — labels come from the first rendered week so they
          follow both the locale and `weekStartsOn` without a lookup table. */}
      <div className="grid shrink-0 grid-cols-7 border-b border-neutral-200 dark:border-neutral-800">
        {matrix.weeks[0].map((day) => (
          <div
            key={day.getDay()}
            className="px-2 py-1 text-center text-[11px] font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400"
          >
            {day.toLocaleDateString(undefined, { weekday: "short" })}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-6">
        {matrix.weeks.map((weekDays, weekIndex) => {
          const segments = layoutSpans(spanEvents, weekDays);
          const spanLaneCount = segments.reduce(
            (max, segment) => Math.max(max, segment.lane + 1),
            0
          );

          return (
            <div
              key={weekIndex}
              className="relative grid min-h-0 grid-cols-7 border-b border-neutral-200 last:border-b-0 dark:border-neutral-800"
            >
              {weekDays.map((day, dayIndex) => {
                const dayKey = toDayKey(day);
                const inMonth =
                  day.getMonth() === monthIndex && day.getFullYear() === monthYear;
                const isToday = today !== null && isSameDay(day, today);
                const expanded = expandedDays.has(dayKey);

                const singles = singlesByDay.get(dayKey) ?? [];
                const spansHere = segments.filter(
                  (segment) =>
                    dayIndex >= segment.startColumn &&
                    dayIndex < segment.startColumn + segment.columnSpan
                ).length;

                // Spans are never collapsed — a bar clipped on one day of its
                // run but drawn on the next reads as two different events. Only
                // the single-day chips give way, and the "+N more" row itself
                // costs one of the three slots.
                const total = spansHere + singles.length;
                const visibleSingles =
                  expanded || total <= MAX_CHIPS_PER_CELL
                    ? singles.length
                    : Math.max(0, MAX_CHIPS_PER_CELL - 1 - spansHere);
                const hidden = singles.length - visibleSingles;

                return (
                  <div
                    key={dayKey}
                    className={clsx(
                      "relative flex min-h-0 flex-col border-r border-neutral-200 last:border-r-0 dark:border-neutral-800",
                      !inMonth && "bg-neutral-50/60 dark:bg-neutral-900/40"
                    )}
                  >
                    {/* Full-cell click target for "create here". A real <button>
                        (not a div with onClick) so it is a legitimate control,
                        but taken out of the tab order — 42 tab stops per month
                        would bury the chips that actually matter. */}
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`New event on ${day.toLocaleDateString()}`}
                      onClick={() => onCreate(dayKey)}
                      className="absolute inset-0 cursor-pointer"
                    />

                    <div className="pointer-events-none relative flex min-h-0 flex-1 flex-col">
                      <div className="flex h-[22px] shrink-0 items-center justify-center">
                        <span
                          className={clsx(
                            "flex size-5 items-center justify-center rounded-full text-xs",
                            isToday &&
                              "bg-primary font-semibold text-primary-foreground",
                            !isToday && inMonth && "text-neutral-700 dark:text-neutral-300",
                            !isToday && !inMonth && "text-neutral-400 dark:text-neutral-600"
                          )}
                        >
                          {day.getDate()}
                        </span>
                      </div>

                      {/* Reserves the lanes the spanning-bar overlay paints into,
                          so single-day chips start below them in every column. */}
                      <div
                        className="shrink-0"
                        style={{ height: spanLaneCount * BAR_ROW }}
                      />

                      <div
                        className={clsx(
                          "flex min-h-0 flex-1 flex-col gap-px px-0.5 pb-0.5",
                          expanded ? "overflow-y-auto" : "overflow-hidden"
                        )}
                      >
                        {/* Only the chips themselves re-enable pointer events —
                            the gaps between them must fall through to the
                            create-here button underneath. */}
                        {singles.slice(0, visibleSingles).map((event) => (
                          <EventChip
                            key={event.id}
                            event={event}
                            variant="bar"
                            onSelect={onSelect}
                            className="pointer-events-auto h-[18px] shrink-0"
                          />
                        ))}
                        {hidden > 0 && (
                          <button
                            type="button"
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation();
                              toggleDay(dayKey);
                            }}
                            className="pointer-events-auto h-[18px] shrink-0 rounded-[3px] px-1.5 text-left text-[11px] leading-[18px] font-medium text-neutral-500 hover:bg-neutral-200/70 dark:text-neutral-400 dark:hover:bg-neutral-800"
                          >
                            +{hidden} more
                          </button>
                        )}
                        {expanded && (
                          <button
                            type="button"
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation();
                              toggleDay(dayKey);
                            }}
                            className="pointer-events-auto h-[18px] shrink-0 rounded-[3px] px-1.5 text-left text-[11px] leading-[18px] font-medium text-neutral-500 hover:bg-neutral-200/70 dark:text-neutral-400 dark:hover:bg-neutral-800"
                          >
                            Show less
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Spanning bars live in their own 7-column overlay: a bar has to
                  cross cell boundaries, which nothing inside a cell can do. */}
              <div
                className="pointer-events-none absolute inset-x-0 grid grid-cols-7"
                style={{ top: 22, gridAutoRows: `${BAR_ROW}px` }}
              >
                {segments.map((segment) => (
                  <div
                    key={segment.event.id}
                    className={clsx(
                      "min-w-0",
                      !segment.continuesLeft && "pl-0.5",
                      !segment.continuesRight && "pr-0.5"
                    )}
                    style={{
                      gridColumn: `${segment.startColumn + 1} / span ${segment.columnSpan}`,
                      gridRow: segment.lane + 1,
                    }}
                  >
                    <EventChip
                      event={segment.event}
                      variant="bar"
                      onSelect={onSelect}
                      continuesLeft={segment.continuesLeft}
                      continuesRight={segment.continuesRight}
                      className="pointer-events-auto h-[18px]"
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
