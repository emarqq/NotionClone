# Project Status

> Updated automatically by Claude Code at the end of each session (enforced by the Stop hook).
> Do not let this go stale — if it looks stale, the hook isn't wired up correctly.

**Last updated:** 2026-07-26
**Overall completion:** ~70% (ARCHITECTURE.md Phases 1–3 reached except global search UI and block drag-reorder; roughly half of FEATURE-PLAN.md remains, and three of those features exist only on unmerged branches)

## What's actually built
- [x] **Auth + session** — email/password login (`app/login/page.tsx`), session refresh and redirect-to-login in `middleware.ts` → `lib/supabase/middleware.ts`, RLS policies on all 11 tables.
- [x] **Page tree & hierarchy** — recursive tree to arbitrary depth (`components/sidebar/PageTree.tsx`, `PageRow.tsx`), full HTML5 drag-and-drop with nest-as-child vs reorder-as-sibling drop zones, descendant-cycle and cross-space rejection (`components/sidebar/dnd.ts`), fractional indexing so drags never mass-reindex (`lib/positions.ts`).
- [x] **Page CRUD & metadata** — create/rename/archive/delete/duplicate/move/move-to-space, favorites, recents, icons (curated ~100-icon Lucide set in `lib/icons.tsx`), cover images with drag-to-reposition (`app/actions/pages.ts`, `components/page-actions/PageActionsMenu.tsx`).
- [x] **Block editor** — Tiptap 2.27 with 13 block types persisted one row per top-level node (`components/editor/blockSync.ts`). Custom extensions: callout, toggle (hand-rolled, avoids Tiptap Pro), block-id assignment, Alt+↑/↓ block move, scoped select-all, autocorrect. Working slash menu, bubble menu with "Turn into", tables, task lists, image paste → upload.
- [x] **RAG pipeline end-to-end** — heading-aware ~400-token chunking with breadcrumb prefixes (`lib/rag/chunker.ts`), content-hash diffing so unchanged chunks are never re-embedded (`lib/rag/ingest.ts`), `hybrid_search` RPC (FTS + cosine, RRF-fused at k=60), retrieval → SSE streaming chat (`app/api/ai/chat/route.ts`).
- [x] **AI panel (⌘J)** — streaming chat with abort, conversation history load/delete, space filter, `[n]` citation chips **plus** an always-rendered sources list independent of the model emitting markers (`components/ai-panel/MessageBubble.tsx`).
- [x] **AI editing tools — propose-only** — 5 tools (summarize/format/organize/rewrite/continue) render a word-level diff overlay; Accept applies one editor transaction into the normal debounced save. Verified: `app/api/ai/edit/route.ts` contains no DB writes.
- [x] **LLM provider abstraction** — `lib/llm/registry.ts` resolves chat and embedding providers independently from `app_settings` → env → `ollama`. Both `ollama` and `custom-finetune` (OpenAI-compatible) fully implement the interface; neither is a stub.
- [x] **File attachments + extraction** — upload with 50 MB cap and orphan cleanup, signed-URL refresh, inline image/PDF preview, extractors for PDF (unpdf), DOCX (mammoth), XLSX (SheetJS).
- [x] **Tabs & app shell** — Zustand persisted tab store with navigate-in-tab, drag reorder, per-tab scroll and back/forward stacks; resizable sidebar and AI panel; ⌘T/⌘W/⌘1–9/⌘\/⌘[/⌘]/⌘J.
- [x] **Meeting notes** — `createMeetingNoteAction` seeds an 8-block template (Details / Attendees / Agenda / Notes).
- [x] **Theme system** — light/dark/system with no-flash hydration, accent color pickers, WCAG contrast foregrounds (`lib/theme/color.ts`). Client-only, persisted to `localStorage`.
- [x] **Electron desktop shell** — `desktop/electron/`, loads a production build on :3777.

## What's in progress
- [ ] **Inline comments** — UI entry point exists but is deliberately disabled (`components/editor/AIToolsMenu.tsx:281`, "Comments are coming soon"). Backend (`comment_threads`, `comments`, `app/api/comments/route.ts`) is written but lives only on the `feat/inline-comments` branch.
- [ ] **Links / mentions / backlinks** — the `links` table has existed since the initial migration but has zero reads or writes on main. `lib/links/extract.ts`, the mention and link Tiptap extensions, and `components/backlinks/Backlinks.tsx` exist only on `feat/inline-comments` / `feat/markdown-export`. **A half-merged import of `Backlinks` currently breaks the build — see Known issues.**
- [ ] **Notion-style database pages** — `app/actions/databases.ts`, `components/database/*`, and the `db_*` tables exist only on `feat/database-pages`, but that migration has already been applied to the local Postgres.
- [ ] **Markdown export / import** — `app/api/export`, `app/api/import`, and the `EXPORT_VAULT_DIR` / `EXPORT_ENABLED` / `IMPORT_SOURCE_DIR` env vars documented in `.env.example` are branch-only; nothing on main reads those vars.

