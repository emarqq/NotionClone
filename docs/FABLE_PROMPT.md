# Handoff Prompt for Claude Fable 5 — NotionClone / "Knowledge Hub"

> Paste everything below the line into a fresh Claude Fable 5 session (`claude-fable-5`) running
> in this repo. It is written to be given **in one turn, up front** — Fable 5 does its best work
> when the full task specification arrives at once and it runs at `high`/`xhigh` effort. Recommended
> settings: effort `xhigh`, run in the repo root `/Users/erikmarquardt/NotionClone`.

---

## Context and intent

I'm building **Knowledge Hub**, a single-user, local-first Notion replacement I run on my own Mac.
It is a personal tool, not a product for distribution. I want it to be fast, keyboard-driven, and
fully offline (local Supabase + local Ollama). I was mid-implementation on two features when I ran
out of usage for the day; both are uncommitted WIP that has **not** been run through the compiler or
exercised in the browser yet. Your job is to verify, fix if needed, and finish these two features so
I can use them, then leave the repo in a clean, committed state.

**Tech stack (already in place):** Next.js 15.5 (App Router + Turbopack) · React 19 · TypeScript ·
Tailwind v4 · Tiptap 2.27 (ProseMirror) · Supabase (local, `@supabase/ssr`) · Zustand ·
`fractional-indexing` · Ollama-based local LLM with pgvector RAG (`hybrid_search` RPC). Phases 1–3
(core workspace, RAG/search, AI assistant) are already built — see `docs/ARCHITECTURE.md`. The editor
stores one `blocks` row per top-level Tiptap node; ordering is fractional-indexed.

## Current state — two in-progress feature batches (already written, not yet verified)

### Batch 1 — Page hierarchy navigation
A new right-rail "Contents" navigator that replaces the old floating `OutlinePanel`, plus richer
breadcrumbs. Files involved:
- `lib/db/pages.ts` — new `getChildren(parentPageId)` and `getAncestors(pageId)` (root-first, cycle-guarded).
- `app/actions/pages.ts` — new `getChildrenAction` server action for lazy one-level expansion.
- `app/(workspace)/[spaceSlug]/[pageId]/page.tsx` — fetches ancestors + children, drops `OutlinePanel`,
  renders `ContentsPanel` + `SubPagesList`, passes `ancestors` to `PageMetaBar`.
- `components/page-meta/PageMetaBar.tsx` — full `Space › …ancestors… › current` breadcrumb with an
  overflow "…" dropdown past `MAX_VISIBLE_CRUMBS` (4).
- `components/editor/OutlinePanel.tsx` — repurposed into a plain "On this page" heading list to be
  embedded *inside* `ContentsPanel` (positioning/collapse/localStorage stripped out).
- `components/page-nav/ContentsPanel.tsx` (new) — viewport-fixed rail: parent link, lazily-expandable
  sub-page tree (fetches children on expand via `getChildrenAction`), "+ New sub-page" (`createPageAction`),
  embedded `OutlinePanel`. Offset by the AI panel width via `useAiPanelStore`; hidden below `xl`;
  open state persisted to `kh-contents-open`.
- `components/page-nav/SubPagesList.tsx` (new) — server-rendered in-body "Sub-pages" list.
- `components/sidebar/PageTree.tsx` — cosmetic indent guide on nested children.

### Batch 2 — Electron desktop app (`desktop/electron/`)
Replaces the old `launch.sh` Chrome-app-mode shim with a real macOS Electron app (ad-hoc signed).
- `desktop/electron/src/main.js` — main process: frameless splash with live status; ports the
  `launch.sh` boot sequence (colima → Supabase → `next start -p 3777`, building if `.next/BUILD_ID`
  is missing); spawns the Next server **detached + unref'd** so quitting the app leaves the backend
  running; polls up to 180s; persists window state; "Shut Down Backend & Quit" menu item runs
  `stop.sh --all`. Machine-specific paths are hardcoded on purpose (documented: `__dirname` resolves
  inside `app.asar` once packaged).
- `desktop/electron/package.json` — standalone package, electron 32 + electron-builder 25.
- `desktop/README.md`, `docs/ARCHITECTURE.md` — updated to document the Electron app.

Everything above appears internally coherent and wired up, but **none of it has been typechecked,
linted, or run.** Treat it as a first draft that needs to be proven.

## What I need you to do (in order)

1. **Prove the code compiles and lints.** Run `npm run typecheck` and `npm run lint`. Fix whatever
   is actually broken in the two batches above. Report the real command output — if something fails,
   show me the error and the fix; don't claim it passes without the output in front of you.
2. **Exercise the navigation feature in the browser** (start the app the normal way for this repo).
   Verify, against real UI: (a) the breadcrumb renders the full ancestor chain and the "…" overflow
   menu appears past 4 crumbs; (b) the right-rail Contents panel lazily expands sub-pages one level at
   a time; (c) "+ New sub-page" creates a child and it shows up; (d) the rail's horizontal offset
   tracks the AI panel open/closed state without overlapping. Note anything that looks wrong or
   redundant — the same children currently render both in-body (`SubPagesList`) and in the rail
   (`SubPageTree`); confirm that reads as intentional, not broken.
3. **Build and smoke-test the Electron app** end-to-end: `cd desktop/electron && npm install && npm run dist`,
   launch the produced `.app`, and confirm splash → backend boot → main window. Then confirm that
   quitting the app leaves the Next/Supabase backend running (that's the intended detached behavior).
4. **Leave the tree clean.** The `.gitignore` already excludes `desktop/electron/node_modules/` and
   `desktop/electron/dist/` — keep build artifacts out of git. Commit any fixes you make with clear
   messages. Do not push unless I ask.

## How I want you to work

- **When you have enough information to act, act.** Don't re-derive facts I've already given you or
  narrate options you won't take. If you're weighing a choice, recommend one — don't survey. (This
  doesn't apply to your thinking.)
- **Don't tidy or expand scope.** No refactors, no new abstractions, no defensive error handling for
  cases that can't happen, no "while I'm here" cleanups. Fix what's broken in these two batches and
  finish them — nothing more. If you spot something worth changing outside this scope, tell me and
  stop; don't do it.
- **Ground every progress claim in a tool result.** Before you tell me a gate passed or a feature
  works, point to the actual command output or UI state you observed. If tests fail, say so with the
  output. If you skipped a step, say that. Don't report "fixed" after a single clean run of something
  flaky — the Electron boot sequence in particular is timing-dependent.
- **When I'm asking a question rather than requesting a change, the deliverable is your assessment** —
  report findings and stop before touching files.
- **Delegate the parallel parts.** Typechecking, the browser verification, and the Electron build are
  fairly independent — run sub-agents concurrently where it saves wall-clock, and keep working while
  they run rather than blocking on the slowest one.
- **Keep a memory file.** Record any non-obvious thing you learn about this repo (a build quirk, a
  path that matters, a gotcha in the boot sequence) as you go, one lesson per note with a one-line
  summary, and consult it in future sessions. Don't save what the repo already documents.

Start by reading `docs/ARCHITECTURE.md` and the eight modified / four new files listed above, then
run the gates.
