import "server-only";

import {
  getAccountInternal,
  markAccountNeedsReauth,
  updateAccessToken,
} from "@/lib/db/calendar";
import { refreshAccessToken } from "./oauth";
import { GoogleApiError } from "./types";
import type { CalendarAccount } from "@/lib/db/types";

/**
 * Access-token lifecycle: the single door every Google call goes through.
 *
 * Google access tokens last an hour. Rather than refreshing reactively on a 401
 * (which would mean every caller handling retry), this refreshes proactively
 * whenever the stored token is inside a one-minute expiry margin, so callers
 * only ever see a token that is good right now.
 */

/** Refresh this far before the real expiry, to cover clock skew and flight time. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Raised when an account can only be fixed by the user reconnecting.
 *
 * Callers must treat this as an expected state, not a crash. While the Cloud
 * Console consent screen is in "Testing" — where a personal, unverified app
 * stays — Google expires issued refresh tokens after 7 days, so this fires
 * about weekly by design. The UI answers it with a "Reconnect" banner.
 */
export class NeedsReauthError extends Error {
  readonly accountId: string;
  readonly accountEmail: string;

  constructor(account: Pick<CalendarAccount, "id" | "account_email">, reason: string) {
    super(
      `Google Calendar account ${account.account_email} needs to be reconnected: ${reason}`
    );
    this.name = "NeedsReauthError";
    this.accountId = account.id;
    this.accountEmail = account.account_email;
  }
}

export async function getAccessToken(accountId: string): Promise<string> {
  const account = await getAccountInternal(accountId);
  if (!account) throw new Error(`No calendar account ${accountId}`);
  return getAccessTokenForAccount(account);
}

export async function getAccessTokenForAccount(
  account: CalendarAccount
): Promise<string> {
  if (account.status === "disconnected") {
    throw new NeedsReauthError(account, "the account was disconnected");
  }

  const expiresAt = account.token_expires_at
    ? new Date(account.token_expires_at).getTime()
    : 0;
  const stillValid =
    account.access_token && expiresAt - EXPIRY_MARGIN_MS > Date.now();
  if (stillValid) return account.access_token as string;

  if (!account.refresh_token) {
    await markAccountNeedsReauth(account.id, "no refresh token stored");
    throw new NeedsReauthError(account, "no refresh token stored");
  }

  try {
    const tokens = await refreshAccessToken(account.refresh_token);
    const newExpiry = new Date(
      Date.now() + (tokens.expires_in ?? 3600) * 1000
    ).toISOString();
    await updateAccessToken(account.id, tokens.access_token, newExpiry);
    return tokens.access_token;
  } catch (err) {
    if (err instanceof GoogleApiError && err.isInvalidGrant) {
      await markAccountNeedsReauth(account.id, "refresh token expired or revoked");
      throw new NeedsReauthError(account, "refresh token expired or revoked");
    }
    throw err;
  }
}
