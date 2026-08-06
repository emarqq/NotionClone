"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createPage, setPageIcon } from "@/lib/db/pages";
import { replacePageBlocks, type BlockInput } from "@/lib/db/blocks";
import {
  deleteAccount,
  getAccountInternal,
  getEvent,
  linkEventToPage,
  setCalendarSelected,
  setEventCategory,
  setWriteTarget,
} from "@/lib/db/calendar";
import { revokeToken } from "@/lib/calendar/oauth";
import {
  createEvent,
  deleteEvent,
  tagEventWithPage,
  updateEvent,
  type CreateEventInput,
  type UpdateEventInput,
} from "@/lib/calendar/writeback";
import { formatEventRange } from "@/lib/calendar/grid";
import { firstPosition, positionAfter } from "@/lib/positions";
import { ingestPage } from "@/lib/rag/ingest";
import type {
  BlockType,
  CalendarEventCategory,
  CalendarEventWithContext,
  Json,
  Page,
} from "@/lib/db/types";

/* -------------------------------------------------------------------------
 * Account & calendar management
 * ---------------------------------------------------------------------- */

/**
 * Forget a Google account.
 *
 * The local rows go by cascade (calendars → mirrored events), and the grant is
 * revoked at Google so the app disappears from the user's Google account
 * permissions page rather than lingering there. A failed revoke is logged and
 * ignored: the tokens are being deleted either way, and a dangling grant with
 * no token is inert.
 */
export async function disconnectAccountAction(accountId: string): Promise<void> {
  const account = await getAccountInternal(accountId);
  if (account?.refresh_token) {
    try {
      await revokeToken(account.refresh_token);
    } catch (err) {
      console.error(`disconnectAccountAction: revoke failed for ${accountId}:`, err);
    }
  }
  await deleteAccount(accountId);
  revalidatePath("/calendar");
  revalidatePath("/", "layout");
}

export async function toggleCalendarAction(
  calendarId: string,
  selected: boolean
): Promise<void> {
  await setCalendarSelected(calendarId, selected);
  revalidatePath("/calendar");
}

export async function setWriteTargetAction(calendarId: string): Promise<void> {
  await setWriteTarget(calendarId);
  revalidatePath("/calendar");
}

/* -------------------------------------------------------------------------
 * Events
 * ---------------------------------------------------------------------- */

export async function createCalendarEventAction(
  input: CreateEventInput
): Promise<string> {
  const id = await createEvent(input);
  revalidatePath("/calendar");
  return id;
}

export async function updateCalendarEventAction(
  eventId: string,
  input: UpdateEventInput
): Promise<void> {
  await updateEvent(eventId, input);
  revalidatePath("/calendar");
}

export async function deleteCalendarEventAction(eventId: string): Promise<void> {
  await deleteEvent(eventId);
  revalidatePath("/calendar");
}

/** Override the keyword guess. Sticky — no later sync will change it back. */
export async function setEventCategoryAction(
  eventId: string,
  category: CalendarEventCategory
): Promise<void> {
  await setEventCategory(eventId, category);
  revalidatePath("/calendar");
}

/* -------------------------------------------------------------------------
 * Event ↔ note linking
 * ---------------------------------------------------------------------- */

const CATEGORY_ICONS: Record<CalendarEventCategory, string> = {
  class: "🎓",
  quiz: "📝",
  exam: "📕",
  assignment: "📄",
  interview: "💼",
  coffee_chat: "☕",
  application: "🗂️",
  deadline: "⏰",
  other: "🗓️",
};

/*
 * Template node builders — the same contract as app/actions/meetings.ts: each
 * returns one top-level ProseMirror node whose attrs.blockId matches the block
 * row id, exactly as the editor's blockSync.ts would have persisted it.
 */

function heading2(blockId: string, text: string): Json {
  return { type: "heading", attrs: { level: 2, blockId }, content: [{ type: "text", text }] };
}

function paragraph(blockId: string, text?: string): Json {
  const node: { [key: string]: Json } = { type: "paragraph", attrs: { blockId } };
  if (text) node.content = [{ type: "text", text }];
  return node;
}

/** An inner paragraph for a list item. Empty text nodes are invalid in
 *  ProseMirror, so a blank item simply has no text child. */
function itemParagraph(text: string): Json {
  return text
    ? { type: "paragraph", content: [{ type: "text", text }] }
    : { type: "paragraph" };
}

function bulletList(blockId: string, items: string[]): Json {
  return {
    type: "bulletList",
    attrs: { blockId },
    content: (items.length > 0 ? items : [""]).map(
      (text): Json => ({ type: "listItem", content: [itemParagraph(text)] })
    ),
  };
}

function taskList(blockId: string, items: string[]): Json {
  return {
    type: "taskList",
    attrs: { blockId },
    content: (items.length > 0 ? items : [""]).map(
      (text): Json => ({
        type: "taskItem",
        attrs: { checked: false },
        content: [itemParagraph(text)],
      })
    ),
  };
}

