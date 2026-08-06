import CalendarView from "@/components/calendar/CalendarView";
import { isConfigured } from "@/lib/calendar/config";
import { getAccounts, getCalendars, getEventsInRange } from "@/lib/db/calendar";
import { getSpaces } from "@/lib/db/pages";

export const dynamic = "force-dynamic";

/**
 * How much of the mirror is server-rendered.
 *
 * Wide enough that a semester of `‹`/`›` never touches the network: back far
 * enough to look up what a past interview was, forward far enough to cover next
 * year's application deadlines. Anything outside it is fetched on demand by
 * CalendarView through /api/calendar/events.
 */
const WINDOW_PAST_DAYS = 120;
const WINDOW_FUTURE_DAYS = 400;

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (value: string | string[] | undefined): string | null =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

  const now = Date.now();
  const from = new Date(now - WINDOW_PAST_DAYS * 86_400_000).toISOString();
  const to = new Date(now + WINDOW_FUTURE_DAYS * 86_400_000).toISOString();

  const configured = isConfigured();
  const [accounts, calendars, spaces, events] = await Promise.all([
    getAccounts(),
    getCalendars(),
    getSpaces(),
    getEventsInRange(from, to),
  ]);

  return (
    <CalendarView
      configured={configured}
      accounts={accounts}
      calendars={calendars}
      spaces={spaces}
      initialEvents={events}
      loadedFrom={from}
      loadedTo={to}
      connectStatus={first(params.connect)}
      connectDetail={first(params.detail)}
    />
  );
}
