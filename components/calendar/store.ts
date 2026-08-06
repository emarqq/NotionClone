"use client";

import { create } from "zustand";
import { addDays, addMonths } from "@/lib/calendar/grid";
import { CATEGORY_LABELS } from "@/lib/calendar/normalize";
import type { CalendarEventCategory } from "@/lib/db/types";

export type CalendarViewMode = "month" | "week" | "day" | "agenda";

/** What the composer should pre-fill its time fields from, if anything. */
export interface ComposerSeed {
  /** A local "YYYY-MM-DD" — clicked an empty day cell in the month grid. */
  dayKey?: string;
  /** An ISO instant — clicked an empty slot in the week/day grid. */
  instant?: string;
}

const VIEW_KEY = "calendar:view";
const CATEGORIES_KEY = "calendar:categories";

const VIEW_MODES: CalendarViewMode[] = ["month", "week", "day", "agenda"];

/**
 * Client-side twin of `isWritable` in lib/db/calendar.ts.
 *
 * That module is `server-only`, but the composer, the settings panel and the
 * event side-peek all need the same "can I write here?" test, so the one-line
 * predicate is restated for the browser rather than dragging a Supabase client
 * into the bundle. Keep the two in step.
 */
export function isWritableRole(accessRole: string | null): boolean {
  return accessRole === "owner" || accessRole === "writer";
}

interface CalendarState {
  view: CalendarViewMode;
  /**
   * The anchor date, held as an ISO instant rather than a Date so the store
   * stays serialisable (and so nothing can mutate the anchor in place — Date
   * setters would leave subscribers looking at an unchanged reference).
   *
   * `null` until `hydrateCalendarPrefs()` runs on mount. A `new Date()` default
   * would be evaluated *once per Node process*, when this module is first
   * imported — and the desktop shell leaves `next start -p 3777` up for days, so
   * the server would render whatever month it booted in while the browser
   * re-evaluates the module and gets the real now. That is a guaranteed React
   * hydration mismatch, and the same reason MonthGrid/WeekGrid/AgendaList hold
   * "today" back until mounted. Consumers must render a placeholder while null.
   */
  cursorIso: string | null;
  selectedEventId: string | null;
  composerOpen: boolean;
  composerSeed: ComposerSeed | null;
  settingsOpen: boolean;
  /** Empty means "show everything" — not "show nothing". */
  categoryFilter: CalendarEventCategory[];

  setView: (view: CalendarViewMode) => void;
  setCursor: (date: Date) => void;
  goToday: () => void;
  goPrev: () => void;
  goNext: () => void;
  selectEvent: (id: string | null) => void;
  openComposer: (seed?: ComposerSeed | null) => void;
  closeComposer: () => void;
  toggleSettings: () => void;
  toggleCategory: (category: CalendarEventCategory) => void;
  clearCategories: () => void;
}

/** Persistence is best-effort: a private-mode failure must not break the view. */
function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore — the in-memory state is still correct for this session.
  }
}

/** How far one `‹`/`›` press moves, per view. Agenda reads as a month list. */
function step(view: CalendarViewMode, cursor: Date, direction: 1 | -1): Date {
  switch (view) {
    case "week":
      return addDays(cursor, 7 * direction);
    case "day":
      return addDays(cursor, direction);
    default:
      return addMonths(cursor, direction);
  }
}

export const useCalendarStore = create<CalendarState>()((set, get) => ({
  view: "month",
  cursorIso: null,
  selectedEventId: null,
  composerOpen: false,
  composerSeed: null,
  settingsOpen: false,
  categoryFilter: [],

  setView: (view) => {
    write(VIEW_KEY, view);
    set({ view });
  },
  setCursor: (date) => set({ cursorIso: date.toISOString() }),
  goToday: () => set({ cursorIso: new Date().toISOString() }),
  // The `?? Date.now()` arms are unreachable in practice — nothing can press
  // `‹`/`›` before the mount effect has set the cursor — but they keep these
  // total rather than making every caller prove it.
  goPrev: () => {
    const { view, cursorIso } = get();
    const from = new Date(cursorIso ?? Date.now());
    set({ cursorIso: step(view, from, -1).toISOString() });
  },
  goNext: () => {
    const { view, cursorIso } = get();
    const from = new Date(cursorIso ?? Date.now());
    set({ cursorIso: step(view, from, 1).toISOString() });
  },

  selectEvent: (id) => set({ selectedEventId: id }),
  // Opening the composer closes the side-peek: they occupy the same screen and
  // "Edit" from the panel would otherwise leave both stacked.
  openComposer: (seed = null) =>
    set({ composerOpen: true, composerSeed: seed ?? null, selectedEventId: null }),
  closeComposer: () => set({ composerOpen: false, composerSeed: null }),
  toggleSettings: () => set((s) => ({ settingsOpen: !s.settingsOpen })),

  toggleCategory: (category) => {
    const next = get().categoryFilter.includes(category)
      ? get().categoryFilter.filter((c) => c !== category)
      : [...get().categoryFilter, category];
    write(CATEGORIES_KEY, JSON.stringify(next));
    set({ categoryFilter: next });
  },
  clearCategories: () => {
    write(CATEGORIES_KEY, "[]");
    set({ categoryFilter: [] });
  },
}));

let hydrated = false;

/**
 * Resolve `cursorIso` and pull `view` / `categoryFilter` out of localStorage,
 * once, on the client.
 *
 * Same shape as CollapsibleSection's persistence: the server and the first
 * client render both use the defaults, and the stored preference is applied
 * from a mount effect — reading localStorage during the initial render would
 * be a guaranteed hydration mismatch. `cursorIso` rides along for the same
 * reason: "now" is browser-only, so it can't be part of the initial state.
 */
export function hydrateCalendarPrefs(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;

  const patch: Partial<
    Pick<CalendarState, "view" | "categoryFilter" | "cursorIso">
  > = { cursorIso: new Date().toISOString() };
  try {
    const view = window.localStorage.getItem(VIEW_KEY);
    if (view && (VIEW_MODES as string[]).includes(view)) {
      patch.view = view as CalendarViewMode;
    }
    const raw = window.localStorage.getItem(CATEGORIES_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        patch.categoryFilter = parsed.filter(
          (value): value is CalendarEventCategory =>
            typeof value === "string" && value in CATEGORY_LABELS
        );
      }
    }
  } catch {
    // Unreadable or corrupt storage — the defaults are a fine outcome.
  }

  useCalendarStore.setState(patch);
}
