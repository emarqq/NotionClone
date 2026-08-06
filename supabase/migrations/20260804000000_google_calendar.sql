-- Google Calendar connector: a local mirror of the user's Google calendars.
--
-- Shape of the integration (see docs/GOOGLE-CALENDAR.md for the whole design):
--
--   calendar_accounts  one row per connected Google account (OAuth tokens live here)
--   calendars          one row per entry in that account's calendarList
--   calendar_events    one row per *expanded instance* returned by events.list
--
-- Why a local mirror rather than proxying Google on every render: the calendar
-- grid needs a whole month of events on first paint, the app is offline-tolerant
-- by design, and Google's `syncToken` incremental protocol is explicitly built
-- to feed a client-side store (a 410 means "wipe and full-resync", which only
-- makes sense if you HAVE a store). It also lets calendar events participate in
-- local features Google knows nothing about: `category` and `page_id`.
--
-- Two columns carry all of the app-specific value and are never sent to Google:
--   `category` — class / quiz / exam / interview / coffee_chat / application /
--     deadline / other. Auto-classified from the title on first sync
--     (lib/calendar/categorize.ts) and overridable by the user; a manual choice
--     is sticky (`category_source = 'manual'`) so the next sync can't stomp it.
--   `page_id`  — the Notion-style "meeting note" attached to an event. On
--     delete of the page this goes to NULL rather than cascading: losing a note
--     must never silently delete the calendar event it was written about.
--
-- Deliberately NOT here: a table for recurrence rules. Every sync passes
-- `singleEvents=true`, so Google expands a recurring series into one concrete
-- instance per occurrence and we store those. `recurring_event_id` is kept so
-- the series can still be identified, and `ical_uid` is stable across the whole
-- series (and across calendar copies) where `google_event_id` is not.

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table calendar_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'google' check (provider in ('google')),
  -- The Google account's email, from the id_token / userinfo at connect time.
  -- Unique so re-running the OAuth flow for the same account updates the tokens
  -- in place instead of creating a duplicate account row.
  account_email text not null,
  access_token text,
  -- Google issues a refresh token only on the FIRST grant for a client+user
  -- pair, so the OAuth URL passes prompt=consent to force reissue. Null here
  -- means "we never got one" — the account is unusable and needs a reconnect.
  refresh_token text,
  token_expires_at timestamptz,
  scope text,
  -- 'connected'    — tokens are good (or at least were at last use)
  -- 'needs_reauth' — a refresh returned invalid_grant. Google expires refresh
  --                  tokens after 7 days while the OAuth consent screen is in
  --                  "Testing" publishing status, which is where a personal
  --                  single-user app stays (Production would require Google's
  --                  sensitive-scope verification). So this state is EXPECTED
  --                  roughly weekly, not exceptional — the UI shows a
  --                  "Reconnect" banner and one click fixes it.
  status text not null default 'connected'
    check (status in ('connected', 'needs_reauth', 'disconnected')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, account_email)
);

-- ---------------------------------------------------------------------------
-- Calendars (mirror of calendarList.list)
-- ---------------------------------------------------------------------------

create table calendars (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references calendar_accounts(id) on delete cascade,
  -- Google's calendar id: the primary calendar's is the account email; secondary
  -- calendars get a long @group.calendar.google.com address.
  google_calendar_id text not null,
  summary text not null default '',
  description text,
  time_zone text,
  background_color text,
  foreground_color text,
  -- owner | writer | reader | freeBusyReader. Anything below 'writer' means the
  -- UI must not offer to create or edit events on this calendar.
  access_role text,
  is_primary boolean not null default false,
  -- Whether this calendar is shown (and synced) in the app. Separate from
  -- Google's own `selected` flag, which only seeds the initial value.
  is_selected boolean not null default true,
  -- Exactly one calendar per account is the default target for events created
  -- inside the app. Enforced by a partial unique index below.
  is_write_target boolean not null default false,
  -- Opaque cursor from events.list. Null = a full sync is required. Cleared on
  -- HTTP 410 (Google's documented "your token is too old" recovery path).
  sync_token text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, google_calendar_id)
);

create index calendars_account_idx on calendars(account_id);