/**
 * The note skeleton for an event, chosen by category.
 *
 * Three shapes, because the three things this calendar actually holds want
 * different notes: a recruiting conversation wants people and questions, a
 * class wants topics and action items, and everything else wants the plain
 * meeting-note structure.
 */
function templateFor(
  category: CalendarEventCategory
): { heading: string; kind: "bullets" | "tasks"; items: string[] }[] {
  if (category === "interview" || category === "coffee_chat") {
    return [
      { heading: "Who", kind: "bullets", items: [] },
      { heading: "Questions to ask", kind: "bullets", items: [] },
      { heading: "Notes", kind: "bullets", items: [] },
      { heading: "Follow-ups", kind: "tasks", items: ["Send a thank-you note"] },
    ];
  }
  if (category === "class" || category === "quiz" || category === "exam" || category === "assignment") {
    return [
      { heading: "Topics", kind: "bullets", items: [] },
      { heading: "Notes", kind: "bullets", items: [] },
      { heading: "To do", kind: "tasks", items: [] },
    ];
  }
  return [
    { heading: "Agenda", kind: "bullets", items: [] },
    { heading: "Notes", kind: "bullets", items: [] },
    { heading: "Follow-ups", kind: "tasks", items: [] },
  ];
}

/**
 * Create the note page for a calendar event and link the two.
 *
 * This is the feature that makes the calendar part of the workspace rather than
 * a read-only widget: an interview on Thursday gets a prep page in one click,
 * pre-filled with when, where and who, and the link survives in both directions
 * (`calendar_events.page_id` locally, plus an `extendedProperties.private` stamp
 * on the Google event so a wipe-and-resync can restore it).
 */
export async function createEventNoteAction(
  eventId: string,
  spaceId: string,
  spaceSlug: string
): Promise<Page> {
  const event = await getEvent(eventId);
  if (!event) throw new Error(`createEventNoteAction: no calendar event ${eventId}`);

  const created = await createPage({
    spaceId,
    parentPageId: null,
    title: event.summary || "Untitled event",
  });
  const page = await setPageIcon(created.id, CATEGORY_ICONS[event.category]);

  const blocks: BlockInput[] = [];
  let prev: string | null = null;
  const push = (type: BlockType, make: (blockId: string) => Json) => {
    const id = crypto.randomUUID();
    const position = prev === null ? firstPosition() : positionAfter(prev);
    prev = position;
    blocks.push({ id, type, content: make(id), position });
  };

  push("heading", (id) => heading2(id, "Details"));
  push("paragraph", (id) => paragraph(id, formatEventRange(event)));
  if (event.location) {
    push("paragraph", (id) => paragraph(id, `Location: ${event.location}`));
  }
  if (event.meeting_url) {
    push("paragraph", (id) => paragraph(id, `Join: ${event.meeting_url}`));
  }

  const guests = event.attendees
    .filter((attendee) => !attendee.self)
    .map((attendee) => attendee.displayName || attendee.email || "")
    .filter(Boolean);
  if (guests.length > 0) {
    push("heading", (id) => heading2(id, "Attendees"));
    push("bullet_list", (id) => bulletList(id, guests));
  }

  for (const section of templateFor(event.category)) {
    push("heading", (id) => heading2(id, section.heading));
    if (section.kind === "tasks") {
      push("checklist_item", (id) => taskList(id, section.items));
    } else {
      push("bullet_list", (id) => bulletList(id, section.items));
    }
  }

  await replacePageBlocks(page.id, blocks);
  await linkEventToPage(eventId, page.id);

  // Both are post-write side effects that must not hold up the navigation the
  // caller is about to perform: seeded blocks bypass the editor's autosave (so
  // RAG never sees them otherwise), and the Google stamp is best-effort.
  after(async () => {
    await ingestPage(page.id).catch((err) =>
      console.error(`createEventNoteAction re-ingest failed for page ${page.id}:`, err)
    );
    await tagEventWithPage(eventId, page.id);
  });

  revalidatePath("/", "layout");
  revalidatePath("/calendar");
  revalidatePath(`/${spaceSlug}`);
  return page;
}

/** Attach an existing page to an event instead of creating a new one. */
export async function linkEventNoteAction(
  eventId: string,
  pageId: string | null
): Promise<void> {
  await linkEventToPage(eventId, pageId);
  after(() => tagEventWithPage(eventId, pageId));
  revalidatePath("/calendar");
}

/** The event a page is the note for — powers the banner on the page itself. */
export async function getEventForPageAction(
  pageId: string
): Promise<CalendarEventWithContext | null> {
  const { getEventForPage } = await import("@/lib/db/calendar");
  return getEventForPage(pageId);
}
