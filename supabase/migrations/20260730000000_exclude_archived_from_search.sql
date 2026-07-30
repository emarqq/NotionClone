-- Exclude archived pages from retrieval (roadmap C4, CODE_REVIEW §R5).
--
-- `archivePage()` only flips `pages.is_archived`; a page's chunks are removed
-- only on a real delete (via cascade). Neither `hybrid_search` nor
-- `neighbor_search` filtered on `is_archived`, so archiving a page to "put it
-- away" did not stop the assistant retrieving it, quoting it and linking to it.
-- The user's mental model of archiving is "this is no longer part of my notes";
-- retrieval was contradicting that, and citing a page the sidebar no longer shows
-- reads as a bug even when the answer is right.
--
-- Two decisions worth stating, because they are not forced by the code:
--
-- 1. **A file chunk is excluded when the page it is attached to is archived.**
--    Archiving a page puts its attachments away with it; leaving a PDF
--    retrievable after its page is gone from the sidebar would be the same
--    surprise one level down. An *unattached* file (`files.page_id is null`) is
--    unaffected and stays searchable — it was never on an archived page.
--
-- 2. **The filter lives inside the candidate CTEs, before `limit 20`, not in the
--    final select.** Filtering afterwards would silently shrink the result set:
--    a hit list of 20 archived chunks would return nothing while the live chunk
--    that should have ranked 21st never entered the fusion at all.
--
-- The `coalesce(..., false)` pattern is what makes one predicate cover both
-- chunk kinds: for a page chunk `p` is the page and `fp` is null; for a file
-- chunk `p` is null and `fp` is the attached page (or null if unattached).
--
-- Both functions are replaced wholesale rather than patched, because a
-- `create or replace function` has to restate the whole body. Signatures are
-- unchanged, so nothing in `lib/rag/` moves and existing grants survive; they
-- are re-issued anyway, since the local Supabase images ship no default grants.

create or replace function hybrid_search(
  query_text text,
  query_embedding vector(768),
  space_filter uuid default null,
  match_count int default 8
)
returns table (
  chunk_id uuid,
  source_type text,
  page_id uuid,
  file_id uuid,
  space_id uuid,
  heading_path text[],
  chunk_index int,
  content text,
  title text,
  rrf_score double precision
)
language sql
stable
as $$
with fts_candidates as (
  select
    c.id,
    row_number() over (
      order by ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) desc
    ) as rank
  from chunks c
  left join pages p on p.id = c.page_id
  left join files f on f.id = c.file_id
  left join pages fp on fp.id = f.page_id
  where c.tsv @@ websearch_to_tsquery('english', query_text)
    and (space_filter is null or c.space_id = space_filter)
    and coalesce(p.is_archived, false) = false
    and coalesce(fp.is_archived, false) = false
  order by rank
  limit 20
),
vector_candidates as (
  select
    c.id,
    row_number() over (
      order by c.embedding <=> query_embedding
    ) as rank
  from chunks c
  left join pages p on p.id = c.page_id
  left join files f on f.id = c.file_id
  left join pages fp on fp.id = f.page_id
  where c.embedding is not null
    and (space_filter is null or c.space_id = space_filter)
    and coalesce(p.is_archived, false) = false
    and coalesce(fp.is_archived, false) = false
  order by rank
  limit 20
),
fused as (
  select
    coalesce(f.id, v.id) as id,
    coalesce(1.0 / (60 + f.rank), 0.0) + coalesce(1.0 / (60 + v.rank), 0.0) as rrf_score
  from fts_candidates f
  full outer join vector_candidates v on f.id = v.id
)
select
  c.id as chunk_id,
  c.source_type,
  c.page_id,
  c.file_id,
  c.space_id,
  c.heading_path,
  c.chunk_index,
  c.content,
  coalesce(p.title, fl.filename) as title,
  fused.rrf_score
from fused
join chunks c on c.id = fused.id
left join pages p on c.page_id = p.id
left join files fl on c.file_id = fl.id
order by fused.rrf_score desc
limit match_count;
$$;

grant execute on function hybrid_search(text, vector, uuid, int) to authenticated, service_role;

-- neighbor_search is reached only from graph expansion, and lib/rag/graph.ts
-- already drops archived pages from the neighbour set — but that is a *caller*
-- guarantee, and the RPC is the thing with the SQL grant. Defend it here too, so
-- the invariant cannot be lost by a future caller.
create or replace function neighbor_search(
  query_embedding vector(768),
  page_ids uuid[],
  space_filter uuid default null,
  match_count int default 12
)
returns table (
  chunk_id uuid,
  source_type text,
  page_id uuid,
  file_id uuid,
  space_id uuid,
  heading_path text[],
  chunk_index int,
  content text,
  title text,
  vector_rank int
)
language sql
stable
as $$
  select
    c.id as chunk_id,
    c.source_type,
    c.page_id,
    c.file_id,
    c.space_id,
    c.heading_path,
    c.chunk_index,
    c.content,
    coalesce(p.title, fl.filename) as title,
    row_number() over (order by c.embedding <=> query_embedding)::int as vector_rank
  from chunks c
  left join pages p on p.id = c.page_id
  left join files fl on fl.id = c.file_id
  left join pages fp on fp.id = fl.page_id
  where c.page_id = any(page_ids)
    and c.embedding is not null
    and (space_filter is null or c.space_id = space_filter)
    and coalesce(p.is_archived, false) = false
    and coalesce(fp.is_archived, false) = false
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function neighbor_search(vector, uuid[], uuid, int)
  to authenticated, service_role;
