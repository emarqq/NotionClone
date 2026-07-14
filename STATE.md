# STATE — notion-clone
> Rewritten each session, never appended. History lives in AIHub vault/runs/.

## Status
Next.js 15 app over local Supabase (Postgres + pgvector). Block editor (Tiptap) with
nested page tree, RAG assistant (local Ollama), markdown export/vault mirror, document
importer. NEW: **database pages Phase 1** on branch `feat/database-pages` — any page can
turn into a Notion-style database (child pages = rows, 7 typed property columns, table
view). Design doc: `~/.claude/plans/fable-database-noble-tulip.md`; architecture record:
docs/ARCHITECTURE.md addendum 2026-07-14.

## Now / Next
- Review + merge `feat/database-pages` (branched off `feat/markdown-export`, NOT main —
  main is ~25 commits behind and lacks export/comments/linking).
- Phase 2 of the database plan: side-peek row panel (AI-panel pattern; plan §Phase 2).
- Then Phase 3 (views/filter/sort/column layout), Phase 4 board, Phase 5 calendar.

## Recent decisions
- 2026-07-13: database schema fork resolved with Erik — **rows are pages** (Option A);
  dedicated `db_property_options` table (tags/page_tags left untouched — they're inert);
  zero new dependencies; non-destructive turn-into both ways (idempotent view seeding).
- 2026-07-14: "unset property value" = DELETE the value row, never write null
  (`value jsonb not null` + PostgREST null mapping).
- 2026-07-14: Editor's BubbleMenu placeholder needs a dedicated wrapper div — tippy
  reparents it, and top-level placement crashes React's deletion pass on in-place
  editor↔database swaps (see Editor.tsx comment).

## Failed approaches
- `tippyOptions.appendTo: () => document.body` does NOT fix the BubbleMenu unmount
  crash — the reparented node's fiber parent is what matters, not the tippy root's home.

## Blockers / open questions
- Electron shell itself not eyeballed (production `:3777` build verified via browser;
  Erik should ⌘R the desktop app — the new build is already serving on :3777).
- Phase-1 scope cuts listed in the ARCHITECTURE addendum (no peek/views/option-manage UI).

## Last verified
2026-07-14: database pages Phase 1 verified end-to-end on web :3000 AND production :3777
build — clean migration replay (7 migrations + seed) on a disposable supabase/postgres
scratch container, `supabase migration up` applied live with consent (62 real pages
intact); turn-into round-trips ×3 (idempotent, 1 view row); all 7 property types
persisted with correct jsonb shapes; duplicate copies schema not rows; row bodies
auto-RAG-indexed with `Space > DB > Row` breadcrumb; option-delete sweep leaves 0
dangling ids; database delete cascades everything to zero; dark mode + shortcut set
clean; typecheck + lint pass. Test data fully removed (DB + vault).
