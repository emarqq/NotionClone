-- Inline comments: threaded comments anchored to a text range within a block.
--
-- Anchoring is a ProseMirror `comment` mark (carrying a thread id) that lives in
-- the block's content JSON and re-anchors with the text for free; these tables
-- hold the thread metadata + reply bodies. `block_id` is a denormalized pointer
-- to the anchoring block (kept fresh by reconcilePageComments) for the panel's
-- jump-to and orphan detection; the mark itself is the source of truth.

create table comment_threads (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages on delete cascade,
  -- Anchor block; nulled (not deleted) if the block goes away, so the thread and
  -- its replies survive as an orphan rather than vanishing.
  block_id uuid references blocks(id) on delete set null,
  -- Snapshot of the commented text at creation: panel preview + orphan label.
  anchor_text text,
  resolved boolean not null default false,
  resolved_at timestamptz,
  -- Set true by reconcile when the anchor mark is no longer present in the doc.
  orphaned boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Hot read is "unresolved threads for page P" (the active panel + popovers).
create index comment_threads_page_idx on comment_threads (page_id) where not resolved;

create table comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references comment_threads(id) on delete cascade,
  -- Single-user app; nullable and unused for now, kept for a future multi-user pass.
  author text,
  body text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index comments_thread_idx on comments (thread_id);

-- Reuse the existing set_updated_at() from the initial schema.
create trigger comment_threads_set_updated_at
  before update on comment_threads
  for each row execute function set_updated_at();

create trigger comments_set_updated_at
  before update on comments
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

alter table comment_threads enable row level security;
alter table comments enable row level security;

create policy "authenticated full access" on comment_threads
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on comments
  for all to authenticated using (true) with check (true);
