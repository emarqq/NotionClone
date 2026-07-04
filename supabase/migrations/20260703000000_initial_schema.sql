-- Initial schema for NotionClone knowledge hub

create extension if not exists vector;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  icon text,
  position text not null default 'a0',
  created_at timestamptz default now()
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces on delete cascade,
  parent_page_id uuid references pages(id) on delete cascade,
  title text not null default 'Untitled',
  icon text,
  position text not null,
  is_archived boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index pages_space_parent_idx on pages (space_id, parent_page_id);
create index pages_title_search_idx on pages using gin (to_tsvector('english', title));

create table blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages on delete cascade,
  parent_block_id uuid references blocks(id) on delete cascade,
  type text not null check (type in (
    'paragraph','heading','checklist_item','bullet_list','ordered_list',
    'table','code','callout','toggle','image','file_embed','divider','quote'
  )),
  content jsonb not null default '{}',
  position text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index blocks_page_position_idx on blocks (page_id, position);

create table tags (
  id uuid primary key default gen_random_uuid(),
  name citext not null unique,
  color text
);

create table page_tags (
  page_id uuid not null references pages on delete cascade,
  tag_id uuid not null references tags on delete cascade,
  primary key (page_id, tag_id)
);

create table links (
  id uuid primary key default gen_random_uuid(),
  source_page_id uuid not null references pages on delete cascade,
  source_block_id uuid references blocks(id) on delete cascade,
  target_page_id uuid not null references pages on delete cascade,
  created_at timestamptz default now(),
  unique (source_block_id, target_page_id)
);

create index links_target_page_idx on links (target_page_id);

create table files (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces,
  page_id uuid references pages on delete set null,
  block_id uuid references blocks(id) on delete set null,
  storage_path text not null unique,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending','done','failed','unsupported')),
  created_at timestamptz default now()
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('page','file')),
  page_id uuid references pages on delete cascade,
  file_id uuid references files on delete cascade,
  space_id uuid not null,
  chunk_index int not null,
  heading_path text[] not null default '{}',
  content text not null,
  content_hash text not null,
  token_count int,
  embedding vector(768),
  embedding_model text,
  tsv tsvector generated always as (to_tsvector('english', content)) stored,
  check (
    (source_type = 'page' and page_id is not null and file_id is null)
    or
    (source_type = 'file' and file_id is not null and page_id is null)
  )
);

create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
create index chunks_tsv_idx on chunks using gin (tsv);

create table ai_conversations (
  id uuid primary key default gen_random_uuid(),
  title text,
  space_filter uuid references spaces,
  created_at timestamptz default now()
);

create table ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ai_conversations on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  sources jsonb,
  created_at timestamptz default now()
);

create table app_settings (
  key text primary key,
  value jsonb not null
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger pages_set_updated_at
  before update on pages
  for each row execute function set_updated_at();

create trigger blocks_set_updated_at
  before update on blocks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges (local Supabase no longer ships default grants on public tables)
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;
alter default privileges in schema public
  grant all on tables to authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table spaces enable row level security;
alter table pages enable row level security;
alter table blocks enable row level security;
alter table tags enable row level security;
alter table page_tags enable row level security;
alter table links enable row level security;
alter table files enable row level security;
alter table chunks enable row level security;
alter table ai_conversations enable row level security;
alter table ai_messages enable row level security;
alter table app_settings enable row level security;

create policy "authenticated full access" on spaces
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on pages
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on blocks
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on tags
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on page_tags
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on links
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on files
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on chunks
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on ai_conversations
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on ai_messages
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on app_settings
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict do nothing;

create policy "authenticated attachments select" on storage.objects
  for select to authenticated using (bucket_id = 'attachments');
create policy "authenticated attachments insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'attachments');
create policy "authenticated attachments update" on storage.objects
  for update to authenticated using (bucket_id = 'attachments') with check (bucket_id = 'attachments');
create policy "authenticated attachments delete" on storage.objects
  for delete to authenticated using (bucket_id = 'attachments');
