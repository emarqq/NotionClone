import { describe, expect, it } from "vitest";
import {
  addDays,
  normalizeEvent,
  toGoogleEvent,
  type EventDraft,
} from "@/lib/calendar/normalize";
import { MANAGED_MARKER_KEY, MANAGED_PAGE_KEY, type GoogleEvent } from "@/lib/calendar/types";

/**
 * Covers lib/calendar/normalize.ts — the Google event resource <-> app row
 * translation. The one rule worth re-stating: Google's all-day `end.date` is
 * EXCLUSIVE, and undoing that exactly once here is what stops every class and
 * deadline from rendering one day too long. See the file header for why.
 */

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal live event: an id plus whatever start/end/etc the case needs. */
function ev(partial: Partial<GoogleEvent> & { id: string }): GoogleEvent {
  return { summary: "Untitled", ...partial };
}

function expectEvent(result: ReturnType<typeof normalizeEvent>) {
  if (result.kind !== "event") throw new Error(`expected kind "event", got "${result.kind}"`);
  return result.event;
}

describe("normalizeEvent — all-day boundaries (the marquee case)", () => {
  it("a single all-day day (start=Aug4, end=Aug5 exclusive) normalizes to start_date=end_date=Aug4", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({ id: "e1", start: { date: "2026-08-04" }, end: { date: "2026-08-05" } })
      )
    );
    expect(event.start_date).toBe("2026-08-04");
    expect(event.end_date).toBe("2026-08-04");
  });

  it("a multi-day all-day span (Aug4 -> Aug7 exclusive) normalizes end_date to Aug6 inclusive", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({ id: "e2", start: { date: "2026-08-04" }, end: { date: "2026-08-07" } })
      )
    );
    expect(event.start_date).toBe("2026-08-04");
    expect(event.end_date).toBe("2026-08-06");
  });

  it("starts_at/ends_at for an all-day event are half-open UTC midnights", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({ id: "e3", start: { date: "2026-08-04" }, end: { date: "2026-08-05" } })
      )
    );
    expect(event.starts_at).toBe("2026-08-04T00:00:00.000Z");
    // ends_at keeps Google's EXCLUSIVE end (Aug5), unlike end_date which is
    // undone to Aug4 — that's what lets a half-open BETWEEN query work.
    expect(event.ends_at).toBe("2026-08-05T00:00:00.000Z");
  });

  it("a missing end.date falls back to a one-day event", () => {
    const event = expectEvent(normalizeEvent(ev({ id: "e4", start: { date: "2026-08-04" } })));
    expect(event.start_date).toBe("2026-08-04");
    expect(event.end_date).toBe("2026-08-04");
  });

  it("an invalid (non-ISO) end.date falls back to a one-day event", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({ id: "e5", start: { date: "2026-08-04" }, end: { date: "not-a-date" } })
      )
    );
    expect(event.end_date).toBe("2026-08-04");
  });

  it("a backwards end.date (before start) falls back to a one-day event", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({ id: "e6", start: { date: "2026-08-04" }, end: { date: "2026-08-01" } })
      )
    );
    expect(event.start_date).toBe("2026-08-04");
    expect(event.end_date).toBe("2026-08-04");
  });
});

describe("normalizeEvent — timed events", () => {
  it("round-trips an ISO start/end and captures the time zone", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({
          id: "t1",
          start: { dateTime: "2026-08-04T14:30:00-04:00", timeZone: "America/New_York" },
          end: { dateTime: "2026-08-04T15:00:00-04:00", timeZone: "America/New_York" },
        })
      )
    );
    expect(event.is_all_day).toBe(false);
    expect(event.starts_at).toBe(new Date("2026-08-04T14:30:00-04:00").toISOString());
    expect(event.ends_at).toBe(new Date("2026-08-04T15:00:00-04:00").toISOString());
    expect(event.time_zone).toBe("America/New_York");
  });

  it("ends_at is never before starts_at (zero-length or backwards times keep the start instant)", () => {
    const zeroLength = expectEvent(
      normalizeEvent(
        ev({
          id: "t2",
          start: { dateTime: "2026-08-04T14:30:00Z" },
          end: { dateTime: "2026-08-04T14:30:00Z" },
        })
      )
    );
    expect(zeroLength.ends_at).toBe(zeroLength.starts_at);

    const backwards = expectEvent(
      normalizeEvent(
        ev({
          id: "t3",
          start: { dateTime: "2026-08-04T14:30:00Z" },
          end: { dateTime: "2026-08-04T14:00:00Z" },
        })
      )
    );
    expect(backwards.ends_at >= backwards.starts_at).toBe(true);
    expect(backwards.ends_at).toBe(backwards.starts_at);
  });
});

