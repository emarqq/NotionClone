import { describe, expect, it } from "vitest";
import { categorizeEvent, shouldAutoCategorize } from "@/lib/calendar/categorize";
import type { CalendarEventCategory } from "@/lib/db/types";

/**
 * Covers lib/calendar/categorize.ts — the keyword classifier that sorts every
 * synced event into a coursework or recruiting bucket. Table-driven against
 * the real-world titles this feature exists for, per the file's own docstring
 * ("what's due", filters, colouring).
 */

describe("categorizeEvent — real-world titles", () => {
  const cases: Array<[string, CalendarEventCategory]> = [
    ["CS 4780 Lecture", "class"],
    ["Prelim 2 — MATH 2940", "exam"],
    ["Quiz 3", "quiz"],
    ["PSet 4 due", "assignment"],
    ["Coffee chat with Sarah (Jane Street)", "coffee_chat"],
    ["Superday — Morgan Stanley", "interview"],
    ["Phone screen", "interview"],
    ["Goldman application deadline", "application"],
    ["Rent due", "deadline"],
    ["AEM 3200", "class"], // bare course code, no keyword hit
    ["Lunch", "other"],
  ];

  it.each(cases)('categorizes "%s" as %s', (summary, expected) => {
    expect(categorizeEvent({ summary })).toBe(expected);
  });
});

describe("categorizeEvent — rule precedence", () => {
  it("takes the earlier rule when a title matches two: exam beats class", () => {
    // "Final Exam CS 4780" contains both an exam keyword and a course code;
    // the exam rule runs first in RULES, so it must win outright.
    expect(categorizeEvent({ summary: "Final Exam CS 4780" })).toBe("exam");
  });

  it("takes exam over quiz when a title says both (exam listed first)", () => {
    expect(categorizeEvent({ summary: "Midterm and quiz review" })).toBe("exam");
  });

  it("takes interview over coffee_chat for a title that could read as either", () => {
    expect(categorizeEvent({ summary: "Interview / coffee chat with the team" })).toBe(
      "interview"
    );
  });
});

describe("categorizeEvent — case insensitivity", () => {
  it("matches keywords regardless of case", () => {
    expect(categorizeEvent({ summary: "LECTURE HALL A" })).toBe("class");
    expect(categorizeEvent({ summary: "sUpErDaY at Citadel" })).toBe("interview");
  });
});

describe("categorizeEvent — location and description weighting", () => {
  it("folds location into the match (a room number reinforces class)", () => {
    expect(categorizeEvent({ summary: "AEM 3200", location: "Statler Hall 185" })).toBe(
      "class"
    );
  });

  it("ignores description entirely — a boilerplate invite body must not cause a false positive", () => {
    expect(
      categorizeEvent({
        summary: "Team sync",
        description: "Join the meeting and apply the agenda before the deadline.",
      })
    ).toBe("other");
  });
});

describe("categorizeEvent — empty input", () => {
  it("returns 'other' for a blank summary and no location", () => {
    expect(categorizeEvent({ summary: "" })).toBe("other");
  });
});

describe("shouldAutoCategorize", () => {
  it("is false once a user has manually chosen a category", () => {
    expect(shouldAutoCategorize("manual")).toBe(false);
  });

  it("is true for an auto-sourced category", () => {
    expect(shouldAutoCategorize("auto")).toBe(true);
  });

  it("is true when there is no existing source (never categorized yet)", () => {
    expect(shouldAutoCategorize(undefined)).toBe(true);
  });
});
