import Link from "next/link";
import { formatEventRange } from "@/lib/calendar/grid";
import type { CalendarEventWithContext } from "@/lib/db/types";
import { CATEGORY_STYLES } from "./colors";

/**
 * Slim banner at the top of a page's content when that page is the linked
 * note for a calendar event — the page-side half of the event↔note loop (the
 * calendar side is the event panel's "Note" field). A plain server component:
 * every value it needs (category, title, range, link) is already on the
 * fetched event, so no client interactivity is required.
 *
 * The caller is responsible for the null check — this always renders a
 * banner when given an event, so a page with no linked event simply never
 * mounts it.
 */
export default function EventNoteBanner({
  event,
}: {
  event: CalendarEventWithContext;
}) {
  const style = CATEGORY_STYLES[event.category];

  return (
    <div
      className={`mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border px-3 py-2 text-sm ${style.bar}`}
    >
      <span className="shrink-0" aria-hidden>
        {style.emoji}
      </span>
      <span className="min-w-0 truncate font-medium">
        {event.summary || "Untitled event"}
      </span>
      <span className="shrink-0 opacity-60" aria-hidden>
        ·
      </span>
      <span className="shrink-0 opacity-80">{formatEventRange(event)}</span>
      <span className="ml-auto flex shrink-0 items-center gap-3 text-xs underline-offset-2">
        <Link href="/calendar" className="hover:underline">
          View on calendar
        </Link>
        {event.html_link && (
          <a
            href={event.html_link}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Open in Google Calendar
          </a>
        )}
      </span>
    </div>
  );
}