-- At most one write target per account (partial index: only `true` rows collide).
create unique index calendars_one_write_target_per_account
  on calendars(account_id) where is_write_target;

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create table calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references calendars(id) on delete cascade,
  google_event_id text not null,
  -- Stable across a whole recurring series AND across copies of the event on
  -- other attendees' calendars, where google_event_id is per-instance.
  ical_uid text,
  -- Set on expanded instances of a recurring series; points at the parent's id.
  recurring_event_id text,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'tentative', 'cancelled')),
  summary text not null default '',
  description text,
  location text,

  -- Time. Read these two rules and nothing else will surprise you:
  --
  --  (1) `starts_at`/`ends_at` are ALWAYS populated and are what you query and
  --      sort by. For a timed event they are the real instants. For an all-day
  --      event they are the UTC midnights bracketing the day span, purely so a
  --      single BETWEEN works for both kinds.
  --  (2) For an all-day event, RENDER from `start_date`/`end_date`, never from
  --      starts_at/ends_at — converting those back to a local date shifts the
  --      day by one for anyone west of UTC.
  --
  -- `end_date` is stored INCLUSIVE (the last day the event covers). Google's
  -- API sends `end.date` exclusive — a one-day event on Aug 4 arrives as
  -- start 2026-08-04 / end 2026-08-05. That off-by-one is normalised away once,
  -- on the way in (lib/calendar/normalize.ts), so nothing downstream repeats it.
  is_all_day boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  start_date date,
  end_date date,
  time_zone text,

  html_link text,
  -- Google Meet / conferencing join URL, flattened from conferenceData or the
  -- legacy hangoutLink so the UI has one field to check.
  meeting_url text,
  color_id text,
  -- [{ email, displayName, responseStatus, organizer, self }]
  attendees jsonb not null default '[]',
  organizer jsonb,

  etag text,
  -- Google's own last-modified stamp for the event; not our updated_at.
  google_updated_at timestamptz,

  -- --- app-local, never round-tripped to Google -----------------------------
  category text not null default 'other'
    check (category in ('class', 'quiz', 'exam', 'assignment', 'interview',
                        'coffee_chat', 'application', 'deadline', 'other')),
  category_source text not null default 'auto'
    check (category_source in ('auto', 'manual')),
  -- The attached note. `on delete set null`: deleting the note must not delete
  -- the event.
  page_id uuid references pages(id) on delete set null,
  -- True when this app created the event in Google (tagged there with
  -- extendedProperties.private.notionCloneManaged). Guards the sync loop:
  -- an inbound change to an event we just wrote is an echo, not news.
  managed_by_app boolean not null default false,

  -- The untouched Google event resource. Kept so a normalisation bug is
  -- recoverable by re-deriving columns instead of forcing a full resync, and so
  -- fields we don't model yet (reminders, attachments) aren't lost.
  raw jsonb not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (calendar_id, google_event_id)
);

-- The month/week grid query: events for one calendar overlapping a window.
create index calendar_events_calendar_starts_idx
  on calendar_events(calendar_id, starts_at);
-- The cross-calendar agenda / "upcoming deadlines" query.
create index calendar_events_starts_idx on calendar_events(starts_at);
create index calendar_events_category_idx on calendar_events(category);
-- Backlinks: "which event is this page the note for?"
create index calendar_events_page_idx on calendar_events(page_id)
  where page_id is not null;
create index calendar_events_ical_uid_idx on calendar_events(ical_uid)
  where ical_uid is not null;

-- ---------------------------------------------------------------------------
-- updated_at triggers (set_updated_at() comes from the initial schema)
-- ---------------------------------------------------------------------------

create trigger calendar_accounts_set_updated_at
  before update on calendar_accounts
  for each row execute function set_updated_at();

create trigger calendars_set_updated_at
  before update on calendars
  for each row execute function set_updated_at();

create trigger calendar_events_set_updated_at
  before update on calendar_events
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges (local Supabase ships no default grants; re-issue for new tables)
-- ---------------------------------------------------------------------------

grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security (all server writes use the service-role client, which
-- bypasses RLS; this matches the blanket authenticated policy on every table)
-- ---------------------------------------------------------------------------

alter table calendar_accounts enable row level security;
alter table calendars enable row level security;
alter table calendar_events enable row level security;

create policy "authenticated full access" on calendar_accounts
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on calendars
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on calendar_events
  for all to authenticated using (true) with check (true);
