# Notion Clone

A single-user, self-hosted Notion replacement: a block editor + nested page tree across two spaces (School, Work), with a built-in RAG AI assistant that runs on a local LLM. Built with Next.js 15 (App Router) over a local Supabase stack (Postgres + pgvector), with the chat/embedding model swappable behind a provider interface.

The authoritative design doc is **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** (schema, provider interface, RAG pipeline, phase plan). For AI/agent contributors, see **[`CLAUDE.md`](CLAUDE.md)**.

## Prerequisites

- **colima + Docker** (the local Supabase stack runs in Docker). colima needs `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`.
- **Supabase CLI** (installed via tarball, not brew).
- **Ollama** (for the AI assistant) at `http://localhost:11434` with `llama3.1:8b` and `nomic-embed-text` pulled. The app runs fine without it; only the AI panel/search need it.

## Getting started

```bash
supabase start        # boot local Postgres/Supabase (colima must be running)
supabase db reset     # apply migrations + seed.sql (creates School & Work spaces)
npm install
npm run dev           # http://localhost:3000
```

> No login: the app has no authentication (removed 2026-08-04). It is single-user and
> self-hosted, so keep it bound to localhost — anyone who can reach the port has full access.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on **:3000** (Turbopack), live-reloads source edits |
| `npm run build` | Production build → `.next` |
| `npm run start` | Serve the production build (the desktop app runs this on `-p 3777`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

There is no test framework; verify with `typecheck` + `lint` + driving the app (Phase 1 checklist in `docs/ARCHITECTURE.md`).

## Desktop app & seeing your changes

`~/Applications/Notion Clone.app` is a macOS Electron shell (`desktop/electron/`) that boots colima → Supabase → a **production** Next.js server and loads **`http://127.0.0.1:3777`**. See [`desktop/README.md`](desktop/README.md).

**Important:** the `:3777` production server and the `:3000` dev server are different surfaces off the same repo. The desktop app serves the last `next build` and only rebuilds when `.next/BUILD_ID` is missing — so **source edits show up live on `:3000` but NOT in the desktop app until you rebuild and restart `:3777`:**

```bash
lsof -ti tcp:3777 | xargs kill      # stop the old production server
npm run build                        # rebuild with your changes
nohup npx next start -p 3777 &       # restart it
# then reload the app (Cmd-R) or reopen ~/Applications/Notion Clone.app
```

Don't run `npm run build` while the `:3000` dev server is running — both write `.next` and can corrupt each other; stop dev first. The Electron build output (`desktop/electron/dist/`) is regenerable and gitignored.
