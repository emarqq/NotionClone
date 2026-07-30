# Project Status

> Updated automatically by Claude Code at the end of each session (enforced by the Stop hook).
> Do not let this go stale — if it looks stale, the hook isn't wired up correctly.

**Last updated:** 2026-07-29
**Overall completion:** ~74% (ARCHITECTURE.md Phases 1–3 reached except the global search UI; block drag-reorder now shipped, and the two HIGH-severity editor data-loss bugs (E1, E3) are fixed. Roughly half of FEATURE-PLAN.md remains. The three previously-unmerged feature branches are now merged into `main`.)

## What's actually built
- [x] **Auth + session** — email/password login (`app/login/page.tsx`), session refresh and redirect-to-login in `middleware.ts` → `lib/supabase/middleware.ts`, RLS policies on **all 21 tables** (the last four were added 2026-07-26).
- [x] **Page tree & hierarchy** — recursive tree to arbitrary depth (`components/sidebar/PageTree.tsx`, `PageRow.tsx`), full HTML5 drag-and-drop with nest-as-child vs reorder-as-sibling drop zones, descendant-cycle and cross-space rejection (`components/sidebar/dnd.ts`), fractional indexing so drags never mass-reindex (`lib/positions.ts`).
- [x] **Page CRUD & metadata** — create/rename/archive/delete/duplicate/move/move-to-space, favorites, recents, icons (curated ~100-icon Lucide set in `lib/icons.tsx`), cover images with drag-to-reposition (`app/actions/pages.ts`, `components/page-actions/PageActionsMenu.tsx`).
- [x] **Block editor** — Tiptap 2.27 with 13 block types persisted one row per top-level node (`components/editor/blockSync.ts`). Custom extensions: callout, toggle (hand-rolled, avoids Tiptap Pro), block-id assignment, Alt+↑/↓ block move, scoped select-all, autocorrect. Working slash menu, bubble menu with "Turn into", tables, task lists, image paste → upload.
- [x] **Block drag-reorder** *(new 2026-07-26)* — `components/editor/extensions/drag-handle.ts`. Hovering a top-level block shows a ⠿ grip in the left gutter; dragging reorders it. The drop is delegated to ProseMirror (`view.dragging = { slice, move: true }`) so it is one undoable transaction and obeys schema rules; the drop indicator is StarterKit's built-in dropcursor. Verified end-to-end in the running app.
- [x] **RAG pipeline end-to-end** — heading-aware ~400-token chunking with breadcrumb prefixes (`lib/rag/chunker.ts`), content-hash diffing so unchanged chunks are never re-embedded (`lib/rag/ingest.ts`), `hybrid_search` RPC (FTS + cosine, RRF-fused at k=60), retrieval → SSE streaming chat (`app/api/ai/chat/route.ts`).
- [x] **AI panel (⌘J)** — streaming chat with abort, conversation history load/delete, space filter, `[n]` citation chips **plus** an always-rendered sources list independent of the model emitting markers (`components/ai-panel/MessageBubble.tsx`).
- [x] **AI editing tools — propose-only** — 5 tools (summarize/format/organize/rewrite/continue) render a word-level diff overlay; Accept applies one editor transaction into the normal debounced save. Re-verified this session: `app/api/ai/edit/route.ts` has no Supabase import at all.
- [x] **LLM provider abstraction** — `lib/llm/registry.ts` resolves chat and embedding providers independently. Both `ollama` and `custom-finetune` (OpenAI-compatible) fully implement the interface; neither is a stub — now pinned by a shared contract test suite.
- [x] **Inline comments** — `comment_threads` / `comments` + `app/api/comments/route.ts`, merged to main.
- [x] **Links / mentions / backlinks** — `lib/links/extract.ts`, the mention/link Tiptap extensions and `components/backlinks/Backlinks.tsx` are on main and wired into the page route.
- [x] **Notion-style database pages** — `app/actions/databases.ts`, `components/database/*`, `db_*` tables (Phase 1: rows-are-pages, 7 property types, table view).
- [x] **Markdown export / import** — `app/api/export`, `app/api/import`, vault mirror via `EXPORT_VAULT_DIR`.
- [x] **File attachments + extraction** — upload with 50 MB cap and orphan cleanup, signed-URL refresh, inline image/PDF preview, extractors for PDF (unpdf), DOCX (mammoth), XLSX (SheetJS).
- [x] **Tabs & app shell** — Zustand persisted tab store with navigate-in-tab, drag reorder, per-tab scroll and back/forward stacks; resizable sidebar and AI panel; ⌘T/⌘W/⌘1–9/⌘\/⌘[/⌘]/⌘J.
- [x] **Meeting notes** — `createMeetingNoteAction` seeds an 8-block template (Details / Attendees / Agenda / Notes).
- [x] **Theme system** — light/dark/system with no-flash hydration, accent color pickers, WCAG contrast foregrounds (`lib/theme/color.ts`).
- [x] **Electron desktop shell** — `desktop/electron/`, loads a production build on :3777.
- [x] **Test suite** *(new 2026-07-26)* — Vitest, `npm test`. 101 tests (100 pass, 1 skip-guard) across the LLMProvider contract (all providers + a fake), the `hybrid_search` RPC against a disposable Postgres, the Stop hook's block/allow/bypass paths, the block-id parse rule, and the export walker. See "Testing" below.
- [x] **Cross-page block-id theft fixed** *(new 2026-07-29, CODE_REVIEW §E1)* — `replacePageBlocks` (`lib/db/blocks.ts`) now checks incoming ids against `blocks.page_id` and remints a fresh uuid for any id owned by another page, instead of silently re-parenting (and thereby deleting) the row out of its source page. `saveBlocksAction` returns the `{old→new}` remap; `Editor.tsx` rewrites the affected `blockId` attrs back into the doc via an out-of-history transaction so the next save doesn't remint again. Same pass replaced the string-concatenated `NOT IN` delete filter (CODE_REVIEW §E6, an injection-shaped query) with an explicit chunked id-list delete scoped to `page_id`.
- [x] **Overlapping-save data loss fixed** *(new 2026-07-29, CODE_REVIEW §E3)* — `Editor.tsx`'s `flush()` now guards against concurrent saves with `savingRef`/`saveSeqRef`: at most one `saveBlocksAction` in flight, stale responses are ignored by sequence number, `dirty` clears only if the doc hasn't changed since the snapshot was taken, and edits that arrive mid-save are flushed immediately on completion instead of waiting for another keystroke.