## What's not started (but planned)
- [ ] **Global search UI** — `ARCHITECTURE.md` §5 plans `app/search/`; it does not exist. `hybrid_search` is currently called only by the RAG retriever, never by a search box.
- [ ] **Settings route** — `app/settings/` for switching LLM/embedding providers by writing `app_settings`. Only an appearance modal exists; `app_settings` has no write path or UI.
- [ ] **Block drag-reorder in the editor** — Phase 1 checklist item 4. Blocks move only via Alt+↑/↓; there is no drag handle (zero `drag` references in `components/editor/`).
- [ ] **Anthropic provider** — `lib/llm/providers/anthropic.ts` is planned in ARCHITECTURE §2/§5 and absent.
- [ ] **Non-Ollama embedding provider** — the registry's embedding factory map has only `ollama`, so setting `EMBEDDING_PROVIDER` to anything else silently falls back.
- [ ] **Tags UI** — `tags` and `page_tags` tables exist and are entirely unused.
- [ ] **Archive/trash browsing** — pages can be archived but never listed or restored.
- [ ] **Sign-out / account menu** — no sign-out control exists anywhere in the UI.
- [ ] **Google Calendar integration** (FEATURE-PLAN item 10), equation blocks, columns, code-block syntax highlighting.
- [ ] **Re-embed / migration script** for changing the embedding model (would force a `vector(768)` schema change).
- [ ] **Life OS surface** — `projects` / `goals` / `goal_checkins` / `study_items` tables were created this session (migration `20260726000000_life_os_schema.sql`); no app code reads or writes them yet.

## Known issues / broken right now
- **`main` does not typecheck or build.** `app/(workspace)/[spaceSlug]/[pageId]/page.tsx:2` imports `@/components/backlinks/Backlinks`, which does not exist on main — it came over from a feature branch in commit `8819988` without its component. Confirmed via `npx tsc --noEmit`. This breaks the page route, so `npm run build` and therefore the desktop app cannot be refreshed.
- **Local Postgres is ahead of `main`'s migrations.** `supabase_migrations.schema_migrations` shows `inline_comments`, `graph_rag_neighbor_search`, and `database_pages` applied, but those `.sql` files are not on main. A `supabase db reset` while on main would silently drop `comments`, `comment_threads`, and all `db_*` tables.
- **10 commits unpushed** to `origin/main`; three feature branches (`feat/inline-comments`, `feat/markdown-export`, `feat/database-pages`) are unmerged and stacked, the largest at +8.8k lines.
- `lib/db/pages.ts:405 getAllPages()` is exported and referenced by zero code on main (orphan of the same half-merge).
- `components/editor/OutlinePanel.tsx:47` scans h1–h3 only, so H4 headings — which the slash menu can insert — never appear in the outline.
- `healthCheck()` is implemented on both LLM providers but never called anywhere; there is no health endpoint.
- `docs/FEATURE-PLAN.md` is stale — items 1, 2, 3, 7, and 9 are marked "not started" but have shipped.

## Next concrete action
Restore `components/backlinks/Backlinks.tsx` from `feat/inline-comments` (or remove the import at `app/(workspace)/[spaceSlug]/[pageId]/page.tsx:2`) so `npx tsc --noEmit` passes again.

## Architecture notes
- **Server-first Next.js 15 App Router.** Mutations are server actions in `app/actions/*` calling data-access functions in `lib/db/*`. Those use the service-role key and are server-only — never import them into a client component.
- **`blocks` is the source of truth for editor content**, one row per top-level ProseMirror node, with inline rich text left as a PM JSON fragment in that row's `content`. This is what makes per-block AI edits and partial saves possible. Do not collapse a page into one JSONB doc. Note that `blocks.parent_block_id` exists but is always written `null` — nesting lives inside the parent's `content` JSON, not as separate rows.
- **Fractional indexing** (`lib/positions.ts`, `position` columns `COLLATE "C"`) orders pages and blocks so drag-and-drop never mass-reindexes.
- **LLM access goes through `lib/llm/registry.ts`**, which resolves chat and embedding providers independently. Providers are called only from server-side API routes, never the browser. Changing the embedding model forces a full re-embed plus a `vector(768)` migration.
- **AI edits are propose-only — a hard rule.** `/api/ai/edit` and the editor AI tools render a diff; nothing is written until the user Accepts. Never make an AI path auto-commit.
- **Schema lives only in `supabase/migrations/`.** No dashboard-only changes — the local stack must stay reproducible from `supabase db reset` + `seed.sql`. Migrations need explicit `GRANT`s (the local images ship no default grants), and a reset wipes the Supabase Auth user.
- **The desktop app is a stale-build trap.** `~/Applications/Notion Clone.app` is an Electron shell loading a *production* server on :3777, not the :3000 dev server. Source edits appear on :3000 but not in the desktop app until you kill :3777, `npm run build`, and restart.
- **Repo-local tooling** (added 2026-07-26): `.claude/hooks/enforce-status-update.sh` is a Stop hook that blocks ending a session with a dirty tree unless STATUS.md was touched (bypass: `touch /tmp/.skip-status-check`). `.claude/agents/codebase-architect.md` is a read-only architecture-explainer subagent.

## Session log
- 2026-07-26 — Set up project tracking: added this STATUS.md, the `enforce-status-update.sh` Stop hook + `.claude/settings.json`, the `codebase-architect` subagent, and the Life OS schema as migration `20260726000000_life_os_schema.sql` (applied to local Postgres). Audited the codebase to fill in the sections above; found that main does not typecheck. No features built. (Claude Code, main session + Explore subagent)
