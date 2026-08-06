import "server-only";

import { NextResponse } from "next/server";
import { isConfigured, redirectUriFor } from "@/lib/calendar/config";
import { emailFromIdToken, exchangeCode } from "@/lib/calendar/oauth";
import { upsertAccount } from "@/lib/db/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google's redirect back after consent.
 *
 * Ends by bouncing to /calendar with a status in the query string rather than
 * rendering anything: the connect flow is initiated from that page and should
 * return the user to exactly where they were. The initial sync is deliberately
 * NOT run here — the page fires it as a normal `Sync now` on arrival, so the
 * user watches a progress state instead of a stalled blank tab, and a sync
 * failure can't make a successful connection look broken.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (status: string, detail?: string) => {
    const target = new URL("/calendar", url.origin);
    target.searchParams.set("connect", status);
    if (detail) target.searchParams.set("detail", detail.slice(0, 200));
    const response = NextResponse.redirect(target);
    // The path MUST be repeated. `cookies.delete(name)` expires it at Path=/,
    // but these were set at Path=/api/calendar/auth, and browsers key cookies
    // on name+domain+path — so the bare form is a silent no-op and the one-time
    // PKCE verifier would linger, replayable, for its full 10-minute lifetime.
    for (const name of ["gcal_oauth_state", "gcal_oauth_verifier"]) {
      response.cookies.delete({ name, path: "/api/calendar/auth" });
    }
    return response;
  };

  if (!isConfigured()) return back("unconfigured");

  const error = url.searchParams.get("error");
  if (error) {
    // The user clicked Cancel, or the consent screen refused (most often
    // because this Google account isn't on the OAuth client's test-user list).
    return back("denied", error);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((part) => part.startsWith("gcal_oauth_state="))
    ?.slice("gcal_oauth_state=".length);
  const verifier = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((part) => part.startsWith("gcal_oauth_verifier="))
    ?.slice("gcal_oauth_verifier=".length);

  if (!code) return back("error", "Google did not return an authorization code.");
  if (!state || !expectedState || state !== expectedState) {
    // Either a forged callback or a stale tab from a flow started >10 min ago.
    return back("error", "Sign-in state did not match. Please try connecting again.");
  }
  if (!verifier) {
    return back("error", "Sign-in expired. Please try connecting again.");
  }

  try {
    const redirectUri = redirectUriFor(request.url);
    const tokens = await exchangeCode(code, redirectUri, verifier);
    const email = emailFromIdToken(tokens.id_token);
    if (!email) {
      return back(
        "error",
        "Google did not return an account email. Make sure the userinfo.email scope is enabled on the OAuth client."
      );
    }

    await upsertAccount({
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: new Date(
        Date.now() + (tokens.expires_in ?? 3600) * 1000
      ).toISOString(),
      scope: tokens.scope ?? null,
    });

    return back("connected", email);
  } catch (err) {
    console.error("[calendar/auth/callback] failed:", err);
    return back(
      "error",
      err instanceof Error ? err.message : "Could not complete Google sign-in."
    );
  }
}
