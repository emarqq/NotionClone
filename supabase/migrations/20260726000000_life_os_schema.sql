-- Life OS schema: the data layer AI Hub will read from, and NotionClone will write to.
-- Designed to be boring and queryable, not clever. Extend, don't redesign, once it's live.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  repo_path text,                          -- local path or git remote, for cross-referencing STATUS.md
  status text not null default 'active',   -- active | paused | shipped | archived
  pct_complete int check (pct_complete between 0 and 100),
  next_action text,
  last_touched_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  category text not null,                  -- e.g. 'language', 'career', 'coding', 'entrepreneurship'
  title text not null,                     -- e.g. 'German - conversational fluency'
  description text,
  target_date date,
  status text not null default 'active',   -- active | paused | done
  review_cadence_days int default 7,       -- how often you check in on this goal
  last_reviewed_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists goal_checkins (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references goals(id) on delete cascade,
  note text,
  progress_delta text,                     -- freeform: "finished A1 unit 4", not a forced numeric score
  created_at timestamptz default now()
);

-- Study mode: quiz items generated from NotionClone notes via the RAG assistant
create table if not exists study_items (
  id uuid primary key default gen_random_uuid(),
  source_note_id uuid,                     -- references your NotionClone note/block table
  question text not null,
  answer text not null,
  subject text,                            -- e.g. 'Finance - DCF', 'German - Dativ case'
  ease_factor numeric default 2.5,         -- basic SM-2 style spaced repetition
  interval_days int default 1,
  next_review_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_study_items_next_review on study_items (next_review_at);
create index if not exists idx_goals_status on goals (status);
create index if not exists idx_projects_status on projects (status);
