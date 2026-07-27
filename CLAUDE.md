# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## What this is

A single-user, self-hosted Notion replacement — Next.js 15 App Router over local Supabase (Postgres + pgvector), with a block editor, page hierarchy, and a RAG AI assistant on a local LLM (Ollama) behind a swappable provider interface. `docs/ARCHITECTURE.md` is the authoritative design doc (schema, provider interface, RAG pipeline, phase plan) — read it before non-trivial work.

## Current state

@STATE.md

## Commands

```bash
npm run dev          # dev server on :3000 (Turbopack) — live-reloads source edits
npm run build        # production build -> .next
npm run start        # serve the production build (defaults :3000; desktop uses -p 3777)
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
```

No test framework in this repo. Verification is `typecheck` + `lint` + driving the app manually (Phase 1 checklist in `docs/ARCHITECTURE.md`). After schema/persistent-state changes, restart the server/reset the store before testing — stale state repeatedly masquerades as bugs.

### Supabase (local stack)

Schema lives **only** in `supabase/migrations/` — never make dashboard-only changes (pushes to hosted later via `supabase db push` with zero drift).

```bash
supabase start           # boot local stack (needs colima/docker running)
supabase db reset        # re-apply all migrations + seed.sql (School/Work spaces)
```

> [!CAUTION]
> **NEVER run `supabase db reset` (or any other command that drops/recreates the local database) without asking the user first and getting an explicit yes, every single time — no exceptions for "just verifying a migration."** This database holds the user's real, un-backed-up notes. There is no automatic backup: local Time Machine is not configured on this machine, there is no dangling Docker volume left behind, and there is no `pg_dump`/WAL archive anywhere. A reset run on 2026-07-07 during routine migration verification destroyed a "Personal" space and dozens of pages across Work/School with no way to recover the actual written content — only page titles survived, and only because they happened to be cached in the Electron app's local tab-history storage. To verify a new migration applies cleanly, either ask the user to confirm a reset is safe, or — preferably — spin up a disposable throwaway Postgres/Supabase instance (e.g. a second `supabase` project directory, or apply the migration SQL directly against a scratch database) instead of touching the project's real local stack.

Quirks: CLI installed via tarball (not brew); colima needs `DOCKER_HOST=unix://…/.colima/default/docker.sock`; **`db reset` wipes the Supabase Auth user** (re-create the login after a reset); migrations must include explicit `GRANT`s (local images ship no default grants).

### Desktop app — seeing your changes (hard gotcha)

The macOS "Notion Clone.app" is an **Electron shell** (`desktop/electron/src/main.js`) loading `http://127.0.0.1:3777` — a **production** server (`next start`) serving the last `next build`, not the `:3000` dev server. Electron only rebuilds when `.next/BUILD_ID` is missing, so a stale build is reused silently. Source edits appear live on `:3000` but **not** in the desktop app until rebuilt:

```bash
lsof -ti tcp:3777 | xargs kill      # stop old prod server
npm run build                        # rebuild with your changes (stop the :3000 dev server first — both write .next)
nohup npx next start -p 3777 &       # restart
# then reload (Cmd-R) or reopen ~/Applications/Notion Clone.app
```

> [!WARNING]
> **The kill-first order is not optional — never run `npm run build` while the :3777 server is live.**
> A running `next start` holds content-hashed chunk paths from the build it booted with. Rebuilding
> replaces `.next` underneath it, so those files vanish and the server starts throwing
> `MODULE_NOT_FOUND: Cannot find module '.next/server/chunks/ssr/[root-of-the-server]__<hash>._.js'`
> (see `~/Library/Logs/NotionClone.log`). **Symptom in the app: a full page load 500s, and clicking
> into a page shows "Application error: a client-side exception has occurred."** It looks like a code
> bug but nothing is wrong with the code — the fix is to kill :3777 and `next start` again. Happened
> on 2026-07-27; diagnosed by comparing the server's start time against the `.next` chunk mtimes.

`desktop/electron/` is a separate npm package (own package.json/lockfile) — root `npm install` does not install its deps; see `desktop/README.md`.

## Architecture

- **Server-first Next.js.** Mutations are server actions in `app/actions/*` (pages, editor, ai, meetings) calling data-access functions in `lib/db/*` — those are server-only (`createServiceSupabase`, service-role key) and must never be imported into client components. Auth runs in `middleware.ts` -> `lib/supabase/middleware.ts`.
- **`blocks` table is the source of truth for editor content** — one row per top-level Tiptap/ProseMirror node; inline rich text stays as a ProseMirror JSON fragment in that row's `content` column. This is what makes per-block AI edits, backlinks, and partial saves work — don't collapse pages to a single JSONB doc.
- **Fractional indexing** (`lib/positions.ts`, string keys, `position` columns `COLLATE "C"`) orders pages/blocks so drag-and-drop never mass-reindexes.
- **LLM behind a registry** (`lib/llm/registry.ts`): resolves chat + embedding providers independently from `app_settings` -> env -> `ollama` default (changing the embedding model forces a full re-embed + `vector(768)` migration). Providers are called only from server-side API routes, never the browser.
- **RAG pipeline** (`lib/rag/`): page save/file upload -> heading-aware chunking (~400 tok, breadcrumb-prefixed, content_hash diffed) into the `chunks` table. Queries go through the `hybrid_search` Postgres RPC (FTS + cosine, RRF-fused). `POST /api/ai/chat` streams SSE; retrieved-sources list is always rendered independent of the model's `[n]` citation markers.
- **AI edits are propose-only — a hard rule.** `POST /api/ai/edit` and editor AI tools render a diff overlay; nothing is written until the user explicitly Accepts (one editor transaction into the normal debounced save). Confirmed in code: `app/api/ai/edit/route.ts` — "Category-B AI editing tools: propose only, never writes to the database." Never make an AI path auto-commit.
- **Client UI shell**: tabs are a Zustand store (`components/tabs/`) in `components/app-shell/AppShell.tsx`; sidebar (`components/sidebar/`) renders space/page tree, Favorites, Recents; shared page menu is `components/page-actions/PageActionsMenu.tsx` (keep all call sites identical). Editor in `components/editor/`, AI panel (Cmd-J) in `components/ai-panel/`.

## Conventions & pitfalls

- Migrations only for schema; keep them replayable (must apply cleanly with seed against a fresh database) — but see the `supabase db reset` caution above: never verify this by resetting the user's real local stack.
- **Tiptap 2.27** — BubbleMenu is built in; do **not** add `@tiptap/extension-bubble-menu` (v3-only). Note: it may still appear transitively in package-lock.json — that's normal, not a violation.
- Ingestion has no manual delete path — deletes cascade to `blocks`/`chunks`/`links` via `on delete cascade` FKs.
- Known limitation: the default 8B local model can hallucinate on sparse sources; the always-visible sources list is the mitigation.
