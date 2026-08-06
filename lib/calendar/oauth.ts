import "server-only";

import crypto from "node:crypto";
import {
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
  googleClientId,
  googleClientSecret,
} from "./config";
import { googleFetch } from "./googleFetch";
import type { GoogleTokenResponse } from "./types";

/**
 * The OAuth 2.0 authorization-code flow against Google, hand-rolled.
 *
 * It is ~60 lines of form-encoded POSTs, so `google-auth-library` would be a
 * dependency carried for no leverage — and hand-rolling keeps the refresh-token
 * lifecycle (the part that actually bites, see below) visible instead of hidden
 * inside a client object's implicit state.
 *
 * The flow used here is the *web server* one, not the loopback/installed-app
 * one: this app runs a real HTTP server and registers exact redirect URIs.
 * Google exempts localhost URIs from its HTTPS-only redirect rule, so plain
 * http://localhost:3000 and http://127.0.0.1:3777 are both legal.
 * https://developers.google.com/identity/protocols/oauth2/web-server
 */

export interface PendingAuth {
  url: string;
  /** Echoed back by Google; must match the value stashed in a cookie. */
  state: string;
  /** PKCE verifier; must be replayed at code exchange. */
  codeVerifier: string;
}

/**
 * Build the consent URL plus the two secrets the callback has to check.
 *
 * `access_type=offline` is what makes Google issue a refresh token at all, and
 * `prompt=consent` forces it to issue a NEW one every time. Without the latter,
 * a second connect for an account that already granted access returns an access
 * token and no refresh token, and the integration silently dies an hour later.
 */
export function buildAuthUrl(redirectUri: string): PendingAuth {
  const state = crypto.randomBytes(24).toString("base64url");
  const codeVerifier = crypto.randomBytes(48).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return { url: `${GOOGLE_AUTH_ENDPOINT}?${params}`, state, codeVerifier };
}

/** Trade the one-time `code` from the callback for tokens. */
export async function exchangeCode(
  code: string,
  redirectUri: string,
  codeVerifier: string
): Promise<GoogleTokenResponse> {
  return googleFetch<GoogleTokenResponse>(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    }).toString(),
  });
}

/**
 * Exchange a refresh token for a fresh access token.
 *
 * Throws a GoogleApiError with `isInvalidGrant` when the refresh token is dead.
 * Expect that regularly, not rarely: while the Cloud Console OAuth consent
 * screen is in "Testing" publishing status, Google expires every refresh token
 * it issued after 7 days. A personal single-user app stays in Testing, because
 * leaving it means submitting the app for sensitive-scope verification. So
 * "reconnect about once a week" is the designed-for steady state, and callers
 * must surface it as a one-click reconnect rather than a hard error.
 * https://developers.google.com/identity/protocols/oauth2/web-server
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<GoogleTokenResponse> {
  return googleFetch<GoogleTokenResponse>(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      grant_type: "refresh_token",
    }).toString(),
  });
}

/** Best-effort revoke on disconnect. Failure is ignored by callers: the local
 *  tokens are deleted either way, and a stale grant is harmless. */
export async function revokeToken(token: string): Promise<void> {
  await googleFetch<void>(GOOGLE_REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
}

/**
 * Pull the account email out of the `id_token` returned alongside the tokens.
 *
 * Signature verification is deliberately skipped: this JWT did not come from
 * the browser, it came straight back from Google's token endpoint over TLS in
 * the response to our own authenticated request, which is the case Google's own
 * documentation calls out as not requiring validation. The value is only ever
 * used as a display label and a uniqueness key for the account row.
 */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { email?: string };
    return decoded.email ?? null;
  } catch {
    return null;
  }
}
