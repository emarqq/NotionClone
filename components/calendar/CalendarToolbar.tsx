"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";
import clsx from "clsx";
import { buildWeek } from "@/lib/calendar/grid";
import type { CalendarAccountPublic } from "@/lib/db/types";
import { CATEGORY_ORDER, CATEGORY_STYLES } from "./colors";
import { useCalendarStore, type CalendarViewMode } from "./store";

const VIEWS: { value: CalendarViewMode; label: string; key: string }[] = [
  { value: "month", label: "Month", key: "m" },
  { value: "week", label: "Week", key: "w" },
  { value: "day", label: "Day", key: "d" },
  { value: "agenda", label: "Agenda", key: "a" },
];

/** The period label for the `‹ ›` range currently on screen. */
function periodTitle(view: CalendarViewMode, cursor: Date): string {
  if (view === "day") {
    return cursor.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (view === "week") {
    const days = buildWeek(cursor);
    const start = days[0];
    const end = days[6];
    const sameMonth = start.getMonth() === end.getMonth();
    const startLabel = start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const endLabel = end.toLocaleDateString(undefined, {
      ...(sameMonth ? {} : { month: "short" }),
      day: "numeric",
    });
    return `${startLabel} – ${endLabel}, ${end.getFullYear()}`;
  }
  return cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** "synced 2m ago" — coarse on purpose; the exact second is never interesting. */
function sinceLabel(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 45) return "synced just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `synced ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `synced ${hours}h ago`;
  return `synced ${Math.round(hours / 24)}d ago`;
}

/** True when a keystroke is the user typing, not a shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function CategoryFilter() {
  const categoryFilter = useCalendarStore((s) => s.categoryFilter);
  const toggleCategory = useCalendarStore((s) => s.toggleCategory);
  const clearCategories = useCalendarStore((s) => s.clearCategories);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const active = categoryFilter.length;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className={clsx(
          "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
          active > 0
            ? "border-secondary/40 bg-secondary/10 text-neutral-900 dark:border-secondary/40 dark:bg-secondary/15 dark:text-neutral-100"
            : "border-neutral-200 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        )}
      >
        <ListFilter size={13} />
        {active > 0 ? `${active} filter${active > 1 ? "s" : ""}` : "All events"}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-52 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {CATEGORY_ORDER.map((category) => {
            const style = CATEGORY_STYLES[category];
            const checked = categoryFilter.includes(category);
            return (
              <label
                key={category}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCategory(category)}
                  className="size-3.5 cursor-pointer accent-primary"
                />
                <span className={clsx("size-2 shrink-0 rounded-full", style.dot)} />
                <span className="min-w-0 flex-1 truncate">{style.label}</span>
              </label>
            );
          })}
          <button
            type="button"
            onClick={clearCategories}
            disabled={active === 0}
            className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

export default function CalendarToolbar({
  accounts,
  syncing,
  onSync,
}: {
  accounts: CalendarAccountPublic[];
  syncing: boolean;
  onSync: () => void;
}) {
  const view = useCalendarStore((s) => s.view);
  const cursorIso = useCalendarStore((s) => s.cursorIso);
  const setView = useCalendarStore((s) => s.setView);
  const goToday = useCalendarStore((s) => s.goToday);
  const goPrev = useCalendarStore((s) => s.goPrev);
  const goNext = useCalendarStore((s) => s.goNext);
  const openComposer = useCalendarStore((s) => s.openComposer);
  const toggleSettings = useCalendarStore((s) => s.toggleSettings);
  const composerOpen = useCalendarStore((s) => s.composerOpen);
  const settingsOpen = useCalendarStore((s) => s.settingsOpen);

  // Null until the mount effect resolves it (see store.ts) — rendering a title
  // for a server-side "now" is exactly the hydration mismatch that was fixed.
  const cursor = cursorIso === null ? null : new Date(cursorIso);

  // Rendered only after mount, and re-rendered on a timer: "synced 2m ago" is
  // relative to *now*, which the server render can't know.
  const [synced, setSynced] = useState<string | null>(null);
  const lastSyncedAt = accounts
    .map((account) => account.last_synced_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();

  useEffect(() => {
    if (!lastSyncedAt) {
      setSynced(null);
      return;
    }
    const tick = () => setSynced(sinceLabel(lastSyncedAt));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [lastSyncedAt]);

  useEffect(() => {
    // Suspended while an overlay is up so a stray keypress can't reshuffle the
    // grid behind the modal the user is actually looking at.
    if (composerOpen || settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const matched = VIEWS.find((entry) => entry.key === key);
      if (matched) {
        event.preventDefault();
        setView(matched.value);
        return;
      }
      if (key === "t") {
        event.preventDefault();
        goToday();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [composerOpen, settingsOpen, setView, goToday, goPrev, goNext]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={goToday}
          title="Today (T)"
          className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Today
        </button>
        <button
          type="button"
          onClick={goPrev}
          title="Previous (←)"
          aria-label="Previous"
          className="rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={goNext}
          title="Next (→)"
          aria-label="Next"
          className="rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* A non-breaking space, not nothing, while the cursor is unknown: an
          empty <h1> collapses to zero height and shifts the whole toolbar the
          moment the real title lands. */}
      <h1 className="min-w-0 truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">
        {cursor === null ? "\u00A0" : periodTitle(view, cursor)}
      </h1>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="flex gap-0.5 rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700">
          {VIEWS.map(({ value, label, key }) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              title={`${label} (${key.toUpperCase()})`}
              aria-pressed={view === value}
              className={clsx(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                view === value
                  ? "bg-primary text-primary-foreground"
                  : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <CategoryFilter />

        <button
          type="button"
          onClick={onSync}
          disabled={syncing}
          title="Sync now"
          className="flex items-center gap-1.5 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          <RefreshCw size={13} className={clsx(syncing && "animate-spin")} />
          <span className="hidden sm:inline">
            {syncing ? "Syncing…" : (synced ?? "Sync now")}
          </span>
        </button>

        <button
          type="button"
          onClick={toggleSettings}
          title="Calendar settings"
          aria-label="Calendar settings"
          className="rounded-md border border-neutral-200 p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        >
          <Settings2 size={14} />
        </button>

        <button
          type="button"
          onClick={() => openComposer(null)}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus size={14} />
          New event
        </button>
      </div>
    </div>
  );
}
