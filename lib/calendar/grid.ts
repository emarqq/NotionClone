/**
 * Calendar geometry: turning a list of events into positioned boxes.
 *
 * Pure, dependency-free, and NOT server-only — the month/week grids are client
 * components and must lay out in the *viewer's* timezone, which only the
 * browser knows. The server hands down ISO instants and never pre-formats a
 * date. Unit-tested in tests/calendar/grid.test.ts.
 *
 * Two conventions run through everything here:
 *
 *  - A "day key" is a local-time "YYYY-MM-DD" string. Comparing day keys as
 *    strings is the only safe way to ask "is this event on that day": Date
 *    arithmetic across a DST boundary silently drops or adds an hour, and
 *    24 * 60 * 60 * 1000 is not a day on the first Sunday of November.
 *  - All-day events are read from `start_date`/`end_date` (inclusive, already
 *    normalised) and never from `starts_at`/`ends_at`, whose UTC midnights
 *    would shift the day for any viewer west of Greenwich.
 */

/** The minimum an event row needs to be laid out. */
export interface GridEvent {
  id: string;
  is_all_day: boolean;
  starts_at: string;
  ends_at: string;
  start_date: string | null;
  end_date: string | null;
}

export type WeekStart = 0 | 1;

/* -------------------------------------------------------------------------
 * Day keys
 * ---------------------------------------------------------------------- */

/** Local-time "YYYY-MM-DD" for a Date. */
export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" → a Date at local midnight of that day. */
export function fromDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Local midnight of `date`. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Shift by whole calendar days, staying on local midnight.
 *
 * Built from the date parts rather than by adding milliseconds so a DST change
 * inside the range can't move the clock off midnight.
 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function addMonths(date: Date, months: number): Date {
  // Day 1 first: `new Date(2026, 0, 31 + 1 month)` is March 3, not February 28.
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

export function isSameDay(a: Date, b: Date): boolean {
  return toDayKey(a) === toDayKey(b);
}

export function startOfWeek(date: Date, weekStartsOn: WeekStart = 0): Date {
  const day = startOfDay(date);
  const shift = (day.getDay() - weekStartsOn + 7) % 7;
  return addDays(day, -shift);
}

/* -------------------------------------------------------------------------
 * Event day spans
 * ---------------------------------------------------------------------- */

export interface DaySpan {
  /** Inclusive first local day the event appears on. */
  startKey: string;
  /** Inclusive last local day the event appears on. */
  endKey: string;
}

/**
 * The inclusive range of local days an event should be painted on.
 *
 * The subtlety is the end boundary of a timed event: a 10pm–midnight event ends
 * at exactly 00:00 the next day, and painting it on that next day puts a stray
 * empty bar on an otherwise free morning. If the end instant lands precisely on
 * a local midnight after the start day, the span stops the day before.
 */
export function eventDaySpan(event: GridEvent): DaySpan {
  if (event.is_all_day) {
    const startKey = event.start_date ?? toDayKey(new Date(event.starts_at));
    const endKey = event.end_date ?? startKey;
    return { startKey, endKey: endKey < startKey ? startKey : endKey };
  }

  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  const startKey = toDayKey(start);
  let endKey = toDayKey(end);

  const endsOnLocalMidnight =
    end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0;
  if (endsOnLocalMidnight && endKey > startKey) {
    endKey = toDayKey(addDays(end, -1));
  }
  return { startKey, endKey: endKey < startKey ? startKey : endKey };
}

/** Does the event cover this local day? */
export function occursOn(event: GridEvent, dayKey: string): boolean {
  const span = eventDaySpan(event);
  return span.startKey <= dayKey && dayKey <= span.endKey;
}

/** True for events the month grid draws as a spanning bar rather than a time. */
export function isMultiDay(event: GridEvent): boolean {
  const span = eventDaySpan(event);
  return event.is_all_day || span.endKey > span.startKey;
}

/* -------------------------------------------------------------------------
 * Month grid
 * ---------------------------------------------------------------------- */

export interface MonthMatrix {
  /** Always 6 rows of 7, so the grid's height doesn't jump between months. */
  weeks: Date[][];
  /** First of the displayed month (local midnight). */
  monthStart: Date;
  /** Local midnight of the first day drawn (may be in the previous month). */
  gridStart: Date;
  /** Local midnight of the day AFTER the last one drawn. */
  gridEnd: Date;
}

export function buildMonthMatrix(
  cursor: Date,
  weekStartsOn: WeekStart = 0
): MonthMatrix {
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart, weekStartsOn);
  const weeks: Date[][] = [];
  for (let week = 0; week < 6; week++) {
    weeks.push(
      Array.from({ length: 7 }, (_, day) => addDays(gridStart, week * 7 + day))
    );
  }
  return { weeks, monthStart, gridStart, gridEnd: addDays(gridStart, 42) };
}

