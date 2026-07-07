-- Cover image support for pages: stores the storage_path of a `files` row in
-- the private `attachments` bucket (never a signed URL — those expire), plus
-- a vertical crop offset for the reposition control.

alter table pages
  add column cover_url text,
  add column cover_position smallint not null default 50
    check (cover_position between 0 and 100);
