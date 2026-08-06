import { describe, expect, it } from "vitest";
import {
  MIN_EVENT_MINUTES,
  addDays,
  addMonths,
  buildMonthMatrix,
  eventDaySpan,
  layoutSpans,
  layoutTimedDay,
  toDayKey,
  type GridEvent,
} from "@/lib/calendar/grid";

/**
 * Covers lib/calendar/grid.ts — the pure geometry that turns events into
 * positioned boxes for the month/week grids. Everything here works in LOCAL
 * time on purpose (see the file header), so dates are built with the `Date`
 * constructor's (y, m, d, h, min) form throughout rather than ISO string
 * literals, to stay correct regardless of the machine's timezone.
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** An all-day GridEvent from inclusive "YYYY-MM-DD" bounds. */
function allDayEvent(id: string, startDate: string, endDate: string): GridEvent {
  return {
    id,
    is_all_day: true,
    starts_at: `${startDate}T00:00:00.000Z`,
    ends_at: `${endDate}T00:00:00.000Z`,
    start_date: startDate,
    end_date: endDate,
  };
}

/** A consecutive run of local days as Date objects, starting at (2026, 7, startDay). */
function days(startDay: number, count: number): Date[] {
  const first = new Date(2026, 7, startDay);
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

/**
 * A timed GridEvent anchored on August 4, 2026, local time.
 * `start`/`end` are [hour, minute] on the 4th, or [hour, minute, dayOffset]
 * to land on a different day (e.g. [0, 0, 1] = midnight on the 5th).
 */
function timedEvent(
  id: string,
  start: [number, number] | [number, number, number],
  end: [number, number] | [number, number, number]
): GridEvent {
  const [sh, sm, sOffset = 0] = start;
  const [eh, em, eOffset = 0] = end;
  return {
    id,
    is_all_day: false,
    starts_at: new Date(2026, 7, 4 + sOffset, sh, sm).toISOString(),
    ends_at: new Date(2026, 7, 4 + eOffset, eh, em).toISOString(),
    start_date: null,
    end_date: null,
  };
}

function segFor<E extends GridEvent>(segments: ReturnType<typeof layoutSpans<E>>, id: string) {
  const found = segments.find((s) => s.event.id === id);
  if (!found) throw new Error(`no segment for ${id}`);
  return found;
}

// ---------------------------------------------------------------------------
// layoutSpans
// ---------------------------------------------------------------------------

describe("layoutSpans", () => {
  it("packs two overlapping multi-day events into lanes 0 and 1, and a later non-overlapping one reuses lane 0", () => {
    const week = days(2, 7); // Aug 2 .. Aug 8
    const a = allDayEvent("a", "2026-08-02", "2026-08-04");
    const b = allDayEvent("b", "2026-08-03", "2026-08-05"); // overlaps a
    const c = allDayEvent("c", "2026-08-06", "2026-08-06"); // starts after both end

    const segments = layoutSpans([a, b, c], week);

    expect(segFor(segments, "a")).toMatchObject({ lane: 0, startColumn: 0, columnSpan: 3 });
    expect(segFor(segments, "b")).toMatchObject({ lane: 1, startColumn: 1, columnSpan: 3 });
    // c doesn't overlap a's [0,2] or b's [1,3] range, so the greedy packer
    // gives it back lane 0 instead of opening a third lane.
    expect(segFor(segments, "c")).toMatchObject({ lane: 0, startColumn: 4, columnSpan: 1 });
  });

  it("marks continuesLeft/continuesRight for an event crossing both row edges, and clamps its column span to the row", () => {
    const row = days(3, 3); // Aug 3 .. Aug 5
    const spanning = allDayEvent("spanning", "2026-08-01", "2026-08-10");

    const [segment] = layoutSpans([spanning], row);

    expect(segment.continuesLeft).toBe(true);
    expect(segment.continuesRight).toBe(true);
    expect(segment.startColumn).toBe(0);
    expect(segment.columnSpan).toBe(3); // the full 3-day row, not the true 10-day length
  });

  it("does not mark continuesLeft/continuesRight for an event that starts and ends inside the row", () => {
    const week = days(2, 7);
    const inside = allDayEvent("inside", "2026-08-03", "2026-08-04");
    const [segment] = layoutSpans([inside], week);
    expect(segment.continuesLeft).toBe(false);
    expect(segment.continuesRight).toBe(false);
  });

  it("returns nothing for an empty days array", () => {
    expect(layoutSpans([allDayEvent("a", "2026-08-02", "2026-08-04")], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// layoutTimedDay
// ---------------------------------------------------------------------------

describe("layoutTimedDay", () => {
  const day = new Date(2026, 7, 4); // August 4, 2026, local

  it("gives two overlapping events columnCount 2, in columns 0 and 1", () => {
    const a = timedEvent("a", [9, 0], [10, 0]);
    const b = timedEvent("b", [9, 30], [10, 30]);
    const boxes = layoutTimedDay([a, b], day);
    const byId = Object.fromEntries(boxes.map((box) => [box.event.id, box]));
    expect(byId.a.columnCount).toBe(2);
    expect(byId.b.columnCount).toBe(2);
    expect(byId.a.column).toBe(0);
    expect(byId.b.column).toBe(1);
  });

  it("gives three mutually overlapping events columnCount 3", () => {
    const a = timedEvent("a", [9, 0], [10, 30]);
    const b = timedEvent("b", [9, 15], [10, 15]);
    const c = timedEvent("c", [9, 30], [10, 0]);
    const boxes = layoutTimedDay([a, b, c], day);
    expect(boxes.every((box) => box.columnCount === 3)).toBe(true);
  });

  it("gives back-to-back non-overlapping events columnCount 1 each", () => {
    const a = timedEvent("a", [9, 0], [10, 0]);
    const b = timedEvent("b", [10, 0], [11, 0]); // starts exactly when a ends
    const boxes = layoutTimedDay([a, b], day);
    const byId = Object.fromEntries(boxes.map((box) => [box.event.id, box]));
    expect(byId.a.columnCount).toBe(1);
    expect(byId.b.columnCount).toBe(1);
  });

  it("floors a zero-length event to MIN_EVENT_MINUTES", () => {
    const zero = timedEvent("z", [9, 0], [9, 0]);
    const [box] = layoutTimedDay([zero], day);
    expect(box.endMinute - box.startMinute).toBe(MIN_EVENT_MINUTES);
  });

  it("clamps an event ending exactly at the following midnight to the day's own 1440-minute ceiling", () => {
    // Ends at exactly 00:00 the next day: eventDaySpan folds this back to a
    // single-day event on Aug 4 (see the eventDaySpan test below), so it's
    // laid out here rather than excluded as multi-day — and its minute range
    // must not spill past this day's own ceiling.
    const spilling = timedEvent("s", [23, 0], [0, 0, 1]);
    const [box] = layoutTimedDay([spilling], day);
    expect(box.startMinute).toBe(23 * 60);
    expect(box.endMinute).toBe(24 * 60);
  });

  it("excludes an event that spans two full days (it's drawn as a spanning bar, not a timed box)", () => {
    const twoDay = timedEvent("t", [23, 0], [1, 0, 1]); // 11pm -> 1am, not exactly midnight
    expect(layoutTimedDay([twoDay], day)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// eventDaySpan
// ---------------------------------------------------------------------------

describe("eventDaySpan", () => {
  it("does not paint the following day for a timed event that ends exactly at local midnight", () => {
    const event = timedEvent("e", [22, 0], [0, 0, 1]); // 10pm Aug 4 -> midnight Aug 5
    const span = eventDaySpan(event);
    expect(span).toEqual({ startKey: "2026-08-04", endKey: "2026-08-04" });
  });

  it("does paint the following day when the end is even one minute past midnight", () => {
    const event = timedEvent("e", [22, 0], [0, 1, 1]);
    const span = eventDaySpan(event);
    expect(span).toEqual({ startKey: "2026-08-04", endKey: "2026-08-05" });
  });
});

// ---------------------------------------------------------------------------
// buildMonthMatrix
// ---------------------------------------------------------------------------

describe("buildMonthMatrix", () => {
  it("always returns 6 weeks of 7 days", () => {
    const matrix = buildMonthMatrix(new Date(2026, 7, 15));
    expect(matrix.weeks).toHaveLength(6);
    for (const week of matrix.weeks) expect(week).toHaveLength(7);
  });

  it("starts each week on the configured weekday", () => {
    const sundayStart = buildMonthMatrix(new Date(2026, 7, 15), 0);
    expect(sundayStart.gridStart.getDay()).toBe(0);
    for (const week of sundayStart.weeks) expect(week[0].getDay()).toBe(0);

    const mondayStart = buildMonthMatrix(new Date(2026, 7, 15), 1);
    expect(mondayStart.gridStart.getDay()).toBe(1);
    for (const week of mondayStart.weeks) expect(week[0].getDay()).toBe(1);
  });

  it("keeps the same 6x7 shape for a month starting on the grid's first weekday (no short weeks)", () => {
    // February 2026 starts on a Sunday, exercising the edge where the grid
    // could otherwise be tempted to draw only 5 weeks.
    const matrix = buildMonthMatrix(new Date(2026, 1, 10), 0);
    expect(matrix.weeks).toHaveLength(6);
    expect(matrix.monthStart).toEqual(new Date(2026, 1, 1));
  });
});

// ---------------------------------------------------------------------------
// addDays / addMonths
// ---------------------------------------------------------------------------

describe("addDays / addMonths — no drift", () => {
  it("addMonths(Jan 31, 1) lands in February, not rolling into March", () => {
    const result = addMonths(new Date(2026, 0, 31), 1);
    expect(result.getMonth()).toBe(1); // February
    expect(result.getDate()).toBe(1);
  });

  it("addDays relies on Date's own day-part normalization, not millisecond math", () => {
    // Feb 2026 has 28 days (not a leap year); Feb 27 + 2 must land on Mar 1,
    // not "Feb 29" silently miscounted by a fixed 24h-per-day assumption.
    const result = addDays(new Date(2026, 1, 27), 2);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(2); // March
    expect(result.getDate()).toBe(1);
  });

  it("addDays with a negative count crosses a month boundary backwards", () => {
    const result = addDays(new Date(2026, 2, 1), -1);
    expect(toDayKey(result)).toBe("2026-02-28");
  });
});