describe("normalizeEvent — cancelled and skip", () => {
  it("a cancelled item with no start/end normalizes to a cancelled tombstone", () => {
    const result = normalizeEvent(ev({ id: "c1", status: "cancelled" }));
    expect(result).toEqual({ kind: "cancelled", googleEventId: "c1" });
  });

  it("a cancelled item WITH a full body normalizes to a live event carrying status cancelled", () => {
    const result = normalizeEvent(
      ev({
        id: "c2",
        status: "cancelled",
        summary: "Cancelled interview",
        start: { dateTime: "2026-08-04T14:00:00Z" },
        end: { dateTime: "2026-08-04T15:00:00Z" },
      })
    );
    expect(result.kind).toBe("event");
    const event = expectEvent(result);
    expect(event.status).toBe("cancelled");
    expect(event.summary).toBe("Cancelled interview");
  });

  it("an item with no id is skipped", () => {
    const result = normalizeEvent({ summary: "No id" } as GoogleEvent);
    expect(result).toEqual({ kind: "skip", reason: "event has no id" });
  });

  it("a live (non-cancelled) item with no usable start/end is skipped", () => {
    const result = normalizeEvent(ev({ id: "s1" }));
    expect(result.kind).toBe("skip");
  });
});

describe("normalizeEvent — managed markers", () => {
  it("reads extendedProperties.private.notionCloneManaged=='true' as managed_by_app", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({
          id: "m1",
          start: { dateTime: "2026-08-04T14:00:00Z" },
          end: { dateTime: "2026-08-04T15:00:00Z" },
          extendedProperties: { private: { [MANAGED_MARKER_KEY]: "true" } },
        })
      )
    );
    expect(event.managed_by_app).toBe(true);
  });

  it("regression: managed_by_app is true only for the exact string 'true' — a missing key or 'false' are both false", () => {
    // priv[MANAGED_MARKER_KEY] === "true" is a strict string comparison on
    // purpose: extendedProperties values are always strings, so anything
    // sloppier (truthy-check, `!== "false"`) would flip an absent key or a
    // stray non-boolean value into "managed" and start writing back to an
    // event this app never created.
    const noMarker = expectEvent(
      normalizeEvent(
        ev({ id: "m2", start: { dateTime: "2026-08-04T14:00:00Z" }, end: { dateTime: "2026-08-04T15:00:00Z" } })
      )
    );
    expect(noMarker.managed_by_app).toBe(false);

    const falsyMarker = expectEvent(
      normalizeEvent(
        ev({
          id: "m3",
          start: { dateTime: "2026-08-04T14:00:00Z" },
          end: { dateTime: "2026-08-04T15:00:00Z" },
          extendedProperties: { private: { [MANAGED_MARKER_KEY]: "false" } },
        })
      )
    );
    expect(falsyMarker.managed_by_app).toBe(false);
  });

  it("reads extendedProperties.private.notionClonePageId as managed_page_id", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({
          id: "m4",
          start: { dateTime: "2026-08-04T14:00:00Z" },
          end: { dateTime: "2026-08-04T15:00:00Z" },
          extendedProperties: {
            private: { [MANAGED_MARKER_KEY]: "true", [MANAGED_PAGE_KEY]: "page-123" },
          },
        })
      )
    );
    expect(event.managed_page_id).toBe("page-123");
  });

  it("regression: an empty-string notionClonePageId normalizes to managed_page_id null, not \"\"", () => {
    // The read used to be `priv[MANAGED_PAGE_KEY] ?? null`. Unlinking a note
    // clears the property, and Google echoes the cleared value back as ""
    // rather than omitting the key. `??` only catches null/undefined, so ""
    // sailed through unchanged, got inserted into a `uuid` column, failed the
    // insert, and wedged that calendar's sync permanently. The fix is `||`,
    // which treats "" as falsy too — this pins that exact behaviour so it
    // can't regress back to `??`.
    const event = expectEvent(
      normalizeEvent(
        ev({
          id: "m5",
          start: { dateTime: "2026-08-04T14:00:00Z" },
          end: { dateTime: "2026-08-04T15:00:00Z" },
          extendedProperties: {
            private: { [MANAGED_MARKER_KEY]: "true", [MANAGED_PAGE_KEY]: "" },
          },
        })
      )
    );
    expect(event.managed_page_id).toBeNull();
  });

  it("a real uuid page id still comes through managed_page_id unchanged", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({
          id: "m6",
          start: { dateTime: "2026-08-04T14:00:00Z" },
          end: { dateTime: "2026-08-04T15:00:00Z" },
          extendedProperties: {
            private: {
              [MANAGED_MARKER_KEY]: "true",
              [MANAGED_PAGE_KEY]: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
            },
          },
        })
      )
    );
    expect(event.managed_page_id).toBe("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
  });
});

