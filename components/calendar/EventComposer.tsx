"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { addDays, fromDayKey, toDayKey } from "@/lib/calendar/grid";
import {
  createCalendarEventAction,
  setEventCategoryAction,
  updateCalendarEventAction,
} from "@/app/actions/calendar";
import type {
  CalendarEventCategory,
  CalendarEventWithContext,
  CalendarRow,
} from "@/lib/db/types";
import { CATEGORY_ORDER, CATEGORY_STYLES } from "./colors";
import { isWritableRole, useCalendarStore, type ComposerSeed } from "./store";

/** "HH:MM" for an `<input type="time">`. */
function toTimeValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

interface FormState {
  summary: string;
  isAllDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
  category: CalendarEventCategory;
  calendarId: string;
}

/**
 * Build the initial form.
 *
 * Three sources, in priority order: the event being edited, the seed the grid
 * handed us (a clicked day cell or time slot), and finally the toolbar's plain
 * "New event", which lands on the day currently in view at 9am.
 */
function initialState(
  event: CalendarEventWithContext | undefined,
  seed: ComposerSeed | null,
  cursor: Date,
  defaultCalendarId: string
): FormState {
  if (event?.is_all_day) {
    // An all-day row's starts_at/ends_at are the UTC midnights bracketing the
    // day, not real local times (see the migration's column comment) — reading
    // a clock off them gives 20:00 the *previous* day in America/New_York. The
    // time fields are hidden while "All day" is ticked, so a derived time is
    // invisible until the user unticks it and silently saves the wrong day.
    // Dates come from start_date/end_date (local day strings, end inclusive);
    // the times get a plain 9–10 default that is at least never wrong.
    const startKey = event.start_date ?? event.starts_at.slice(0, 10);
    return {
      summary: event.summary,
      isAllDay: true,
      startDate: startKey,
      startTime: "09:00",
      endDate: event.end_date ?? startKey,
      endTime: "10:00",
      location: event.location ?? "",
      description: event.description ?? "",
      category: event.category,
      calendarId: event.calendar_id,
    };
  }

  if (event) {
    const start = new Date(event.starts_at);
    const end = new Date(event.ends_at);
    return {
      summary: event.summary,
      isAllDay: false,
      startDate: toDayKey(start),
      startTime: toTimeValue(start),
      endDate: toDayKey(end),
      endTime: toTimeValue(end),
      location: event.location ?? "",
      description: event.description ?? "",
      category: event.category,
      calendarId: event.calendar_id,
    };
  }

  let start: Date;
  if (seed?.instant) {
    start = new Date(seed.instant);
  } else if (seed?.dayKey) {
    const day = fromDayKey(seed.dayKey);
    start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
  } else {
    start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 9, 0);
  }
  const end = new Date(start.getTime() + 60 * 60_000);

  return {
    summary: "",
    isAllDay: false,
    startDate: toDayKey(start),
    startTime: toTimeValue(start),
    // A 23:00 start rolls into tomorrow — take the end's own day, not the start's.
    endDate: toDayKey(end),
    endTime: toTimeValue(end),
    location: "",
    description: "",
    category: "other",
    calendarId: defaultCalendarId,
  };
}

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm text-neutral-900 outline-none focus:border-secondary dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100";
const LABEL_CLASS =
  "mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400";