## What's in progress
- [ ] **Life OS surface** — `projects` / `goals` / `goal_checkins` / `study_items` exist and now have RLS matching every other table, but **no app code reads or writes them yet**.

## What's not started (but planned)
- [ ] **Global search UI** — `ARCHITECTURE.md` §5 plans `app/search/`; it does not exist. `hybrid_search` is still called only by the RAG retriever, never by a search box. (Its behaviour is now test-covered, so a UI can be built against a known-good RPC.)
- [ ] **Tags UI** — `tags` and `page_tags` tables exist and are entirely unused (zero reads or writes).
- [ ] **Settings route** — `app/settings/` for switching LLM/embedding providers by writing `app_settings`. Only an appearance modal exists. Note `app_settings.llm_provider_id` / `embedding_provider_id` are **read** by the registry but never **written** anywhere, so that resolution tier is currently unreachable except via manual SQL.
- [ ] **Anthropic provider** — `lib/llm/providers/anthropic.ts` is planned in ARCHITECTURE §2/§5 and absent. `tests/llm/fakeProvider.ts` is the reference implementation to build it against.
- [ ] **Non-Ollama embedding provider** — the registry's embedding factory map has only `ollama`, so setting `EMBEDDING_PROVIDER` to anything else silently falls back (confirmed at `lib/llm/registry.ts:16-18,54`).
- [ ] **Archive/trash browsing** — pages can be archived but never listed or restored.
- [ ] **Sign-out / account menu** — no sign-out control exists anywhere in the UI.
- [ ] **Google Calendar integration** (FEATURE-PLAN item 10), equation blocks, columns, code-block syntax highlighting.
- [ ] **Re-embed / migration script** for changing the embedding model — now more urgent, see CODE_REVIEW R2.

## Known issues / broken right now
> Two long-standing entries here were **wrong** and have been removed — see the session log. Two more (E1, E3) were fixed 2026-07-29 — see "What's actually built".

