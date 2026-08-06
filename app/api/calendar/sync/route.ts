import "server-only";

import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { autoSyncIntervalSeconds, isConfigured } from "@/lib/calendar/config";
import { summarizeSync, syncAllAccounts } from "@/lib/calendar/sync";
import { getAccounts } from "@/lib/db/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pull changes from Google.
 *
 * This is the app's only freshness mechanism: `events.watch` push notifications
 * need a public HTTPS endpoint with a CA-signed certificate, and this server is
 * bound to localhost on purpose. Polling costs nothing that matters — Google
 * allows ~600 requests/minute/user and an incremental sync of a personal
 * calendar is one request that usually returns an empty page.
 *
 * Called three ways: on the calendar page mounting, on an interval while it is
 * open, and by the "Sync now" button. The first two pass no `force`, so the
 * `last_synced_at` throttle collapses a burst of tab switches into one call.
 */
export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "unconfigured" },
      { status: 501 }
    );
  }

  let force = false;
  try {
    const body = (await request.json()) as { force?: boolean } | null;
    force = body?.force === true;
  } catch {
    // No body is fine — that's the throttled auto-sync.
  }

  try {
    const accounts = await getAccounts();
    if (accounts.length === 0) {
      return NextResponse.json({ ok: true, connected: false, skipped: true });
    }

    if (!force) {
      const cutoff = Date.now() - autoSyncIntervalSeconds() * 1000;
      const active = accounts.filter((account) => account.status !== "disconnected");
      const allFresh =
        active.length > 0 &&
        active.every(
          (account) =>
            account.last_synced_at &&
            new Date(account.last_synced_at).getTime() > cutoff
        );
      if (allFresh) {
        return NextResponse.json({ ok: true, connected: true, skipped: true });
      }
    }

    const results = await syncAllAccounts();
    const summary = summarizeSync(results);

    // The sidebar's upcoming counts and the calendar grid are server-rendered.
    revalidatePath("/calendar");
    revalidatePath("/home");

    return NextResponse.json({
      ok: summary.errors.length === 0,
      connected: true,
      skipped: false,
      ...summary,
    });
  } catch (err) {
    console.error("[calendar/sync] failed:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Calendar sync failed.",
      },
      { status: 500 }
    );
  }
}
