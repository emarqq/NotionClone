# STATE — notion-clone
> Rewritten each session, never appended. History lives in AIHub vault/runs/.

## Status
Next.js 15 app over local Supabase (Postgres + pgvector). Block editor (Tiptap) with
nested page tree, RAG assistant (local Ollama), markdown export/vault mirror, document
importer, markdown import, database pages Phase 1.

**NEW 2026-08-04 (late session): meeting recording → transcript.** Records the
microphone *and* computer audio, transcribes locally with whisper.cpp (Metal), and
appends a `You:`/`Them:` labeled transcript to the page you started it from. Setup
and troubleshooting: `docs/MEETING-RECORDING.md`.

**NEW 2026-08-04 (later session): Google Calendar connector.** Connects a Google
account and mirrors its calendars locally — the month/week grid reads Postgres, not
Google, on every render. Events sync in the background, auto-categorize (class/exam/
interview/etc.), and can carry a linked page as a meeting note; the note↔event link
is now visible from both sides (a banner on the page, a "Coming up" rail on Home).
Writing an event from this app pushes to Google first and mirrors back whatever
Google echoes. Setup + design: `docs/GOOGLE-CALENDAR.md`.

## Now / Next
- **Erik: do the Google Cloud Console setup** in `docs/GOOGLE-CALENDAR.md` (OAuth
  consent screen, client ID/secret in `.env.local`) — the calendar connector has no
  way to connect an account until this is done. **The migration
  `20260804000000_google_calendar.sql` is also pending on the local stack** — it has
  been replayed and verified against a disposable scratch Postgres container, but not
  yet applied to the real local Supabase instance; ask before running
  `supabase migration up` there (never `db reset` — see the root `CLAUDE.md` caution).
- **Erik: install BlackHole** (`brew install --cask blackhole-2ch`) + build a
  Multi-Output Device in Audio MIDI Setup — this is the only thing standing between
  the current meeting-recording build and capturing the far side of a real call. Steps
  are in `docs/MEETING-RECORDING.md`. Everything else there is done and verified.
- **Erik: do one real recording in Chrome at :3000** and watch the two level meters
  before relying on it for an actual interview. A flat "Them" meter = BlackHole isn't
  routed, and that's unrecoverable after the fact.
- Ollama was **down** during the meeting-recording session, so transcripts weren't
  RAG-indexed (the hook fired and failed cleanly). Start `ollama serve` if you want
  transcripts (and calendar-linked notes) searchable.
- Optional follow-ups, all deliberately cut from v1: pause/resume, live partial
  transcripts, the `?pending=1` crash-recovery prompt (endpoint exists, no UI),
  a `meeting_recordings` table, custom speaker labels in the UI.
- Review + merge `feat/database-pages`; Phase 2 side-peek row panel.

## Recent decisions
- 2026-08-04: **local mirror + `syncToken` incremental sync for the calendar
  connector.** The grid needs a whole month on first paint and the app is
  offline-tolerant by design, so Postgres — not a live Google call — is what the
  grid queries. A `410 Gone` from Google (token too old) triggers an automatic
  discard-and-full-resync, guarded against looping.
- 2026-08-04: **polling, not `events.watch` push, for calendar freshness.** Push
  notifications need a publicly reachable HTTPS endpoint; this app is bound to
  localhost on purpose (no-auth note below). Freshness instead comes from syncing on
  calendar-page open, an interval, and a manual "Sync now".
- 2026-08-04: **`extendedProperties.private` as the write-back loop guard.** Every
  event this app creates/edits in Google is stamped `notionCloneManaged=true`;
  inbound sync reads that marker to recognize its own writes instead of re-importing
  them as new events.
- 2026-08-04: **all-day exclusive→inclusive end normalized once, on the way in.**
  Google's `end.date` is exclusive; `lib/calendar/normalize.ts`'s `resolveTimes()`
  converts to an inclusive `end_date` at ingest so nothing downstream repeats the
  off-by-one.
- 2026-08-04: **`category_source` makes a manual category override permanent.**
  `shouldAutoCategorize()` checks the flag before every sync write, so correcting a
  guessed category once is correcting it forever.