- **No timeout on any LLM/embedding fetch (HIGH).** A wedged Ollama hangs every `/api/ai/chat` request forever, because retrieval → `embed()` runs first and `EmbeddingProvider.embed()` takes no signal. CODE_REVIEW.md §L1.
- **A partial assistant reply is lost if the provider errors mid-stream (HIGH).** CODE_REVIEW.md §R1.
- **Switching the embedding model silently mixes vector spaces (HIGH).** `reconcileChunks` diffs on `content_hash` only and never checks `embedding_model`. CODE_REVIEW.md §R2.
- `healthCheck()` and `capabilities()` are fully implemented on both providers but have **zero call sites**; there is no health endpoint. `capabilities()` also returns a hardcoded `contextWindow: 8192` regardless of the configured model.
- `components/editor/OutlinePanel.tsx:47` scans h1–h3 only, so H4 headings — which the slash menu can insert — never appear in the outline.
- Archived pages are still retrieved and cited by the AI assistant (no `is_archived` filter in either search RPC). CODE_REVIEW.md §R5.
- `docs/FEATURE-PLAN.md` is stale — items 1, 2, 3, 7, and 9 are marked "not started" but have shipped.
- Ollama was not running during this session, so the RAG/chat paths were not exercised live (the fire-and-forget ingest logged `failed to reach http://localhost:11434`, as expected).

## Next concrete action
E1 is resolved (server-side fix, as recommended). Decide on CODE_REVIEW.md §L1 next (no timeout on any LLM/embedding fetch — a wedged Ollama hangs `/api/ai/chat` forever) — specifically whether `EmbeddingProvider.embed()` should take an `AbortSignal`, since that's an interface change touching both providers.

## Testing

```bash
npm test          # vitest run  (101 tests)
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run build     # next build
```

- `tests/db/*` talks to a **disposable** Postgres container (`tests/db/setup-scratch-db.sh`, port 54329), never the real local stack — those tests INSERT rows. The suite **skips** rather than fails when Docker isn't running.
- `vitest.config.ts` aliases `server-only` to that package's own `empty.js` so server modules import cleanly under Node without weakening the guard in the app build.

## Architecture notes
- **Server-first Next.js 15 App Router.** Mutations are server actions in `app/actions/*` calling data-access functions in `lib/db/*`. Those use the service-role key and are server-only. The client/server boundary was audited this session and is **clean** — every client-side `lib/db` reference is an `import type`.
- **`blocks` is the source of truth for editor content**, one row per top-level ProseMirror node, with inline rich text left as a PM JSON fragment in that row's `content`. Do not collapse a page into one JSONB doc. `blocks.parent_block_id` exists but is always written `null`.
- **Fractional indexing** (`lib/positions.ts`, `position` columns `COLLATE "C"`) orders pages and blocks. Note the editor currently regenerates *every* block's position on *every* save (CODE_REVIEW §E5), which undercuts this.
- **LLM access goes through `lib/llm/registry.ts`**, which resolves chat and embedding providers independently. An unrecognized provider id is **silently** replaced by the fallback with no log (`registry.ts:54`).
- **AI edits are propose-only — a hard rule.** Never make an AI path auto-commit.
- **Schema lives only in `supabase/migrations/`.** Verified this session that all 9 migrations replay cleanly from scratch on a disposable container. Never run `supabase db reset` on the real stack (see the CAUTION in CLAUDE.md) — use `supabase migration up` with Erik's explicit consent, or a scratch container.
- **The desktop app is a stale-build trap.** `~/Applications/Notion Clone.app` loads a *production* server on :3777, not the :3000 dev server. Kill :3777, `npm run build`, restart to see changes.
- **Repo-local tooling**: `.claude/hooks/enforce-status-update.sh` is a Stop hook that blocks ending a session with a dirty tree unless STATUS.md was touched (bypass: `touch /tmp/.skip-status-check`). `.claude/agents/codebase-architect.md` is a read-only architecture-explainer subagent.

## Session log

### 2026-07-29 — E1/E3 editor fixes (uncommitted, branch `claude/overnight-2026-07-26`)
Implemented the server-side fix for CODE_REVIEW §E1 recommended in the prior session's "Next concrete action": `replacePageBlocks` (`lib/db/blocks.ts`) now detects incoming block ids already owned by another page and remints them instead of re-parenting the row, closing the cross-page-paste data-loss hole; `saveBlocksAction`/`Editor.tsx` plumb the id remap back into the live ProseMirror doc. Same pass fixed §E3 (concurrent-save race that could delete newly typed blocks) with an in-flight/sequence guard in `Editor.tsx`, and §E6 (injection-shaped string-concatenated delete filter) with a chunked explicit-id-list delete. Verified `npm run typecheck` (clean) and `npm test` (82 passed, 19 skipped — Docker-dependent, expected) before writing this entry. Changes are in the working tree, **not yet committed**.

