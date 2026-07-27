-- Graph-RAG: neighbor_search RPC + supporting indexes.
--
-- After hybrid_search returns the seed chunk set, the retriever expands along
-- the `links` edge list to directly-linked pages and pulls each neighbor's most
-- query-relevant chunk. This RPC is that second, page-scoped vector search: it
-- reuses the query embedding already computed for hybrid_search (no re-embed)
-- and returns the top chunks by cosine distance among a bounded set of page ids.
-- Ordering by pgvector's `<=>` operator can't be expressed through PostgREST,
-- so it lives here as an RPC. Return shape mirrors hybrid_search (minus rrf_score,
-- plus vector_rank) so the TS mapping is identical.

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
  left join pages p on c.page_id = p.id
  left join files fl on c.file_id = fl.id
  where c.page_id = any(page_ids)
    and c.embedding is not null
    and (space_filter is null or c.space_id = space_filter)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function neighbor_search(vector, uuid[], uuid, int)
  to authenticated, service_role;

-- Forward traversal from a page (links where source_page_id = X). Only
-- target_page_id was indexed before (links_target_page_idx, for backlinks).
create index if not exists links_source_page_idx on links (source_page_id);

-- page_id -> chunks lookup for neighbor expansion (only page chunks participate;
-- file chunks have page_id null per the source_type CHECK).
create index if not exists chunks_page_idx on chunks (page_id) where source_type = 'page';
