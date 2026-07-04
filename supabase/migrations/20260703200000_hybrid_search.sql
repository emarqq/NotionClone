-- Hybrid full-text + vector search over chunks, fused with Reciprocal Rank Fusion (k=60)

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
  where c.tsv @@ websearch_to_tsquery('english', query_text)
    and (space_filter is null or c.space_id = space_filter)
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
  where c.embedding is not null
    and (space_filter is null or c.space_id = space_filter)
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
