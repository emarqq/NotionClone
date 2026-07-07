# STATE — notion-clone
> Rewritten each session, never appended. History lives in AIHub vault/runs/.
> DRAFT — agent-generated 2026-07-05; Erik should verify Now/Next.

## Status
Next.js 15 app over local Supabase (Postgres + pgvector). Block editor (Tiptap) with
nested page tree across two spaces (School, Work), RAG assistant on a swappable
provider (local Ollama by default). Working tree has substantial uncommitted changes
(editor/sidebar components, page actions, a removed legacy desktop app bundle) plus an
untracked CLAUDE.md — nothing pushed to origin/main since.

## Now / Next
- Review and commit the pending changes (or use AIHub's new per-project cleanup button)
  before starting new work, so history doesn't accumulate an unreviewed backlog.
- Confirm the desktop/Notion Clone.app removal was intentional before it's committed.

## Recent decisions
- None recorded yet — first STATE.md for this project (just registered in AIHub).
- 2026-07-07: **Document importer** (`lib/import/`, `POST /api/import`, Settings →
  Import documents). Drops external docs (PDF/docx/xlsx/txt/md) in as **read-only
  reference context** — reuses `ingestFile` for chunk/embed/dedup into a dedicated
  "Imported" space + mirrors read-only Markdown to `<vault>/Imported`. No migration
  (`source_type='file'`, `page_id=null`). Editable-page conversion deferred (seam in
  `importDoc()`). On branch `feat/markdown-export`.

## Failed approaches
None recorded — no run history in AIHub vault yet.

## Blockers / open questions
- None identified beyond the uncommitted working tree above.

## Last verified
2026-07-07: document importer verified headlessly end-to-end (tsx + react-server) against
the live local Supabase + Ollama — 5 real docs from ~/OS/brain-docs imported → 26 chunks
in the Imported space, all 26 embedded (768-dim), XOR-ok (source_type='file', page_id
null); Markdown mirror written with `imported: true`/`sourcePath` frontmatter; retrieval
scoped to the Imported space returned the imported chunks; re-import deduped (5/5
unchanged, 0 new chunks). Test data cleaned up afterward (no real-vault/DB residue).
