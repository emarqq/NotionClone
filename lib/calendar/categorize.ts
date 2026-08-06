/**
 * Guess what kind of thing a calendar event is, from its title.
 *
 * This is the feature that makes the calendar view useful rather than just a
 * second Google Calendar: events arrive already sorted into the two streams
 * this workspace cares about — coursework (class / quiz / exam / assignment)
 * and recruiting (interview / coffee chat / application / deadline) — so the
 * grid can colour them, the sidebar can rank "what's due", and filters mean
 * something.
 *
 * Deliberately keyword matching, not the LLM. It runs over every event on every
 * sync (hundreds at a time), has to be instant and offline, and a wrong guess
 * here is cheap: the user can override it in the event panel, and an override
 * sets `category_source = 'manual'` so no later sync overwrites the choice.
 *
 * Pure and dependency-free — unit-tested in tests/calendar/categorize.test.ts.
 */

import type { CalendarEventCategory } from "@/lib/db/types";

export interface CategoryInput {
  summary: string;
  description?: string | null;
  location?: string | null;
  /** An expanded instance of a recurring series (weekly classes, standups). */
  isRecurring?: boolean;
  isAllDay?: boolean;
}

/**
 * Course codes: "CS 4780", "MATH2940", "ECON 1110-01". A strong class signal on
 * its own, and the reason a bare "AEM 3200" lands as `class` and not `other`.
 */
const COURSE_CODE = /\b[A-Z]{2,4}\s?-?\s?\d{3,4}\b/;

/**
 * Ordered rules — first match wins, so the list runs most-specific first.
 * "Final Exam — CS 4780" must be an exam, not a class, even though both
 * patterns match it.
 */
const RULES: { category: CalendarEventCategory; pattern: RegExp }[] = [
  {
    category: "exam",
    pattern:
      /\b(final exam|finals?|midterm|prelim|exam|proctor(ed|ing)?|comprehensive)\b/i,
  },
  { category: "quiz", pattern: /\b(quiz(zes)?|pop quiz)\b/i },
  {
    category: "interview",
    pattern:
      /\b(interview|super ?day|first round|second round|final round|phone screen|technical screen|screening call|behavioral|case (study|interview)|hirevue|on ?site|online assessment|\boa\b)\b/i,
  },
  {
    category: "coffee_chat",
    pattern:
      /\b(coffee ?chat|coffee|networking|info(rmational)? (session|chat|call|interview)|intro (call|chat)|meet ?(&|and) ?greet|career fair|mixer|alumni chat)\b/i,
  },
  {
    category: "application",
    pattern:
      /\b(applications?|apply|app(lication)? (due|deadline|opens?|closes?)|submit(ting)? (my )?app|resume drop|referral)\b/i,
  },
  {
    category: "assignment",
    pattern:
      /\b(homework|\bhw\b|problem set|\bpset\b|assignment|lab report|essay|term paper|project (due|milestone)|submission)\b/i,
  },
  {
    category: "class",
    pattern:
      /\b(lecture|lab|seminar|recitation|discussion section|section|class|course|office hours|tutorial|workshop|studio)\b/i,
  },
  // Generic fallback, only reached when nothing above matched: "Nov 1 deadline".
  { category: "deadline", pattern: /\b(deadline|due(?: date)?|closes|cutoff)\b/i },
];

export function categorizeEvent(input: CategoryInput): CalendarEventCategory {
  // Title carries almost all the signal. Location is folded in because a room
  // number ("Statler Hall 185") reinforces a class; the description is not,
  // because a long invite body full of boilerplate produces false positives
  // (every Google Meet invite mentions "join", every newsletter says "apply").
  const haystack = `${input.summary ?? ""} ${input.location ?? ""}`.trim();
  if (!haystack) return "other";

  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }

  // No keyword hit. A weekly repeat with a course code in the title is a class
  // even when it's titled bare ("AEM 3200"); a weekly repeat without one is
  // just a standing meeting and stays `other`.
  if (COURSE_CODE.test(input.summary ?? "")) return "class";

  return "other";
}

/**
 * Whether a sync is allowed to (re)write an event's category.
 *
 * A user's manual choice is permanent — that is the whole point of storing
 * `category_source`. Without this check, every incremental sync would silently
 * reclassify the interview the user had corrected back to `other`.
 */
export function shouldAutoCategorize(
  existingSource: "auto" | "manual" | undefined
): boolean {
  return existingSource !== "manual";
}
