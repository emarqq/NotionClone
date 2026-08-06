"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronDown,
  ExternalLink,
  FileText,
  MapPin,
  Pencil,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import clsx from "clsx";
import { formatEventRange } from "@/lib/calendar/grid";
import {
  createEventNoteAction,
  deleteCalendarEventAction,
  linkEventNoteAction,
  setEventCategoryAction,
} from "@/app/actions/calendar";
import type {
  CalendarEventCategory,
  CalendarEventWithContext,
  Space,
} from "@/lib/db/types";
import { CATEGORY_ORDER, CATEGORY_STYLES } from "./colors";
import { isWritableRole, useCalendarStore } from "./store";

const RESPONSE_LABEL: Record<string, string> = {
  accepted: "Going",
  declined: "Declined",
  tentative: "Maybe",
  needsAction: "No reply",
};

/**
 * Google descriptions are HTML (invitations from Zoom, Handshake and every
 * recruiting tool arrive as markup). We render plain text rather than
 * `dangerouslySetInnerHTML` — a calendar invite is untrusted input, and no part
 * of this panel is worth an injection surface.
 */
function toPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function CategoryChip({ event }: { event: CalendarEventWithContext }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<CalendarEventCategory>(event.category);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setCategory(event.category), [event.category, event.id]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const style = CATEGORY_STYLES[category];

  const pick = (next: CalendarEventCategory) => {
    setOpen(false);
    setCategory(next);
    startTransition(async () => {
      try {
        await setEventCategoryAction(event.id, next);
        router.refresh();
      } catch {
        setCategory(event.category);
      }
    });
  };

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={pending}
        className={clsx(
          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-60",
          style.chip
        )}
      >
        <span aria-hidden>{style.emoji}</span>
        {style.label}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute left-0 z-10 mt-1 w-48 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            Overrides the auto guess
          </p>
          {CATEGORY_ORDER.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => pick(option)}
              className={clsx(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800",
                option === category
                  ? "font-medium text-neutral-900 dark:text-neutral-100"
                  : "text-neutral-600 dark:text-neutral-300"
              )}
            >
              <span
                className={clsx("size-2 rounded-full", CATEGORY_STYLES[option].dot)}
                aria-hidden
              />
              {CATEGORY_STYLES[option].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NoteSection({
  event,
  spaces,
}: {
  event: CalendarEventWithContext;
  spaces: Space[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");

  if (event.page_id) {
    return (
      <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
        <Link
          href={`/${event.note_space_slug}/${event.page_id}`}
          className="flex items-center gap-2 text-sm text-neutral-800 hover:underline dark:text-neutral-100"
        >
          <FileText size={14} className="shrink-0 text-neutral-400" />
          <span className="min-w-0 flex-1 truncate">
            {event.note_title || "Untitled note"}
          </span>
        </Link>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                await linkEventNoteAction(event.id, null);
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not unlink.");
              }
            })
          }
          className="mt-2 text-[11px] text-neutral-500 hover:underline disabled:opacity-50 dark:text-neutral-400"
        >
          Unlink note
        </button>
        {error && (
          <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }

  const create = () => {
    const space = spaces.find((s) => s.id === spaceId);
    if (!space) {
      setError("Pick a space for the note.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const page = await createEventNoteAction(event.id, space.id, space.slug);
        router.push(`/${space.slug}/${page.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create the note.");
      }
    });
  };

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        No note yet. Start one pre-filled with the time, place and who&apos;s
        coming.
      </p>
      {spaces.length > 1 && (
        <select
          value={spaceId}
          onChange={(e) => setSpaceId(e.target.value)}
          aria-label="Space for the new note"
          className="mt-2 w-full rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-xs text-neutral-800 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
        >
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={create}
        disabled={pending || spaces.length === 0}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        <FileText size={13} />
        {pending ? "Creating…" : "Create note"}
      </button>
      {error && (
        <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

export default function EventPanel({
  event,
  spaces,
  onEdit,
}: {
  event: CalendarEventWithContext;
  spaces: Space[];
  /** Hands the event back up so the composer can be mounted in edit mode. */
  onEdit: () => void;
}) {
  const router = useRouter();
  const selectEvent = useCalendarStore((s) => s.selectEvent);
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => selectEvent(null);
  const editable = isWritableRole(event.calendar_access_role);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectEvent(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectEvent]);

  const description = event.description ? toPlainText(event.description) : "";
  const guests = event.attendees.filter((attendee) => !attendee.self);

  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[380px] max-w-full flex-col border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      <header className="flex items-start justify-between gap-2 px-4 pb-2 pt-3">
        <CategoryChip event={event} />
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <X size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        <div>
          <h2 className="text-base font-semibold leading-snug text-neutral-900 dark:text-neutral-100">
            {event.summary || "Untitled"}
          </h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {formatEventRange(event)}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            <span
              className="size-2 shrink-0 rounded-sm border border-black/10 dark:border-white/15"
              style={{ backgroundColor: event.calendar_color ?? "#9ca3af" }}
              aria-hidden
            />
            <span className="min-w-0 truncate">{event.calendar_summary}</span>
          </p>
        </div>

        {event.status === "cancelled" && (
          <p className="rounded-md bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            This event was cancelled in Google Calendar.
          </p>
        )}

        {event.meeting_url && (
          <a
            href={event.meeting_url}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            <Video size={13} />
            Join
          </a>
        )}

        {event.location && (
          <p className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300">
            <MapPin size={13} className="mt-0.5 shrink-0 text-neutral-400" />
            <span className="min-w-0 break-words">{event.location}</span>
          </p>
        )}

        <NoteSection event={event} spaces={spaces} />

        {guests.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              <Users size={12} />
              {guests.length} guest{guests.length > 1 ? "s" : ""}
            </p>
            <ul className="space-y-1">
              {guests.map((attendee, index) => (
                <li
                  key={attendee.email ?? `${attendee.displayName}-${index}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200">
                    {attendee.displayName || attendee.email || "Unknown"}
                  </span>
                  <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">
                    {RESPONSE_LABEL[attendee.responseStatus ?? ""] ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {description && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              Description
            </p>
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
              {description}
            </p>
          </div>
        )}

        {error && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-neutral-200 px-4 py-2.5 dark:border-neutral-800">
        {event.html_link && (
          <a
            href={event.html_link}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-[11px] text-neutral-500 hover:underline dark:text-neutral-400"
          >
            <ExternalLink size={12} />
            Open in Google Calendar
          </a>
        )}

        {editable && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={onEdit}
              title="Edit"
              aria-label="Edit"
              className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <Pencil size={14} />
            </button>
            {confirmingDelete ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        await deleteCalendarEventAction(event.id);
                        selectEvent(null);
                        router.refresh();
                      } catch (err) {
                        setConfirmingDelete(false);
                        setError(
                          err instanceof Error ? err.message : "Could not delete."
                        );
                      }
                    })
                  }
                  className="rounded border border-red-300 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/50"
                >
                  Delete for real
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                title="Delete"
                aria-label="Delete"
                className="rounded p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950/50 dark:hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </footer>
    </aside>
  );
}