export function buildWeek(cursor: Date, weekStartsOn: WeekStart = 0): Date[] {
  const start = startOfWeek(cursor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/* -------------------------------------------------------------------------
 * Spanning bars (month grid rows, and the week view's all-day strip)
 * ---------------------------------------------------------------------- */

export interface SpanSegment<E extends GridEvent> {
  event: E;
  /** 0-based column within the supplied `days` array. */
  startColumn: number;
  /** Number of columns to span, >= 1. */
  columnSpan: number;
  /** 0-based stacking row. Every segment in a lane is guaranteed not to overlap. */
  lane: number;
  /** The event continues before the first day shown in this row. */
  continuesLeft: boolean;
  /** The event continues after the last day shown in this row. */
  continuesRight: boolean;
}

/**
 * Pack multi-day events into non-overlapping lanes across one row of days.
 *
 * Greedy first-fit over events sorted longest-first, which is what produces the
 * stable, gap-free stacking every calendar UI uses: a week-long bar claims lane
 * 0 across the whole row, and short events fill in beneath it instead of
 * fragmenting it.
 */
export function layoutSpans<E extends GridEvent>(
  events: E[],
  days: Date[]
): SpanSegment<E>[] {
  if (days.length === 0) return [];
  const dayKeys = days.map(toDayKey);
  const firstKey = dayKeys[0];
  const lastKey = dayKeys[dayKeys.length - 1];

  const candidates = events
    .map((event) => ({ event, span: eventDaySpan(event) }))
    .filter(({ span }) => span.startKey <= lastKey && span.endKey >= firstKey)
    .sort((a, b) => {
      if (a.span.startKey !== b.span.startKey)
        return a.span.startKey < b.span.startKey ? -1 : 1;
      // Longer bars first so they take the top lane.
      const aLen = dayKeys.indexOf(a.span.endKey) - dayKeys.indexOf(a.span.startKey);
      const bLen = dayKeys.indexOf(b.span.endKey) - dayKeys.indexOf(b.span.startKey);
      if (aLen !== bLen) return bLen - aLen;
      return a.event.id < b.event.id ? -1 : 1;
    });

  // lanes[i] = the column index just past the last segment placed in lane i.
  const lanes: number[] = [];
  const segments: SpanSegment<E>[] = [];

  for (const { event, span } of candidates) {
    const rawStart = dayKeys.indexOf(span.startKey);
    const rawEnd = dayKeys.indexOf(span.endKey);
    const startColumn = rawStart === -1 ? 0 : rawStart;
    const endColumn = rawEnd === -1 ? days.length - 1 : rawEnd;

    let lane = lanes.findIndex((nextFree) => nextFree <= startColumn);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(0);
    }
    lanes[lane] = endColumn + 1;

    segments.push({
      event,
      startColumn,
      columnSpan: endColumn - startColumn + 1,
      lane,
      continuesLeft: span.startKey < firstKey,
      continuesRight: span.endKey > lastKey,
    });
  }

  return segments;
}

/* -------------------------------------------------------------------------
 * Timed events in a day column (week / day view)
 * ---------------------------------------------------------------------- */

export interface TimedBox<E extends GridEvent> {
  event: E;
  /** Minutes from local midnight, clamped into the day. */
  startMinute: number;
  /** Minutes from local midnight; always > startMinute. */
  endMinute: number;
  /** 0-based column within its overlap cluster. */
  column: number;
  /** How many columns the cluster was split into. */
  columnCount: number;
}

/** Visual floor so a zero-length or 5-minute event stays clickable. */
export const MIN_EVENT_MINUTES = 20;

/**
 * Lay out one day's timed events side by side.
 *
 * Events are grouped into clusters of transitively-overlapping events, and each
 * cluster is split into as many columns as its widest pile-up needs — so two
 * back-to-back classes stay full width while three overlapping interviews each
 * take a third. Minutes are measured from *local* midnight of the day being
 * rendered, and events crossing into or out of the day are clamped to it.
 */
export function layoutTimedDay<E extends GridEvent>(
  events: E[],
  day: Date
): TimedBox<E>[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const dayKey = toDayKey(day);

  const boxes = events
    .filter((event) => !isMultiDay(event) && occursOn(event, dayKey))
    .map((event) => {
      const start = new Date(event.starts_at);
      const end = new Date(event.ends_at);
      const startMinute = clamp(minutesBetween(dayStart, start), 0, 24 * 60 - 1);
      const rawEnd = clamp(minutesBetween(dayStart, end), 0, 24 * 60);
      return {
        event,
        startMinute,
        endMinute: Math.max(rawEnd, startMinute + MIN_EVENT_MINUTES),
      };
    })
    .sort((a, b) =>
      a.startMinute !== b.startMinute
        ? a.startMinute - b.startMinute
        : b.endMinute - a.endMinute
    );

  void dayEnd;

  const positioned: TimedBox<E>[] = [];
  let cluster: typeof boxes = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    // Greedy column assignment within the cluster.
    const columnEnds: number[] = [];
    const assigned = cluster.map((box) => {
      let column = columnEnds.findIndex((end) => end <= box.startMinute);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(0);
      }
      columnEnds[column] = box.endMinute;
      return { ...box, column };
    });
    for (const box of assigned) {
      positioned.push({ ...box, columnCount: columnEnds.length });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const box of boxes) {
    if (cluster.length > 0 && box.startMinute >= clusterEnd) flush();
    cluster.push(box);
    clusterEnd = Math.max(clusterEnd, box.endMinute);
  }
  flush();

  return positioned;
}

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/* -------------------------------------------------------------------------
 * Formatting
 * ---------------------------------------------------------------------- */

