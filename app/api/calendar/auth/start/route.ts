import "server-only";

import { NextResponse } from "next/server";
import { isConfigured, redirectUriFor } from "@/lib/calendar/config";
import { buildAuthUrl } from "@/lib/calendar/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kick off the Google consent flow.
 *
 * The CSRF `state` and the PKCE `code_verifier` are handed to the browser as
 * short-lived httpOnly cookies rather than kept server-side, because the
 * callback arrives as a fresh top-level navigation with no other continuity.
 * `sameSite: "lax"` is required and sufficient: Google returns the user via a
 * top-level GET, which lax permits, while still blocking the cross-site POSTs
 * the flag exists to stop.
 */
export async function GET(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      {
        error:
          "Google Calendar is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local — see docs/GOOGLE-CALENDAR.md.",
      },
      { status: 501 }
    );
  }

  try {
    const redirectUri = redirectUriFor(request.url);
    const pending = buildAuthUrl(redirectUri);

    const response = NextResponse.redirect(pending.url);
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/api/calendar/auth",
      maxAge: 600,
      // No `secure`: the app is served over plain http on localhost by design,
      // and a secure cookie would simply never be sent back.
      secure: false,
    };
    response.cookies.set("gcal_oauth_state", pending.state, cookieOptions);
    response.cookies.set("gcal_oauth_verifier", pending.codeVerifier, cookieOptions);
    return response;
  } catch (err) {
    console.error("[calendar/auth/start] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start Google sign-in." },
      { status: 500 }
    );
  }
}
