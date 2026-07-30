# Project Status

> Updated automatically by Claude Code at the end of each session (enforced by the Stop hook).
> Do not let this go stale — if it looks stale, the hook isn't wired up correctly.

**Last updated:** 2026-07-30
**Overall completion:** ~76% (ARCHITECTURE.md Phases 1–3 reached except the global search UI. **All four HIGH-severity defects a sandboxed session could reach are now fixed** — E1, E3, L1 and R1 — and roadmap C4 is written but its migration is unverified. Roughly half of FEATURE-PLAN.md remains. `docs/plan/ROADMAP.md` is the authoritative queue; percentages here are a rough feel, not a measure.)

> **The number to actually worry about is not this one.** There is still **no proven backup**
> of the local database (roadmap A1). Every other line in this file describes an improvement
> to something that could still be lost in one command.

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
- [x] **Test suite** — Vitest, `npm test`. **175 tests** (146 pass, 29 Docker-gated), up from 101 on 2026-07-26. The three files added on 2026-07-30 each pin a *specific historical data-loss bug*: `tests/db/replacePageBlocks.test.ts` (§E1 remint, §E6 delete scoping), `tests/llm/timeout.test.ts` (§L1, incl. that a slow-but-alive stream is NOT killed), `tests/api/aiChatStream.test.ts` (§R1), plus `tests/db/searchArchived.test.ts` (§R5, Docker-gated). Originally 101 tests (100 pass, 1 skip-guard) across the LLMProvider contract (all providers + a fake), the `hybrid_search` RPC against a disposable Postgres, the Stop hook's block/allow/bypass paths, the block-id parse rule, and the export walker. See "Testing" below.
- [x] **Cross-page block-id theft fixed** *(new 2026-07-29, CODE_REVIEW §E1)* — `replacePageBlocks` (`lib/db/blocks.ts`) now checks incoming ids against `blocks.page_id` and remints a fresh uuid for any id owned by another page, instead of silently re-parenting (and thereby deleting) the row out of its source page. `saveBlocksAction` returns the `{old→new}` remap; `Editor.tsx` rewrites the affected `blockId` attrs back into the doc via an out-of-history transaction so the next save doesn't remint again. Same pass replaced the string-concatenated `NOT IN` delete filter (CODE_REVIEW §E6, an injection-shaped query) with an explicit chunked id-list delete scoped to `page_id`.
- [x] **Deadlines on every LLM / embedding fetch** *(new 2026-07-30, CODE_REVIEW §L1, roadmap C1)* — `lib/llm/timeout.ts`. Both providers' `chatStream` / `generate` / `embed` / `healthCheck` now carry an `AbortSignal` that fires after a budget (30 s generation, 15 s embedding, 5 s health check, all env-overridable; `0` opts out). `EmbeddingProvider.embed()` takes a signal — an interface change — and `retrieve()` forwards the request's signal. For **streams the deadline is idle, not total**: refreshed on every chunk, so a long generation is never truncated (D-010).
- [x] **Partial assistant replies survive a mid-stream provider failure** *(new 2026-07-30, CODE_REVIEW §R1, roadmap C2)* — the failure is held instead of rethrown, whatever streamed is persisted tagged `_(response incomplete — <reason>)_`, and the SSE `error` event carries `partial` + `retryable` so the panel says the partial was saved and offers **Ask again**.
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
> Two long-standing entries here were **wrong** and have been removed — see the session log. E1 and E3 were fixed 2026-07-29; L1 and R1 on 2026-07-30 — all four are under "What's actually built".
>
> **No HIGH-severity defect remains that a sandboxed session can fix.** Everything left in this list needs the Mac: the live database, the running app, or the Electron logs.

- **Switching the embedding model silently mixes vector spaces (HIGH).** `reconcileChunks` diffs on `content_hash` only and never checks `embedding_model`. CODE_REVIEW.md §R2.
- `healthCheck()` and `capabilities()` are fully implemented on both providers but have **zero call sites**; there is no health endpoint. `capabilities()` also returns a hardcoded `contextWindow: 8192` regardless of the configured model.
- `components/editor/OutlinePanel.tsx:47` scans h1–h3 only, so H4 headings — which the slash menu can insert — never appear in the outline.
- **No proven backup of the local database (HIGHEST).** Roadmap A1. The script, launchd plist and restore drill are written out in `docs/audit/SUPABASE-PRO-LEVERAGE.md` §5 and none of it is installed. A `db reset` on 2026-07-07 already destroyed a whole space.
- **`replacePageBlocks` is still not transactional.** Upsert → delete → touch is three round-trips; a failure between them resurrects deleted blocks as phantoms. Roadmap A4, `CODE_REVIEW.md` §E4 — needs a Postgres function, so a Mac session.
- **A Cmd-W landing inside a save round-trip can lose the last keystrokes.** The unmount/`pagehide` flush is a no-op while a save is in flight, because starting a second overlapping save is BUG-2. Closes with B1 + B2, not by removing the guard. See `docs/BUILD_LOG.md`.
- **`archivePage` archives one page; the markdown exporter treats archiving as a subtree.** A child of an archived parent is filed under `Archive/` by the exporter but still retrieved by the assistant. Needs a decision on which semantics wins (my default: subtree).
- **Every save still rewrites every block's position**, defeating the fractional indexing that exists. Typing one character on a 200-block page writes 200 rows and retriggers four background jobs. Roadmap B1, `CODE_REVIEW.md` §E5.
- ~~Archived pages are retrieved and cited by the assistant~~ — **fix written, migration UNVERIFIED** (`supabase/migrations/20260730000000_exclude_archived_from_search.sql`, roadmap C4). The SQL has never been parsed by Postgres and its 11 tests self-skip without Docker. Do not treat this as done until a Mac session applies it on the scratch container.
- `docs/FEATURE-PLAN.md` is stale — items 1, 2, 3, 7, and 9 are marked "not started" but have shipped.
- Ollama was not running during this session, so the RAG/chat paths were not exercised live (the fire-and-forget ingest logged `failed to reach http://localhost:11434`, as expected).