/** "2:30 PM", or "2 PM" on the hour — the compact form a chip needs. */
export function formatTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const minutes = date.getMinutes();
  return date
    .toLocaleTimeString([], {
      hour: "numeric",
      ...(minutes === 0 ? {} : { minute: "2-digit" }),
    })
    .replace(/\s/g, " ");
}

/** "Mon, Aug 4" — the agenda/day-header form. */
export function formatDayHeading(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Human range for the event panel: handles all-day and multi-day. */
export function formatEventRange(event: GridEvent): string {
  if (event.is_all_day) {
    const start = fromDayKey(event.start_date ?? toDayKey(new Date(event.starts_at)));
    const endKey = event.end_date ?? event.start_date;
    const end = endKey ? fromDayKey(endKey) : start;
    const startLabel = start.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (toDayKey(start) === toDayKey(end)) return `${startLabel} · All day`;
    return `${startLabel} → ${end.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })}`;
  }

  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  const dayLabel = formatDayHeading(start);
  if (isSameDay(start, end)) {
    return `${dayLabel} · ${formatTime(start)} – ${formatTime(end)}`;
  }
  return `${dayLabel} ${formatTime(start)} → ${formatDayHeading(end)} ${formatTime(end)}`;
}

/** Relative "in 3 days" / "tomorrow" / "2 days ago" for the upcoming rail. */
export function formatRelativeDay(target: Date, now: Date = new Date()): string {
  const days = Math.round(
    (startOfDay(target).getTime() - startOfDay(now).getTime()) / 86_400_000
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return `In ${days} days`;
  if (days < -1 && days > -7) return `${Math.abs(days)} days ago`;
  return target.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