- 2026-08-04: **note link is `on delete set null`, not cascade.** Deleting a page
  must never take the linked calendar event off the calendar with it — the same
  principle behind why cancelled events are tombstoned rather than deleted.
- 2026-08-04: **one stereo recorder, not two mono ones** (meeting recording). Mic →
  left channel, system → right, merged in a WebAudio `ChannelMergerNode` so both
  speakers share one clock and can't drift; two independent MediaRecorders would
  drift, and you'd only find out 40 minutes into an interview.
- 2026-08-04: **channel provenance IS the speaker label** (meeting recording). No
  diarization model — the mic channel is "You" and the loopback channel is "Them".
- 2026-08-04: **no migration for recordings** — `<RECORDINGS_DIR>/<uuid>/meta.json`
  on disk is the source of truth, surviving Turbopack re-evaluating route modules,
  a server restart, and the tab closing.

## Failed approaches
- Chrome's `--use-file-for-fake-audio-capture` produced **pure silence** on this build
  (Chrome 14x, headless=new): a 14 s stereo recording came out 3,525 bytes. Recording
  straight from `getUserMedia` with no WebAudio gave byte-identical output, proving the
  graph was innocent. Verified the routing instead with two oscillators (440 Hz left /
  880 Hz right) and did the full end-to-end by patching `navigator.mediaDevices` to
  serve two different voices. Don't waste time on the fake-file flag again.
- `tippyOptions.appendTo: () => document.body` does NOT fix the BubbleMenu unmount
  crash — the reparented node's fiber parent is what matters.

## Blockers / open questions
- **The Google OAuth flow has never been run against real Google credentials.** No
  Cloud Console project/client exists yet (Erik's setup step above); the whole
  connector is verified by unit tests and a disposable-DB migration replay only, never
  a real `/api/calendar/auth/callback` round trip.
- **Testing-mode refresh tokens expire after 7 days** — Google policy for unverified
  OAuth apps, not a bug. Once connected, expect a "Reconnect Google Calendar" banner
  roughly weekly (`calendar_accounts.status = 'needs_reauth'`); one click through
  consent fixes it. See `docs/GOOGLE-CALENDAR.md` for why Production/Internal
  publishing isn't available to a personal `gmail.com` account.
- **BlackHole is not installed** (needs Erik's admin password + possibly a reboot), so
  real system-audio capture is the one meeting-recording path never exercised against
  hardware. The code path is proven with injected devices; the loopback auto-detect
  regex matched a device labeled "BlackHole 2ch" in test.
- The Electron mic permission (`NSMicrophoneUsageDescription` + `askForMediaAccess`) is
  written but unverified — the app is unsigned, so TCC may fight it. Record in Chrome.
- Phase-1 database scope cuts listed in the ARCHITECTURE addendum.

## Last verified
2026-08-04 (later session) — **Google Calendar connector: automated checks and a
disposable-DB migration replay. No browser run, no real OAuth round trip, no real
sync against Google.**
- `npm test` **428 passed / 2 skipped** (20 files; includes 68 calendar tests covering
  normalize/categorize/sync/writeback/grid). `npm run typecheck` and `npm run lint`
  both clean — including the new page-side `EventNoteBanner` and Home's "Coming up"
  rail, which have no dedicated tests of their own (thin presentational wiring over
  already-tested `getEventForPage`/`getUpcomingEvents`).
- `20260804000000_google_calendar.sql` replayed cleanly on a disposable Postgres
  container (never the real local stack) with constraint and cascade checks: the
  `calendars_one_write_target_per_account` partial unique index, `calendar_accounts
  → calendars → calendar_events` cascade-delete, and `calendar_events.page_id`
  `on delete set null` against `pages` all behaved as designed.
- **Not verified this session**: no real OAuth round trip (no Cloud Console client
  exists yet), no real sync against a live Google account, no browser/CDP drive of
  the calendar UI, the page banner, or the Home "Coming up" rail. The
  meeting-recording feature's own end-to-end browser verification (mic → transcript
  → persisted blocks) was completed in the prior session and is unchanged by this
  one; see git history / AIHub vault/runs/ for that run's detail.
