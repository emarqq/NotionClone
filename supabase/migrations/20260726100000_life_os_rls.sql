-- Life OS tables: bring RLS in line with every other table in the schema.
--
-- The tables added by 20260726000000_life_os_schema.sql (projects, goals,
-- goal_checkins, study_items) shipped without RLS — they were the only four
-- tables in `public` with relrowsecurity = false. This migration applies the
-- same blanket permissive policy used on spaces/pages/blocks/db_* etc.
--
-- As elsewhere in this codebase: all server writes go through the service-role
-- client, which bypasses RLS. The `authenticated` policy is what keeps a
-- direct PostgREST session from being denied, and enabling RLS is what stops
-- any future anon-key path from reading these tables.
--
-- Deliberately NOT included: `revoke all on <table> from anon`. The anon role
-- holds no DML on these tables (only REFERENCES/TRIGGER/TRUNCATE, which the
-- base Postgres image applies uniformly to all 21 tables in this schema).
-- Revoking here would make these four diverge from the established pattern
-- rather than match it. See REORG_NOTES.md.

-- ---------------------------------------------------------------------------
-- Grants (idempotent; the initial schema's ALTER DEFAULT PRIVILEGES already
-- covers new tables, restated here to match the database_pages migration)
-- ---------------------------------------------------------------------------

grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table projects enable row level security;
alter table goals enable row level security;
alter table goal_checkins enable row level security;
alter table study_items enable row level security;

drop policy if exists "authenticated full access" on projects;
drop policy if exists "authenticated full access" on goals;
drop policy if exists "authenticated full access" on goal_checkins;
drop policy if exists "authenticated full access" on study_items;

create policy "authenticated full access" on projects
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on goals
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on goal_checkins
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on study_items
  for all to authenticated using (true) with check (true);