## Next concrete action
**Install the backup system and run the restore drill** (roadmap A1; script, plist and drill already written in `docs/audit/SUPABASE-PRO-LEVERAGE.md` §5). This is a Mac-session task and it outranks everything else in the queue, including verifying C4's migration: an unbacked-up database makes every other improvement provisional. Record the drill result in `docs/BUILD_LOG.md` — until that line exists, assume there are no backups.

Then, in order: apply C4's migration on the **scratch** container and unskip its tests; A4 (transactional reconcile); A5 (root-cause "it keeps crashing" from the real Electron logs, rather than assuming it is all the `:3777` stale-build trap).

## Testing

```bash
npm test          # vitest run  (175 tests: 146 pass, 29 skip without Docker)
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
- **Schema lives only in `supabase/migrations/`.** All 9 migrations as of 2026-07-26 were verified to replay cleanly from scratch on a disposable container. **The 10th (`20260730000000_exclude_archived_from_search.sql`, 2026-07-30) has NOT been verified** — it was written from a sandboxed session with no Postgres. Never run `supabase db reset` on the real stack (see the CAUTION in CLAUDE.md) — use `supabase migration up` with Erik's explicit consent, or a scratch container.
- **The desktop app is a stale-build trap.** `~/Applications/Notion Clone.app` loads a *production* server on :3777, not the :3000 dev server. Kill :3777, `npm run build`, restart to see changes.
- **Repo-local tooling**: `.claude/hooks/enforce-status-update.sh` is a Stop hook that blocks ending a session with a dirty tree unless STATUS.md was touched (bypass: `touch /tmp/.skip-status-check`). `.claude/agents/codebase-architect.md` is a read-only architecture-explainer subagent.

## Session log

### 2026-07-30 — autonomous session 3 (Cowork, sandboxed; 6 commits on `claude/overnight-2026-07-26`)
Picked up a 67-minute-stale lock and an uncommitted working tree from a session that died mid-item; reviewed the inherited diff, judged it a complete and correct implementation of roadmap A2/A3, and finished it rather than stashing it. Then closed the two remaining sandbox-reachable HIGH defects.

- `e61e823` **A2/A3/§E6** — cross-page block-id theft (server-side remint, D-007), the overlapping-save race (in-flight mutex + save sequence), and the injection-shaped concatenated delete filter.
- `3a5fcf8` 15 tests pinning `replacePageBlocks`, the most dangerous function in the repo and previously untested.
- `6bde50f` **C1/§L1** — deadlines on every LLM and embedding fetch. Streams get an *idle* deadline (D-010) so long answers are not truncated. `EmbeddingProvider` gained its first contract suite.
- `69f3c3e` **C2/§R1** — a partial answer now survives a mid-stream provider failure, tagged and retryable (D-011).
- `cff7583` **C4/§R5** — archived pages excluded from both search RPCs (D-012). **Migration UNVERIFIED.**
- `748bf72` + this entry — docs, and two sandbox toolchain workarounds recorded in `docs/BUILD_LOG.md` so no future session loses an hour to them (the Mac's `node_modules` breaks vitest on Linux; the repo mount forbids `unlink`, so git leaves stale `*.lock` files).

Then reviewed the session's own diff adversarially before closing it out, which found **seven real defects in the code just committed** — including a 0 ms retry storm the A3 save guard had introduced, a retry that forked a second conversation, and a retry that duplicated the user's question. Fixed in `995f5e3` and `3ae04c1`. Two findings were deliberately left alone and written up in `docs/BUILD_LOG.md`: the in-flight-save window on Cmd-W (closes with B1+B2; **do not fix it by removing the serialization guard**) and the pre-existing per-page vs subtree disagreement between `archivePage` and the exporter.

Decisions D-010, D-011, D-012 written to `docs/00_DECISION_LOG.md`. Nothing was escalated to Erik — every open question this session was an engineering one.

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
