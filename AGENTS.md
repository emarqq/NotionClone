# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

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

Quirks: CLI installed via tarball (not brew); colima needs `DOCKER_HOST=unix://…/.colima/default/docker.sock`; migrations must include explicit `GRANT`s (local images ship no default grants). (`db reset` also wipes the Supabase Auth user — no longer relevant since auth was removed.)

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

- **Server-first Next.js.** Mutations are server actions in `app/actions/*` (pages, editor, ai, meetings) calling data-access functions in `lib/db/*` — those are server-only (`createServiceSupabase`, service-role key) and must never be imported into client components.
- **There is no authentication — by design (2026-08-04).** No login page, no `middleware.ts`, no session. The app is single-user and self-hosted, and re-creating the Supabase Auth user after every `db reset` was pure friction for zero benefit. `createServiceSupabase()` (`lib/supabase/server.ts`) is the only Supabase client. **Do not reintroduce a login, an auth guard, or a session check unless Erik explicitly asks.** Nothing is scoped by user: no table has a `user_id`/`owner_id` and no policy references `auth.uid()`, so this changed no query semantics. The blanket `to authenticated using (true)` RLS policies stay in place (service role bypasses them; they still deny a stray anon-key PostgREST connection). Consequence to respect: **anyone who can reach the port has full access** — keep the servers bound to localhost and never expose `:3000`/`:3777` to a network.
- **`blocks` table is the source of truth for editor content** — one row per top-level Tiptap/ProseMirror node; inline rich text stays as a ProseMirror JSON fragment in that row's `content` column. This is what makes per-block AI edits, backlinks, and partial saves work — don't collapse pages to a single JSONB doc.
- **Fractional indexing** (`lib/positions.ts`, string keys, `position` columns `COLLATE "C"`) orders pages/blocks so drag-and-drop never mass-reindexes.
- **LLM behind a registry** (`lib/llm/registry.ts`): resolves chat + embedding providers independently from `app_settings` -> env -> `ollama` default (changing the embedding model forces a full re-embed + `vector(768)` migration). Providers are called only from server-side API routes, never the browser.
- **RAG pipeline** (`lib/rag/`): page save/file upload -> heading-aware chunking (~400 tok, breadcrumb-prefixed, content_hash diffed) into the `chunks` table. Queries go through the `hybrid_search` Postgres RPC (FTS + cosine, RRF-fused). `POST /api/ai/chat` streams SSE; retrieved-sources list is always rendered independent of the model's `[n]` citation markers.
- **Markdown import → editor blocks** (added 2026-08-04). `lib/import/markdownToDoc.ts` is a pure, dependency-free Markdown→ProseMirror-doc parser: the deliberate inverse of the one-way exporter `lib/export/serialize.ts` (read that switch before touching the parser — it is the spec, including the Obsidian `> [!note]` callout/toggle flavor and `[[wikilink]]`s). It is unit-tested by round-tripping the serializer (`tests/import/`). The UI side (`components/editor/markdownImport.ts`) deliberately imports **through an editor transaction, not a server write**: that way `BlockId` mints the UUID row ids, the normal debounced save persists it with fractional positions, the post-save hooks (RAG, links, vault export) fire, and Cmd-Z undoes it. Entry points: slash menu `/import` (at the caret) and PageActionsMenu → Import Markdown (appends; shown only when the mounted editor is editing that page — the menu also renders on sidebar rows for other pages). Note this is unrelated to `lib/import/importDoc.ts`, which ingests reference docs into RAG read-only and never creates blocks.
- **Meeting recording → transcript** (added 2026-08-04). Records mic + computer audio and appends a `You:`/`Them:` labeled transcript to the page it was started from. Setup + troubleshooting: `docs/MEETING-RECORDING.md`. The load-bearing decisions: capture is **one** `MediaRecorder` over a WebAudio `ChannelMergerNode` (mic → left, system → right) so both speakers share one clock and can't drift — `components/recording/capture.ts`, a non-React module singleton because a re-render must never tear down a live recording; `<RecordingBar />` mounts in `AppShell` **outside the route subtree** so navigating mid-meeting doesn't stop it. Audio bytes go through **route handlers, never server actions** (server actions cap bodies at 1 MB): 5-second chunks are appended to `raw.webm` under `RECORDINGS_DIR`, and `<uuid>/meta.json` on disk — not an in-memory map — is the source of truth, because Turbopack re-evaluates route modules on every edit. ffmpeg splits the channels; each is transcribed separately (channel provenance *is* the speaker label, so no diarization guessing) by whisper.cpp or the python whisper fallback behind `lib/transcribe/registry.ts`. Insertion reuses the markdown-import contract (`resolveInsertTarget` → one editor transaction → debounced save → Cmd-Z undoes it). **No migration — deliberately**: recordings are files, not rows.
- **Google Calendar connector** (added 2026-08-04). Local mirror of the user's Google calendars in three tables (`calendar_accounts`, `calendars`, `calendar_events`) — the month/week grid reads Postgres, not Google, on every render. Setup + troubleshooting: `docs/GOOGLE-CALENDAR.md`. The load-bearing decisions: incremental sync via Google's `syncToken` (`lib/calendar/sync.ts`), a `410 Gone` triggers an automatic wipe-and-refetch; **polling, not `events.watch` push**, because push needs a public HTTPS endpoint and this app stays bound to localhost on purpose. Every event this app writes is stamped `extendedProperties.private.notionCloneManaged=true` as the write-back loop guard, so inbound sync recognizes its own writes instead of re-importing them. All-day events are normalized exclusive→inclusive **once**, on the way in (`lib/calendar/normalize.ts`'s `resolveTimes()`) — render from `start_date`/`end_date`, never the UTC-midnight `starts_at`/`ends_at`. A manual category correction sets `category_source='manual'`, which is permanent — no later sync can reclassify it back. The note link (`calendar_events.page_id`) is `on delete set null`: deleting the note must never delete the calendar event.
- **AI edits are propose-only — a hard rule.** `POST /api/ai/edit` and editor AI tools render a diff overlay; nothing is written until the user explicitly Accepts (one editor transaction into the normal debounced save). Confirmed in code: `app/api/ai/edit/route.ts` — "Category-B AI editing tools: propose only, never writes to the database." Never make an AI path auto-commit.
- **Client UI shell**: tabs are a Zustand store (`components/tabs/`) in `components/app-shell/AppShell.tsx`; sidebar (`components/sidebar/`) renders space/page tree, Favorites, Recents; shared page menu is `components/page-actions/PageActionsMenu.tsx` (keep all call sites identical). Editor in `components/editor/`, AI panel (Cmd-J) in `components/ai-panel/`.

## Conventions & pitfalls

- Migrations only for schema; keep them replayable (must apply cleanly with seed against a fresh database) — but see the `supabase db reset` caution above: never verify this by resetting the user's real local stack.
- **Tiptap 2.27** — BubbleMenu is built in; do **not** add `@tiptap/extension-bubble-menu` (v3-only). Note: it may still appear transitively in package-lock.json — that's normal, not a violation.
- Ingestion has no manual delete path — deletes cascade to `blocks`/`chunks`/`links` via `on delete cascade` FKs.
- Known limitation: the default 8B local model can hallucinate on sparse sources; the always-visible sources list is the mitigation.
