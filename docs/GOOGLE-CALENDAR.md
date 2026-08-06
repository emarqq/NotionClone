# Google Calendar connector

Connect a Google account and its calendars mirror locally: the month/week grid
reads Postgres, not Google, on every render. Events sync in the background,
auto-categorize into class/exam/interview/etc, and can carry a linked page as
a meeting note. Writing an event from this app pushes it to Google first and
mirrors back whatever Google echoes.

## One-time setup you still need to do

This needs a Google Cloud project and an OAuth client — about ten minutes,
once. Do this for the account `erik.3.marquardt@gmail.com`.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create a new project (any name — e.g. "NotionClone Calendar").
2. **APIs & Services → Library** → search "Google Calendar API" → **Enable**.
3. **APIs & Services → OAuth consent screen** → User type **External** (a
   `gmail.com` account can't use Internal, which requires a Workspace org) →
   fill in an app name, your support email, and your developer contact email.
4. On the **Scopes** step, add:
   - `.../auth/calendar.events`
   - `.../auth/calendar.readonly`
   - `.../auth/userinfo.email`
5. **Leave the publishing status on "Testing"** and add
   `erik.3.marquardt@gmail.com` under **Test users**.

   Why: moving to **Production** would require Google's sensitive-scope
   verification — a security assessment meant for apps with real user
   populations, not a one-person local tool. **Internal** would avoid that,
   but it only exists for Google Workspace organizations; a plain `gmail.com`
   account doesn't have one. Testing is the only status this app can use.

   **Consequence to know in advance: while in Testing, Google expires every
   refresh token it issues after 7 days.** About once a week the app will
   show a "Reconnect Google Calendar" banner — one click through the consent
   screen fixes it. This is a Google policy for unverified apps, not a bug
   here; `calendar_accounts.status` even has a `needs_reauth` value built
   around it (`lib/calendar/tokens.ts`). Don't spend a debugging session
   chasing it.

6. **Credentials → Create credentials → OAuth client ID** → application type
   **Web application**. Under **Authorized redirect URIs**, add **all four** of
   these exactly:
   ```
   http://localhost:3000/api/calendar/auth/callback
   http://127.0.0.1:3000/api/calendar/auth/callback
   http://localhost:3777/api/calendar/auth/callback
   http://127.0.0.1:3777/api/calendar/auth/callback
   ```
   **Google matches `redirect_uri` byte-for-byte against this list, and the
   app builds its callback from whichever origin you actually opened it on
   (`ALLOWED_ORIGINS` in `lib/calendar/config.ts`) — so every origin the app
   can be reached at has to be registered, or that one surface fails with a
   bare `redirect_uri_mismatch` and no other clue.** `:3000` is the dev
   server, `:3777` is the production server the Electron desktop app loads
   (see the root `CLAUDE.md`'s desktop gotcha), and `localhost` and
   `127.0.0.1` are *different origins* to Google even though they resolve to
   the same machine — which is why it's four entries and not two. Plain
   `http://` is fine here; Google exempts `localhost`/`127.0.0.1` from its
   HTTPS-only redirect rule. If you get `redirect_uri_mismatch` right after
   saving, wait a couple of minutes — new redirect URIs can take a moment to
   propagate.
7. Copy the **Client ID** and **Client secret** into `.env.local`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
   The secret is shown once at creation — if you lose it, generate a new one
   from the same client's page.
8. Restart the dev server, open the app, click **Calendar** in the sidebar,
   and click **Connect your Google Calendar**.

## How it works

**Local mirror, three tables** (`supabase/migrations/20260804000000_google_calendar.sql`):
`calendar_accounts` (one row per connected Google account, tokens live here),
`calendars` (mirrors `calendarList.list`), `calendar_events` (one row per
*expanded instance* from `events.list`). The grid queries Postgres directly —
no live Google call sits in the render path, and the app stays usable offline
except for actually syncing.

**Incremental sync via `syncToken`.** The first pass over a calendar is a
bounded full listing (`CALENDAR_SYNC_PAST_DAYS`, default 90) that ends with a
`nextSyncToken`; every pass after hands that token back and gets only what
changed. A `410 Gone` means the stored token is too old — Google's only
documented recovery is to discard it and run a fresh full listing, which
`lib/calendar/sync.ts` does automatically (guarded so a persistently-410ing
calendar can't loop forever). See Google's
[sync guide](https://developers.google.com/workspace/calendar/api/guides/sync).

**Polling, not `events.watch` push notifications.** Google's
[push notification](https://developers.google.com/workspace/calendar/api/guides/push)
channel requires a publicly reachable HTTPS endpoint with a real certificate
to receive webhooks — this app is bound to `localhost` on purpose (see the
root `CLAUDE.md`'s no-auth note: anyone who reaches the port has full access,
so it must never be exposed to a network). Freshness instead comes from
syncing on calendar-page open, on an interval
(`CALENDAR_SYNC_INTERVAL_SECONDS`, default 300), and a manual "Sync now".

**`singleEvents=true` and `showDeleted=true`, and why they're fixed.** Every
listing call passes both. `singleEvents=true` expands a recurring series into
one concrete row per occurrence (there's no `recurrence_rules` table — see
the migration's header comment), which is what lets each instance carry its
own category and note. `showDeleted=true` is what turns a deleted event into
a `{ id, status: "cancelled" }` tombstone instead of just vanishing from the
listing, which is how a cancelled interview stays visible, struck through,
instead of silently disappearing. Neither can be changed mid-token: Google
ties a `syncToken` to the exact parameters that produced it, so flipping
either would 410 on the next sync.

**The write-back loop guard.** Every event this app creates or edits in
Google is stamped with `extendedProperties.private.notionCloneManaged=true`
(and `notionClonePageId` when a note is linked) — see `lib/calendar/types.ts`
and `toGoogleEvent()` in `lib/calendar/normalize.ts`. Inbound sync reads that
marker to recognize its own writes. Without it, a two-way sync echoes: the
app writes an event, sync reads it back as "new", and depending on what else
touches it you get a duplicate or a fight over whose version wins.

## Categories and notes

Every synced event is auto-categorized by `lib/calendar/categorize.ts` — pure
keyword matching against the title (and, weakly, the location; the
description is deliberately excluded because invite boilerplate produces
false positives) into one of: `class`, `quiz`, `exam`, `assignment`,
`interview`, `coffee_chat`, `application`, `deadline`, `other`. It runs on
every sync — hundreds of events at a time — so it has to be instant and
offline; a wrong guess is cheap because you can override it.

**A manual override is permanent.** Correcting a category in the event panel
sets `category_source = 'manual'`, and `shouldAutoCategorize()` checks that
flag before every write — no later sync can silently reclassify it back.

**The note link is bidirectional and non-destructive.** `calendar_events.page_id`
points at the linked Notion-style page; the page doesn't know about the event
at all (no back-column on `pages`), so the direction you navigate from is
always calendar → page. Deleting the page sets `page_id` to `NULL` via
`on delete set null` — **it never cascades and deletes the calendar event**.
Losing a note must never take the meeting off your calendar with it.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `redirect_uri_mismatch` right after connecting | The exact URI Google received isn't registered (most often: the app was opened on an origin you never registered — `127.0.0.1` vs `localhost` counts as a different one), or it was just added and hasn't propagated | Check all four URIs from Setup step 6 are in the Cloud Console client and match byte-for-byte (including the trailing path, no trailing slash); wait a couple of minutes if you just saved |
| "Access blocked: this app hasn't been verified" / "app not verified" | Your Google account isn't on the OAuth consent screen's Test users list | Add `erik.3.marquardt@gmail.com` under **OAuth consent screen → Test users** |
| "Reconnect Google Calendar" banner shows up roughly weekly | Expected — Testing-mode refresh tokens expire after 7 days (see Setup step 5) | Click Reconnect; this is Google policy, not an app bug |
| A calendar you expect isn't showing events | It's unchecked in this app's Calendar settings (`is_selected = false`) — separate from Google's own "shown" toggle | Open Calendar settings here and enable it; the next sync will pull it |
| An all-day event looks like it's one day longer than it should be | Would point at a regression in the exclusive→inclusive conversion | Check `lib/calendar/normalize.ts`'s `resolveTimes()` — this is the one bug class the test suite (`tests/calendar/normalize.test.ts`) exists specifically to pin down |
| Editing or deleting an event fails, or the composer won't offer a calendar as a target | The calendar's `access_role` is below `writer` (e.g. `reader`, `freeBusyReader`) | Nothing to fix here — it's read-only in Google. Check sharing settings on that calendar if you expected write access |
| Events stop updating / a sync silently does nothing | Check the sync toast for an error, or `calendar_accounts.last_error` / `calendars` sync state directly | Same "check the actual error" instinct as an Ollama-down chat failure — the failure is almost always visible if you look at the right row instead of assuming |

## Deliberate limitations

- **No push notifications.** Freshness is polling-based, capped by
  `CALENDAR_SYNC_INTERVAL_SECONDS` — see "How it works" above.
- **No recurrence editing.** A recurring series arrives already expanded
  into individual instances (`singleEvents=true`); editing one instance here
  edits only that instance, the same as clicking a single occurrence in
  Google Calendar's own UI. There's no "edit the whole series" action.
- **No attendee invites from this app.** Events are created/edited without
  managing an attendee list; invite people from Google Calendar directly if
  needed.
- **No free/busy or scheduling.** This is a read/write mirror with local
  categorization, not a scheduling tool — no availability search, no
  meeting-poll links.
- **One note per event.** `calendar_events.page_id` is a single column, not
  a join table.

## Reference

- [Sync guide](https://developers.google.com/workspace/calendar/api/guides/sync) — `syncToken`, full vs. incremental, 410 recovery.
- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) — the authorization-code flow this app hand-rolls in `lib/calendar/oauth.ts`.
- [Push notifications](https://developers.google.com/workspace/calendar/api/guides/push) — `events.watch`, and why it needs a public HTTPS endpoint this app doesn't have.
- [OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes#calendar) — what `calendar.events` and `calendar.readonly` each grant.
- [Events resource reference](https://developers.google.com/workspace/calendar/api/v3/reference/events) — the shapes hand-typed in `lib/calendar/types.ts`.