### 2026-07-26/27 — unattended overnight run (branch `claude/overnight-2026-07-26`, 4 commits, NOT merged)

**Summary.** Cleared the Phase 0 blockers, audited and lightly cleaned the codebase, stood up the project's first test suite, reviewed the three load-bearing subsystems, and shipped block drag-reorder verified end-to-end in the running app. Two long-standing STATUS.md claims turned out to be false and were corrected. The most important output is not code: it's **CODE_REVIEW.md §E1**, a verified, silent data-loss path in ordinary copy-paste.

**Deliberately deferred, and why:**
- **The severe editor fixes (E1/E3/E4).** All three are real, but each changes block *identity* or save *concurrency* semantics, and E1's obvious client-side fix would orphan comment anchors on drag. Wrong things to decide unattended.
- **Phase 3 features #2 (tags) and #3 (global search UI).** Stopped after #1 rather than leaving three half-built. #3 is now well-positioned: `hybrid_search` has test coverage, so a UI can be built against a known-good RPC.
- **The structural items in REORG_NOTES.md §3** — four API routes bypassing `lib/db`, the registry's silent fallback, SlashMenu/MentionMenu sharing. Each needs a naming/behaviour decision.

**Needs Erik's decision before I'd touch it again:**
1. CODE_REVIEW §E1 — cross-page block-id theft (recommendation in "Next concrete action").
2. CODE_REVIEW §L1 — what timeout is right for the LLM/embedding fetches, and whether `EmbeddingProvider.embed()` should take a signal (an interface change).
3. REORG_NOTES §3.2 — should an unrecognized provider id log, throw, or stay silent?
4. REORG_NOTES §3.1 — whether to add the missing `lib/db` functions and rewrite the four API routes that query Supabase directly.

**Per phase:**
- **Phase 0** (`24b341c`) — The reported build break **was already fixed** by merge `6a0d1c5`; `tsc` and `build` both exit 0, no code change needed. Added migration `20260726100000_life_os_rls.sql` giving `projects`/`goals`/`goal_checkins`/`study_items` the same blanket `authenticated` policy as every other table (they were the only four with `relrowsecurity = false`); applied with `supabase migration up`, 86 pages intact. **No `REVOKE … FROM anon` was issued** — that instruction was conditional on no other table granting anon access, and in fact all 21 tables carry the identical base-image grants (anon holds no DML anywhere), so revoking would have *created* drift. Hardened `enforce-status-update.sh`: replaced the `awk '{print $2}'` parser with `git status --porcelain -z`, fixing a path-with-spaces truncation and a rename that reported the *source* path (so `git mv DRAFT.md STATUS.md` blocked incorrectly); both bugs reproduced against the old parser first.
- **Phase 1** (`7ff1dde`) — Wrote REORG_NOTES.md before touching anything. Client/server boundary audited: **clean, zero violations**. Removed 2 confirmed-dead symbols (`listMarkdownFiles`, `PROPERTY_TYPE_LABELS`); extracted `lib/export/pmWalk.ts` (walker primitives were byte-identical across the three serializers) and `lib/format.ts`. Net −136/+12 lines, build verified after every batch. Kept `healthCheck()` despite being uncalled — it is specified interface surface with working implementations.
- **Phase 2** (`a198930`) — Coverage delta: **no test suite existed** → 101 tests. Added Vitest plus the LLMProvider contract suite, `hybrid_search` tests on a disposable container (incl. 10 hostile query strings proving `websearch_to_tsquery` can't be injected or crashed), and hook tests. CODE_REVIEW.md logs 19 findings. Fixed exactly one (E2, verified): a non-UUID `data-block-id` made the page's single batched upsert fail *as a whole*, silently breaking saves for every block on the page.
- **Phase 3** (`94dec9a`) — Shipped block drag-reorder. Verified in the running app against a scratch page: handle placement measured, two reorders persisted to Postgres with block IDs preserved, single-⌘Z undo, no console errors, no leaked handles across navigation. Scratch page and its vault mirror file fully removed afterwards (86 pages, 0 orphans).

**Branch left unmerged for review**, per instructions. `main` is unchanged and matches `origin/main`.
