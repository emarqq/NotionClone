import type { CalendarEventCategory } from "@/lib/db/types";

/**
 * Per-category palette for the calendar surfaces.
 *
 * Plain literal Tailwind class strings, never composed at runtime — Tailwind v4
 * scans source text, so `bg-${hue}-100` would compile to nothing. That is also
 * why each variant repeats its `dark:` pair instead of relying on a token.
 *
 * Hues are grouped so a glance at a busy month reads as two families: school
 * work in cool tones (blue/amber/red/violet) and recruiting in warm and green
 * ones (emerald/orange/cyan/rose). Backgrounds stay at the 100/500-20% end of
 * the ramp because this sits beside a text editor — a saturated chip next to
 * body copy is exhausting to read past.
 */
export interface CategoryStyle {
  label: string;
  emoji: string;
  /** Filled pill: background + text. */
  chip: string;
  /** Small colour dot background. */
  dot: string;
  /** Text colour on a neutral background. */
  text: string;
  /** Spanning bar in the month grid / all-day strip: background + text + border. */
  bar: string;
}

export const CATEGORY_STYLES: Record<CalendarEventCategory, CategoryStyle> = {
  class: {
    label: "Class",
    emoji: "📘",
    chip: "bg-blue-100 text-blue-900 dark:bg-blue-500/20 dark:text-blue-100",
    dot: "bg-blue-500 dark:bg-blue-400",
    text: "text-blue-700 dark:text-blue-300",
    bar: "bg-blue-100 text-blue-900 border-blue-200 dark:bg-blue-500/20 dark:text-blue-100 dark:border-blue-400/25",
  },
  quiz: {
    label: "Quiz",
    emoji: "❓",
    chip: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100",
    dot: "bg-amber-500 dark:bg-amber-400",
    text: "text-amber-700 dark:text-amber-300",
    bar: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-500/20 dark:text-amber-100 dark:border-amber-400/25",
  },
  exam: {
    label: "Exam",
    emoji: "📝",
    chip: "bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-100",
    dot: "bg-red-500 dark:bg-red-400",
    text: "text-red-700 dark:text-red-300",
    bar: "bg-red-100 text-red-900 border-red-200 dark:bg-red-500/20 dark:text-red-100 dark:border-red-400/25",
  },
  assignment: {
    label: "Assignment",
    emoji: "📄",
    chip: "bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-100",
    dot: "bg-violet-500 dark:bg-violet-400",
    text: "text-violet-700 dark:text-violet-300",
    bar: "bg-violet-100 text-violet-900 border-violet-200 dark:bg-violet-500/20 dark:text-violet-100 dark:border-violet-400/25",
  },
  interview: {
    label: "Interview",
    emoji: "💼",
    chip: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    text: "text-emerald-700 dark:text-emerald-300",
    bar: "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-100 dark:border-emerald-400/25",
  },
  coffee_chat: {
    label: "Coffee chat",
    emoji: "☕",
    chip: "bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-100",
    dot: "bg-orange-500 dark:bg-orange-400",
    text: "text-orange-700 dark:text-orange-300",
    bar: "bg-orange-100 text-orange-900 border-orange-200 dark:bg-orange-500/20 dark:text-orange-100 dark:border-orange-400/25",
  },
  application: {
    label: "Application",
    emoji: "📮",
    chip: "bg-cyan-100 text-cyan-900 dark:bg-cyan-500/20 dark:text-cyan-100",
    dot: "bg-cyan-500 dark:bg-cyan-400",
    text: "text-cyan-700 dark:text-cyan-300",
    bar: "bg-cyan-100 text-cyan-900 border-cyan-200 dark:bg-cyan-500/20 dark:text-cyan-100 dark:border-cyan-400/25",
  },
  deadline: {
    label: "Deadline",
    emoji: "⏰",
    chip: "bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-100",
    dot: "bg-rose-500 dark:bg-rose-400",
    text: "text-rose-700 dark:text-rose-300",
    bar: "bg-rose-100 text-rose-900 border-rose-200 dark:bg-rose-500/20 dark:text-rose-100 dark:border-rose-400/25",
  },
  other: {
    label: "Other",
    emoji: "📌",
    chip: "bg-neutral-200 text-neutral-800 dark:bg-neutral-700/50 dark:text-neutral-100",
    dot: "bg-neutral-500 dark:bg-neutral-400",
    text: "text-neutral-700 dark:text-neutral-300",
    bar: "bg-neutral-200 text-neutral-800 border-neutral-300 dark:bg-neutral-700/50 dark:text-neutral-100 dark:border-neutral-500/30",
  },
};

/** Display order for pickers and legends — school first, then recruiting. */
export const CATEGORY_ORDER: CalendarEventCategory[] = [
  "class",
  "quiz",
  "exam",
  "assignment",
  "interview",
  "coffee_chat",
  "application",
  "deadline",
  "other",
];