export default function EventComposer({
  event,
  calendars,
}: {
  event?: CalendarEventWithContext;
  calendars: CalendarRow[];
}) {
  const router = useRouter();
  const closeComposer = useCalendarStore((s) => s.closeComposer);
  const composerSeed = useCalendarStore((s) => s.composerSeed);
  const cursorIso = useCalendarStore((s) => s.cursorIso);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(event);
  const writable = useMemo(
    () => calendars.filter((calendar) => isWritableRole(calendar.access_role)),
    [calendars]
  );
  const defaultCalendarId =
    writable.find((calendar) => calendar.is_write_target)?.id ??
    writable[0]?.id ??
    "";

  // Seeded once: re-deriving on every render would fight the user's typing, and
  // the composer is remounted (keyed by the store) whenever the seed changes.
  const [form, setForm] = useState<FormState>(() =>
    // `cursorIso` is null only before the calendar's mount effect runs, which is
    // strictly before anything can open the composer — the fallback is belt.
    initialState(
      event,
      composerSeed,
      new Date(cursorIso ?? Date.now()),
      defaultCalendarId
    )
  );
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") closeComposer();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeComposer]);

  const submit = (formEvent: React.FormEvent) => {
    formEvent.preventDefault();
    setError(null);

    const summary = form.summary.trim();
    if (!summary) {
      setError("Give the event a title.");
      return;
    }
    if (!form.startDate || !form.endDate) {
      setError("Pick a start and end date.");
      return;
    }

    let start: string;
    let end: string;
    if (form.isAllDay) {
      if (form.endDate < form.startDate) {
        setError("The end date can't be before the start date.");
        return;
      }
      // Inclusive both ways — the backend re-applies Google's exclusive end.
      start = form.startDate;
      end = form.endDate;
    } else {
      if (!form.startTime || !form.endTime) {
        setError("Pick a start and end time.");
        return;
      }
      const startAt = new Date(`${form.startDate}T${form.startTime}`);
      const endAt = new Date(`${form.endDate}T${form.endTime}`);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        setError("That date or time isn't valid.");
        return;
      }
      if (endAt <= startAt) {
        setError("The event has to end after it starts.");
        return;
      }
      start = startAt.toISOString();
      end = endAt.toISOString();
    }

    if (!isEdit && !form.calendarId) {
      setError("Pick a calendar to create this event on.");
      return;
    }

    startTransition(async () => {
      try {
        if (event) {
          await updateCalendarEventAction(event.id, {
            summary,
            description: form.description.trim() || null,
            location: form.location.trim() || null,
            isAllDay: form.isAllDay,
            start,
            end,
          });
          // UpdateEventInput carries no category — it's a local-only column, so
          // a category change on edit goes through its own action.
          if (form.category !== event.category) {
            await setEventCategoryAction(event.id, form.category);
          }
        } else {
          await createCalendarEventAction({
            summary,
            description: form.description.trim() || null,
            location: form.location.trim() || null,
            isAllDay: form.isAllDay,
            start,
            end,
            calendarId: form.calendarId,
            category: form.category,
          });
        }
        closeComposer();
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Google rejected that change."
        );
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4"
      onClick={() => closeComposer()}
    >
      <form
        onSubmit={submit}
        onClick={(clickEvent) => clickEvent.stopPropagation()}
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            {isEdit ? "Edit event" : "New event"}
          </p>
          <button
            type="button"
            onClick={() => closeComposer()}
            aria-label="Close"
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="space-y-3">
          <div>
            <label htmlFor="composer-title" className={LABEL_CLASS}>
              Title
            </label>
            <input
              id="composer-title"
              autoFocus
              value={form.summary}
              onChange={(e) => set("summary", e.target.value)}
              placeholder="Interview with…"
              className={FIELD_CLASS}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
            <input
              type="checkbox"
              checked={form.isAllDay}
              onChange={(e) => {
                const isAllDay = e.target.checked;
                setForm((prev) => ({
                  ...prev,
                  isAllDay,
                  // A timed event ending at midnight has an end date one day on;
                  // as an all-day event that would read as a spurious two-day
                  // block, so collapse it back onto the start day.
                  endDate:
                    isAllDay && prev.endDate > prev.startDate && prev.endTime === "00:00"
                      ? toDayKey(addDays(fromDayKey(prev.endDate), -1))
                      : prev.endDate,
                }));
              }}
              className="size-3.5 cursor-pointer accent-primary"
            />
            All day
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="composer-start-date" className={LABEL_CLASS}>
                Starts
              </label>
              <input
                id="composer-start-date"
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                className={FIELD_CLASS}
              />
            </div>
            {!form.isAllDay && (
              <div>
                <label htmlFor="composer-start-time" className={LABEL_CLASS}>
                  At
                </label>
                <input
                  id="composer-start-time"
                  type="time"
                  value={form.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>
            )}
            <div>
              <label htmlFor="composer-end-date" className={LABEL_CLASS}>
                Ends
              </label>
              <input
                id="composer-end-date"
                type="date"
                value={form.endDate}
                onChange={(e) => set("endDate", e.target.value)}
                className={FIELD_CLASS}
              />
            </div>
            {!form.isAllDay && (
              <div>
                <label htmlFor="composer-end-time" className={LABEL_CLASS}>
                  At
                </label>
                <input
                  id="composer-end-time"
                  type="time"
                  value={form.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                  className={FIELD_CLASS}
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="composer-location" className={LABEL_CLASS}>
              Location
            </label>
            <input
              id="composer-location"
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="Room, address, or a link"
              className={FIELD_CLASS}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="composer-category" className={LABEL_CLASS}>
                Category
              </label>
              <select
                id="composer-category"
                value={form.category}
                onChange={(e) =>
                  set("category", e.target.value as CalendarEventCategory)
                }
                className={FIELD_CLASS}
              >
                {CATEGORY_ORDER.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_STYLES[category].emoji}{" "}
                    {CATEGORY_STYLES[category].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="composer-calendar" className={LABEL_CLASS}>
                Calendar
              </label>
              <select
                id="composer-calendar"
                value={form.calendarId}
                disabled={isEdit}
                onChange={(e) => set("calendarId", e.target.value)}
                className={`${FIELD_CLASS} disabled:opacity-60`}
              >
                {isEdit && event ? (
                  <option value={event.calendar_id}>
                    {event.calendar_summary}
                  </option>
                ) : (
                  writable.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.summary}
                    </option>
                  ))
                )}
              </select>
              {isEdit && (
                <p className="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">
                  Moving an event between calendars isn&apos;t supported.
                </p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="composer-description" className={LABEL_CLASS}>
              Description
            </label>
            <textarea
              id="composer-description"
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              className={`${FIELD_CLASS} resize-y`}
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => closeComposer()}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create event"}
          </button>
        </div>
      </form>
    </div>
  );
}
