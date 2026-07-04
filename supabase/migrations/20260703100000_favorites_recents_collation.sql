-- Favorites + recents columns, fractional-index collation fix, and an
-- updated_at trigger that ignores pure view/favorite metadata touches.

-- ---------------------------------------------------------------------------
-- Favorites / recents
-- ---------------------------------------------------------------------------

alter table pages
  add column is_favorite boolean not null default false,
  add column last_viewed_at timestamptz;

create index pages_recents_idx on pages (last_viewed_at desc nulls last)
  where not is_archived;
create index pages_favorites_idx on pages (space_id)
  where is_favorite and not is_archived;

-- ---------------------------------------------------------------------------
-- Fractional-index collation fix
--
-- Fractional-index keys (lib/positions.ts) are defined in byte / code-unit
-- order: 'Zz' < 'a0'. The default locale collation disagrees (it sorts 'Zz'
-- after 'a0'), which is why all ordering so far happens in JS. Switching the
-- position columns to collate "C" makes ORDER BY position match key order.
-- ---------------------------------------------------------------------------

alter table pages alter column position type text collate "C";
alter table blocks alter column position type text collate "C";
alter table spaces alter column position type text collate "C";

-- ---------------------------------------------------------------------------
-- updated_at should mean "content edited", not "viewed"
--
-- The original set_updated_at() trigger bumps updated_at on EVERY update,
-- so touching last_viewed_at on each page view (or toggling is_favorite)
-- would falsify "Edited <date>". Replace the pages trigger with a function
-- that only bumps updated_at when something other than view/favorite
-- metadata changed, and otherwise leaves whatever value the statement set.
-- ---------------------------------------------------------------------------

create or replace function set_updated_at_ignore_view_meta()
returns trigger
language plpgsql
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'last_viewed_at' - 'is_favorite')
     is distinct from
     (to_jsonb(old) - 'updated_at' - 'last_viewed_at' - 'is_favorite') then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger pages_set_updated_at on pages;
create trigger pages_set_updated_at
  before update on pages
  for each row execute function set_updated_at_ignore_view_meta();
