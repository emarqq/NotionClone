import "server-only";

import { NextResponse } from "next/server";
import { getEventsInRange } from "@/lib/db/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Events overlapping [from, to).
 *
 * The /calendar page server-renders a generous window around today, which
 * covers a semester of navigation without a round trip. This exists for the
 * cases that fall outside it — jumping to next year to check when applications
 * open — so the grid can fetch on demand instead of the server shipping every
 * event that has ever been synced on first paint.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return NextResponse.json(
      { error: "`from` and `to` must both be ISO timestamps." },
      { status: 400 }
    );
  }
  if (Date.parse(to) <= Date.parse(from)) {
    return NextResponse.json({ error: "`to` must be after `from`." }, { status: 400 });
  }
  // A year and a half is well past any legitimate view; beyond it this is a
  // request to serialise the whole table.
  if (Date.parse(to) - Date.parse(from) > 550 * 86_400_000) {
    return NextResponse.json(
      { error: "Requested range is too large (max ~18 months)." },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json({ events: await getEventsInRange(from, to) });
  } catch (err) {
    console.error("[calendar/events] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load events." },
      { status: 500 }
    );
  }
}
