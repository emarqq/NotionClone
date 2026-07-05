# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-user, self-hosted Notion replacement ("Notion Clone") — a Next.js 15 App Router app over local Supabase (Postgres + pgvector), with a block editor, page hierarchy, and a RAG AI assistant that runs on a local LLM (Ollama) behind a swappable provider interface. `docs/ARCHITECTURE.md` is the authoritative design doc (schema, provider interface, RAG pipeline, phase plan) — read it before non-trivial work.

## Commands

```bash
npm run dev          # dev server on :3000 (Turbopack) — live-reloads source edits
npm run build        # production build → .next
npm run start        # serve the production build (defaults :3000; desktop uses -p 3777)
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
```

There is **no test framework** in this repo. Verification is `npm run typecheck` + `npm run lint` + driving the app manually (see the Phase 1 checklist in `docs/ARCHITECTURE.md`). After schema/persistent-state changes, restart the server/reset the store before testing — stale state repeatedly masquerades as bugs.

### Supabase (local stack)

Schema lives **only** in `supabase/migrations/` — never make dashboard-only changes (the project pushes to hosted later via `supabase db push` with zero drift).

```bash
supabase start           # boot local stack (needs colima/docker running)
supabase db reset        # re-apply all migrations + seed.sql (School/Work spaces)
```

Local-env quirks: the `supabase` CLI is installed via tarball (not brew); colima needs `DOCKER_HOST=unix://…/.colima/default/docker.sock`; **`supabase db reset` wipes the Supabase Auth user** (re-create the login after a reset); migrations must include explicit `GRANT`s (local images ship no default grants).

### Desktop app — seeing your changes (important gotcha)

The macOS "Notion Clone.app" is an **Electron shell** (`desktop/electron/src/main.js`) that loads `http://127.0.0.1:3777` — a **production** server (`next start`) serving the last `next build`. It is a *different surface* from the `:3000` dev server. The Electron startup only rebuilds when `.next/BUILD_ID` is missing, so an existing build is reused as-is. **Source edits appear live on `:3000` but NOT in the desktop app until you rebuild and restart `:3777`:**

```bash
lsof -ti tcp:3777 | xargs kill      # stop old prod server
npm run build                        # rebuild with your changes
nohup npx next start -p 3777 &       # restart
# then reload (Cmd-R) or reopen ~/Applications/Notion Clone.app
```

Do **not** run `npm run build` while the `:3000` dev server is running — both write `.next` and can corrupt each other; stop dev first. The build output `desktop/electron/dist/` is regenerable (`npm run dist` from `desktop/electron/`) and is gitignored. See `desktop/README.md`.

## Architecture (the big picture)

- **Server-first Next.js.** App Router with React Server Components + Server Actions. Mutations are server actions in `app/actions/*` (pages, editor, ai, meetings) calling data-access functions in `lib/db/*`; those are **server-only** (`createServiceSupabase`, service-role key) and must never be imported into client components. Auth/session runs in `middleware.ts` → `lib/supabase/middleware.ts`.

- **`blocks` table is the source of truth for editor content** — one row per top-level Tiptap/ProseMirror node (paragraph, heading, toggle, table…); inline rich text (bold, links, mentions) stays as a ProseMirror JSON fragment in that row's `content` column. This block-level granularity is what makes per-block AI edits, backlinks, and partial saves work. Don't collapse pages to a single JSONB doc.

- **Fractional indexing** (`lib/positions.ts`, string keys like `a0`, `a0V`, `position` columns `COLLATE "C"`) orders pages and blocks so drag-and-drop never mass-reindexes.

- **LLM behind a registry** (`lib/llm/`): `registry.ts` resolves the active chat + embedding providers from `app_settings` → env → `ollama` default. Chat and embeddings are configured **independently** (swap the chat model freely; changing the embedding model forces a full re-embed + `vector(768)` migration). Providers (`providers/ollama.ts`, `providers/custom-finetune/`, optional `anthropic`) are called **only from server-side API routes**, never the browser.

- **RAG pipeline** (`lib/rag/`): on page save (debounced via `after()` in save/rename/move actions) and file upload, content is chunked (heading-aware, ~400 tok, breadcrumb-prefixed, `content_hash` diffed so unchanged chunks aren't re-embedded) into the unified `chunks` table. Queries go through the `hybrid_search` Postgres RPC (top-20 FTS + top-20 cosine fused with Reciprocal Rank Fusion) — shared by the AI panel and global search. `POST /api/ai/chat` streams SSE; the retrieved-sources list is **always** rendered independent of the model's `[n]` citation markers.

- **AI edits are propose-only — a hard rule.** `POST /api/ai/edit` and the editor's AI tools render a diff overlay (ProseMirror decorations / `AIProposalCard`); nothing is written until the user explicitly Accepts, which dispatches one editor transaction into the normal debounced save. The route provably never writes (verified by block-hash snapshots). Never make an AI path auto-commit.

- **Client UI shell**: tab system is a Zustand store (`components/tabs/`, `kh-tabs` localStorage) in `components/app-shell/AppShell.tsx` with in-app back/forward; sidebar (`components/sidebar/`) renders the space/page tree, Favorites, and Recents; the shared three-dot page menu is `components/page-actions/PageActionsMenu.tsx` (used by tree rows, flat Favorites/Recents rows, and the in-page meta bar — keep them identical). Editor lives in `components/editor/`, AI panel (⌘J) in `components/ai-panel/`.

## Conventions & pitfalls

- **Migrations only** for schema; keep them replayable (`supabase db reset` must apply cleanly with the seed).
- **Tiptap 2.27** — the BubbleMenu is built in; do **not** add `@tiptap/extension-bubble-menu` (that's v3).
- Ingestion has no manual delete path — page/file deletes cascade to `blocks`/`chunks`/`links` via `on delete cascade` FKs.
- Known limitation: the default 8B local model can hallucinate on sparse sources; the always-visible sources list is the mitigation.
