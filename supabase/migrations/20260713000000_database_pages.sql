-- Database pages: turn any page into a lightweight Notion-style database
-- (custom properties + typed values on its child pages, plus saved views).
--
-- `is_database` flips a page into database mode; its schema (db_properties,
-- db_property_options) and view configs (db_views) persist independently of
-- that flag so toggling back to a plain page and back to a database again
-- never loses the schema. Row data itself is just `pages.parent_page_id`
-- (a database's "rows" are its child pages) plus one `db_property_values`
-- row per (row page, property) — sparse, so a property with no value set on
-- a given row simply has no row here.

alter table pages add column is_database boolean not null default false;

create table db_properties (
  id uuid primary key default gen_random_uuid(),
  database_page_id uuid not null references pages(id) on delete cascade,
  name text not null,
  type text not null check (type in
    ('text','number','checkbox','select','multi_select','status','date')),
  position text not null collate "C",
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index db_properties_database_page_idx on db_properties(database_page_id);

create table db_property_options (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references db_properties(id) on delete cascade,
  label text not null,
  color text check (color in
    ('gray','red','orange','yellow','green','blue','purple','pink') or color is null),
  position text not null collate "C",
  status_group text check (status_group in ('todo','in_progress','complete') or status_group is null),
  created_at timestamptz not null default now(),
  unique (property_id, label)
);
create index db_property_options_property_idx on db_property_options(property_id);

create table db_property_values (
  page_id uuid not null references pages(id) on delete cascade,
  property_id uuid not null references db_properties(id) on delete cascade,
  value jsonb not null default 'null',
  updated_at timestamptz not null default now(),
  primary key (page_id, property_id)
);
create index db_property_values_property_idx on db_property_values(property_id);

create table db_views (
  id uuid primary key default gen_random_uuid(),
  database_page_id uuid not null references pages(id) on delete cascade,
  name text not null,
  type text not null check (type in ('table','board','calendar')),
  position text not null collate "C",
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index db_views_database_page_idx on db_views(database_page_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (reuse the existing set_updated_at() from the initial
-- schema; db_property_options has no updated_at column, so no trigger there)
-- ---------------------------------------------------------------------------

create trigger db_properties_set_updated_at
  before update on db_properties
  for each row execute function set_updated_at();

create trigger db_property_values_set_updated_at
  before update on db_property_values
  for each row execute function set_updated_at();

create trigger db_views_set_updated_at
  before update on db_views
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

alter table db_properties enable row level security;
alter table db_property_options enable row level security;
alter table db_property_values enable row level security;
alter table db_views enable row level security;

create policy "authenticated full access" on db_properties
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on db_property_options
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on db_property_values
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on db_views
  for all to authenticated using (true) with check (true);
