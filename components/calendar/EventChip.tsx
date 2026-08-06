"use client";

import type { CSSProperties, ReactElement } from "react";
import clsx from "clsx";
import type { CalendarEventWithContext } from "@/lib/db/types";
import { formatTime } from "@/lib/calendar/grid";
import { CATEGORY_STYLES } from "./colors";

/**
 * The one visual representation of an event, in three shapes:
 *
 *  - `bar`   — a spanning pill for the month grid and the week view's all-day strip.
 *  - `timed` — an absolutely-positioned box in the week grid; the *caller* owns
 *              the geometry (lib/calendar/grid.ts computed it) and passes it in
 *              `style`, so this component never does layout math.
 *  - `list`  — a full-width agenda row.
 *
 * Keeping all three here is what guarantees a cancelled event looks cancelled
 * everywhere and that category colour can never drift between views.
 */

/**
 * Below this, a week-grid box is too short for two lines of text.
 *
 * Decided from the event's *duration* rather than its rendered height because a
 * chip can't measure itself without a layout pass, and a flicker between the
 * one- and two-line form on every scroll is worse than an occasional
 * misjudgement. At HOUR_HEIGHT = 48 this is ~36px of box.
 */
const SHORT_EVENT_MINUTES = 45;

export default function EventChip({
  event,
  variant,
  onSelect,
  continuesLeft = false,
  continuesRight = false,
  className,
  style,
}: {
  event: CalendarEventWithContext;
  variant: "bar" | "timed" | "list";
  onSelect: (event: CalendarEventWithContext) => void;
  continuesLeft?: boolean;
  continuesRight?: boolean;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  const category = CATEGORY_STYLES[event.category] ?? CATEGORY_STYLES.other;
  const cancelled = event.status === "cancelled";
  const summary = event.summary || "(no title)";

  // The chip almost always sits inside a click-to-create surface (a month cell,
  // a week column). Without this, opening an event would also open the composer.
  const handleClick = (clickEvent: React.MouseEvent) => {
    clickEvent.stopPropagation();
    onSelect(event);
  };

  if (variant === "bar") {
    return (
      <button
        type="button"
        title={summary}
        onClick={handleClick}
        style={style}
        className={clsx(
          "flex w-full min-w-0 items-center gap-1 border px-1.5 text-[11px] leading-[16px] font-medium",
          category.bar,
          // Only the ends that actually terminate get rounded; a bar continuing
          // into the next week must read as cut off, not as its own event.
          continuesLeft ? "rounded-l-none border-l-0" : "rounded-l-[3px]",
          continuesRight ? "rounded-r-none border-r-0" : "rounded-r-[3px]",
          cancelled && "line-through opacity-60",
          className
        )}
      >
        {continuesLeft ? (
          <span aria-hidden className="shrink-0 opacity-70">
            ‹
          </span>
        ) : (
          <span
            aria-hidden
            className={clsx("size-1.5 shrink-0 rounded-full", category.dot)}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
        {continuesRight && (
          <span aria-hidden className="shrink-0 opacity-70">
            ›
          </span>
        )}
      </button>
    );
  }

  if (variant === "timed") {
    const durationMinutes =
      (new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime()) /
      60_000;
    const oneLine = durationMinutes < SHORT_EVENT_MINUTES;

    return (
      <button
        type="button"
        title={summary}
        onClick={handleClick}
        // Geometry from the caller (top/height/left/width). Applied verbatim —
        // the 2px gutter between side-by-side events comes from the padding
        // below, so the column math in layoutTimedDay stays exact.
        style={style}
        className={clsx("absolute z-10 overflow-hidden p-px text-left", className)}
      >
        <div
          className={clsx(
            "flex h-full w-full flex-col overflow-hidden rounded-md border border-black/5 px-1.5 py-px text-[11px] leading-[14px] dark:border-white/10",
            category.chip,
            cancelled && "line-through opacity-60"
          )}
        >
          {oneLine ? (
            <div className="flex min-w-0 items-baseline gap-1">
              <span className="shrink-0 tabular-nums opacity-70">
                {formatTime(event.starts_at)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">
                {summary}
              </span>
            </div>
          ) : (
            <>
              <span className="truncate tabular-nums opacity-70">
                {formatTime(event.starts_at)}
              </span>
              <span className="truncate font-medium">{summary}</span>
            </>
          )}
        </div>
      </button>
    );
  }

  // variant === "list"
  return (
    <button
      type="button"
      title={summary}
      onClick={handleClick}
      style={style}
      className={clsx(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800/70",
        className
      )}
    >
      {/* Fixed width so every row's summary starts on the same x, which is what
          makes a long agenda scannable. */}
      <span className="w-[4.75rem] shrink-0 text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
        {event.is_all_day ? "All day" : formatTime(event.starts_at)}
      </span>
      <span
        aria-hidden
        className={clsx("size-2 shrink-0 rounded-full", category.dot)}
      />
      <span
        className={clsx(
          "min-w-0 flex-1 truncate text-neutral-900 dark:text-neutral-100",
          cancelled && "line-through opacity-60"
        )}
      >
        {summary}
      </span>
      {event.location && (
        <span className="hidden min-w-0 max-w-40 shrink truncate text-xs text-neutral-500 sm:block dark:text-neutral-400">
          {event.location}
        </span>
      )}
      {event.page_id && (
        <span
          aria-label="Has a linked note"
          title="Has a linked note"
          className="shrink-0 text-xs"
        >
          📎
        </span>
      )}
      <span className="hidden max-w-32 shrink-0 truncate text-xs text-neutral-400 md:block dark:text-neutral-500">
        {event.calendar_summary}
      </span>
    </button>
  );
}
