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

## Failed approaches
None recorded — no run history in AIHub vault yet.

## Blockers / open questions
- None identified beyond the uncommitted working tree above.

## Last verified
2026-07-05: confirmed via `git status --short` (dirty, origin/main tracked, no remote
divergence checked) and README.md/package.json read. No app run or feature test
performed this session.