describe("normalizeEvent — meeting_url precedence", () => {
  it("conferenceData video entry point beats hangoutLink and location", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({
          id: "u1",
          start: { dateTime: "2026-08-04T14:00:00Z" },
          end: { dateTime: "2026-08-04T15:00:00Z" },
          hangoutLink: "https://hangout.example/legacy",
          location: "Zoom: https://zoom.example/from-location",
          conferenceData: {
            entryPoints: [{ entryPointType: "video", uri: "https://meet.example/conference" }],
          },
        })
      )
    );
    expect(event.meeting_url).toBe("https://meet.example/conference");
  });

  it("hangoutLink beats a URL found in location when there's no conferenceData", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({
          id: "u2",
          start: { dateTime: "2026-08-04T14:00:00Z" },
          end: { dateTime: "2026-08-04T15:00:00Z" },
          hangoutLink: "https://hangout.example/legacy",
          location: "Zoom: https://zoom.example/from-location",
        })
      )
    );
    expect(event.meeting_url).toBe("https://hangout.example/legacy");
  });

  it("falls back to a URL inside location when nothing else is present", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({
          id: "u3",
          start: { dateTime: "2026-08-04T14:00:00Z" },
          end: { dateTime: "2026-08-04T15:00:00Z" },
          location: "Zoom: https://zoom.example/from-location",
        })
      )
    );
    expect(event.meeting_url).toBe("https://zoom.example/from-location");
  });

  it("is null when no meeting url is present anywhere", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({
          id: "u4",
          start: { dateTime: "2026-08-04T14:00:00Z" },
          end: { dateTime: "2026-08-04T15:00:00Z" },
          location: "Statler Hall 185",
        })
      )
    );
    expect(event.meeting_url).toBeNull();
  });
});

describe("normalizeEvent — attendees", () => {
  it("drops resource:true entries (meeting rooms/equipment)", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({
          id: "a1",
          start: { dateTime: "2026-08-04T14:00:00Z" },
          end: { dateTime: "2026-08-04T15:00:00Z" },
          attendees: [
            { email: "person@example.com", displayName: "Person" },
            { email: "room-185@resource.calendar.google.com", resource: true },
          ],
        })
      )
    );
    expect(event.attendees).toHaveLength(1);
    expect(event.attendees[0].email).toBe("person@example.com");
  });

  it("returns an empty array when there are no attendees", () => {
    const event = expectEvent(
      normalizeEvent(
        ev({ id: "a2", start: { dateTime: "2026-08-04T14:00:00Z" }, end: { dateTime: "2026-08-04T15:00:00Z" } })
      )
    );
    expect(event.attendees).toEqual([]);
  });
});

