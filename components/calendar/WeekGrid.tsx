"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import clsx from "clsx";
import type { CalendarEventWithContext } from "@/lib/db/types";
import {
  isMultiDay,
  isSameDay,
  layoutSpans,
  layoutTimedDay,
  startOfDay,
  toDayKey,
} from "@/lib/calendar/grid";
import EventChip from "./EventChip";

/** Pixels per hour. Every vertical position in this file derives from it. */
const HOUR_HEIGHT = 48;
/** Width of the hour-label gutter. */
const GUTTER_WIDTH = 56;
const BAR_HEIGHT = 18;
const BAR_ROW = BAR_HEIGHT + 1;
/** Where the time grid is scrolled on mount — nobody starts their day at midnight. */
const INITIAL_HOUR = 7;
/** Empty-slot clicks land on the nearest half hour. */
const SNAP_MINUTES = 30;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** "1 AM" — built from a throwaway date because only the hour matters. */
function hourLabel(hour: number): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: "numeric" });
}

export default function WeekGrid({
  days,
  events,
  onSelect,
  onCreate,
}: {
  days: Date[];
  events: CalendarEventWithContext[];
  onSelect: (event: CalendarEventWithContext) => void;
  onCreate: (isoInstant: string) => void;
}): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Both "today" and the now-line are browser-only facts: rendering them during
  // SSR would hydrate-mismatch for any viewer outside the server's timezone.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = INITIAL_HOUR * HOUR_HEIGHT - 8;
    }
    // Only on mount: re-running on a week change would yank the user back to 7 AM.
  }, []);

  const allDaySegments = useMemo(
    () => layoutSpans(events.filter(isMultiDay), days),
    [events, days]
  );
  const allDayLanes = allDaySegments.reduce(
    (max, segment) => Math.max(max, segment.lane + 1),
    0
  );

  const columnTemplate = `${GUTTER_WIDTH}px repeat(${days.length}, minmax(0, 1fr))`;

  const handleSlotClick = (
    clickEvent: React.MouseEvent<HTMLDivElement>,
    day: Date
  ) => {
    const rect = clickEvent.currentTarget.getBoundingClientRect();
    const minutes = ((clickEvent.clientY - rect.top) / HOUR_HEIGHT) * 60;
    const snapped = Math.min(
      24 * 60 - SNAP_MINUTES,
      Math.max(0, Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES)
    );
    const base = startOfDay(day);
    // Built from date parts, not by adding milliseconds — the Date constructor
    // normalises the minute overflow and stays on the right side of a DST shift.
    const start = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate(),
      0,
      snapped
    );
    onCreate(start.toISOString());
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Day headers */}
      <div
        className="sticky top-0 z-30 grid shrink-0 border-b border-neutral-200 bg-background dark:border-neutral-800"
        style={{ gridTemplateColumns: columnTemplate }}
      >
        <div />
        {days.map((day) => {
          const isToday = now !== null && isSameDay(day, now);
          return (
            <div
              key={toDayKey(day)}
              className="flex flex-col items-center gap-0.5 border-l border-neutral-200 py-1.5 dark:border-neutral-800"
            >
              <span className="text-[11px] font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span
                className={clsx(
                  "flex size-7 items-center justify-center rounded-full text-sm",
                  isToday
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "text-neutral-800 dark:text-neutral-200"
                )}
              >
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* All-day strip. Kept at a one-lane minimum so the time grid below does
          not jump as the user pages between weeks. */}
      <div
        className="grid shrink-0 border-b border-neutral-200 dark:border-neutral-800"
        style={{ gridTemplateColumns: columnTemplate }}
      >
        <div className="flex items-start justify-end pt-1 pr-2 text-[10px] text-neutral-400 dark:text-neutral-500">
          all-day
        </div>
        <div
          className="relative grid py-0.5"
          style={{
            gridColumn: "2 / -1",
            gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            gridAutoRows: `${BAR_ROW}px`,
            height: Math.max(allDayLanes, 1) * BAR_ROW + 4,
          }}
        >
          {/* Column rules so the strip lines up with the grid beneath it. */}
          {days.map((day, index) => (
            <div
              key={`rule-${toDayKey(day)}`}
              aria-hidden
              className="pointer-events-none border-l border-neutral-200 dark:border-neutral-800"
              style={{ gridColumn: index + 1, gridRow: "1 / -1" }}
            />
          ))}
          {allDaySegments.map((segment) => (
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
                className="h-[18px]"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: columnTemplate,
            height: 24 * HOUR_HEIGHT,
          }}
        >
          {/* Hour rules, drawn once across the whole grid rather than per column. */}
          <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute inset-x-0 border-t border-neutral-200 dark:border-neutral-800"
                style={{ top: hour * HOUR_HEIGHT }}
              />
            ))}
          </div>

          {/* Hour labels. Hour 0 is skipped — its label would sit half outside
              the scroll container. */}
          <div className="relative">
            {HOURS.filter((hour) => hour > 0).map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[11px] text-neutral-400 tabular-nums dark:text-neutral-500"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hourLabel(hour)}
              </span>
            ))}
          </div>

          {days.map((day) => {
            const boxes = layoutTimedDay(events, day);
            const isToday = now !== null && isSameDay(day, now);
            const nowOffset =
              isToday && now
                ? ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT
                : null;

            return (
              <div
                key={toDayKey(day)}
                onClick={(clickEvent) => handleSlotClick(clickEvent, day)}
                className="relative border-l border-neutral-200 dark:border-neutral-800"
              >
                {boxes.map((box) => (
                  <EventChip
                    key={box.event.id}
                    event={box.event}
                    variant="timed"
                    onSelect={onSelect}
                    style={{
                      top: (box.startMinute / 60) * HOUR_HEIGHT,
                      height: ((box.endMinute - box.startMinute) / 60) * HOUR_HEIGHT,
                      left: `${(box.column / box.columnCount) * 100}%`,
                      width: `${(1 / box.columnCount) * 100}%`,
                    }}
                  />
                ))}

                {nowOffset !== null && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-20"
                    style={{ top: nowOffset }}
                  >
                    <div className="h-px bg-secondary" />
                    <div className="absolute -top-[3px] -left-[3px] size-[7px] rounded-full bg-secondary" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