describe("addDays — UTC safety", () => {
  it("crosses a month boundary backwards in UTC (2026-03-01 - 1 day = 2026-02-28)", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("does not depend on the host timezone (spans midnight the same way regardless of TZ)", () => {
    const originalTZ = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Kiritimati"; // UTC+14, about as far east as it gets
      const east = addDays("2026-08-04", 1);
      process.env.TZ = "Etc/GMT+12"; // UTC-12, about as far west as it gets
      const west = addDays("2026-08-04", 1);
      expect(east).toBe("2026-08-05");
      expect(west).toBe("2026-08-05");
    } finally {
      process.env.TZ = originalTZ;
    }
  });

  it("shifts forward across a month boundary", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });
});

describe("toGoogleEvent — outbound", () => {
  it("re-applies the exclusive end: an inclusive all-day end of 2026-08-04 becomes end.date 2026-08-05", () => {
    const draft: EventDraft = {
      summary: "One-day event",
      isAllDay: true,
      start: "2026-08-04",
      end: "2026-08-04",
    };
    const google = toGoogleEvent(draft);
    expect(google.start).toEqual({ date: "2026-08-04" });
    expect(google.end).toEqual({ date: "2026-08-05" });
  });

  it("stamps the managed markers, including the page id when supplied", () => {
    const google = toGoogleEvent({
      summary: "Managed",
      isAllDay: true,
      start: "2026-08-04",
      end: "2026-08-04",
      pageId: "page-abc",
    });
    expect(google.extendedProperties?.private).toEqual({
      [MANAGED_MARKER_KEY]: "true",
      [MANAGED_PAGE_KEY]: "page-abc",
    });
    // Explicit regression guard (paired with the "omits" case below): a real
    // pageId must produce the key present with that exact value, not "".
    expect(google.extendedProperties?.private).toHaveProperty(MANAGED_PAGE_KEY, "page-abc");
  });

  it("regression: omits the page marker key entirely when no pageId is supplied — never stamps \"\"", () => {
    // draft.pageId is spread in with a ternary (`...(draft.pageId ? {...} : {})`),
    // not defaulted to an empty string, so a pageless draft must OMIT the key
    // rather than send notionClonePageId: "". Sending "" is exactly what the
    // inbound normalize.ts bug (`|| null` vs `?? null`) had to defend against
    // on the read side — this pins the write side never produces that value
    // in the first place.
    const google = toGoogleEvent({
      summary: "Managed, no page",
      isAllDay: true,
      start: "2026-08-04",
      end: "2026-08-04",
    });
    expect(google.extendedProperties?.private).toEqual({ [MANAGED_MARKER_KEY]: "true" });
    expect(google.extendedProperties?.private).not.toHaveProperty(MANAGED_PAGE_KEY);
  });

  it("round-trips an all-day draft through normalizeEvent unchanged", () => {
    const draft: EventDraft = {
      summary: "Round trip all-day",
      isAllDay: true,
      start: "2026-08-04",
      end: "2026-08-06",
    };
    const google = toGoogleEvent(draft);
    const normalized = expectEvent(normalizeEvent({ id: "rt1", ...google }));
    expect(normalized.start_date).toBe(draft.start);
    expect(normalized.end_date).toBe(draft.end);
  });

  it("round-trips a timed draft through normalizeEvent unchanged", () => {
    const draft: EventDraft = {
      summary: "Round trip timed",
      isAllDay: false,
      start: "2026-08-04T14:00:00.000Z",
      end: "2026-08-04T15:00:00.000Z",
    };
    const google = toGoogleEvent(draft);
    const normalized = expectEvent(normalizeEvent({ id: "rt2", ...google }));
    expect(normalized.starts_at).toBe(draft.start);
    expect(normalized.ends_at).toBe(draft.end);
  });
});
