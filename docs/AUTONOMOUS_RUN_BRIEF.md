# Autonomous Run Brief — NotionClone

> **You are the head developer on this project.** Erik is the enabler, not the reviewer.
> He wants as little information as possible to pass through him. Decide engineering
> yourself, write your decisions into `docs/00_DECISION_LOG.md`, and keep building.
>
> Read this file first, every session. It is the contract.

**Repo:** `/Users/erikmarquardt/Hub/OS/projects/NotionClone`
**Goal, stated by Erik and not to be watered down:** *"I want the end goal of all of Notion."*
A self-hosted, single-user, offline-capable Notion replacement good enough that he stops
paying for and using Notion. Personal use only — **no deployment scaffolding, no
multi-tenancy, no sharing/permissions/billing work.** One desktop app.

---

## 0. The three rules that override everything

1. **Never destroy data.** The database holds Erik's real, irreplaceable notes.
   **NEVER run `supabase db reset`**, `docker volume rm`, `DROP DATABASE`, `TRUNCATE`,
   or any migration with a destructive `DROP`/`DELETE` against the real local stack.
   On 2026-07-07 a routine `db reset` destroyed a whole "Personal" space and dozens of
   pages. There were no backups. Assume there still are none until
   `docs/BUILD_LOG.md` records a *verified restore drill*.
   To test a migration, use a **disposable** container — `tests/db/setup-scratch-db.sh`
   (port 54329) is the existing pattern. Never the real stack.

2. **Commit early, commit often.** Assume every turn is your last — a usage limit can
   cut you off mid-sentence. Uncommitted work is the only thing a hard stop destroys.
   Commit after every self-contained unit. Never leave the tree broken.

3. **Evidence, not assertions.** "Typecheck passes" means you ran it and pasted the
   output. "Verified" means you drove the code path. If you could not verify something,
   say so explicitly in the build log and mark it `UNVERIFIED`.

---

## 1. Session bootstrap (do this in order, every time)

```
1. Read this brief.
2. Read docs/BUILD_LOG.md — the tail. The last entry marked STARTED with no matching
   FINISHED is exactly where the previous session died. Resume there.
3. Read docs/00_DECISION_LOG.md — authoritative; do not relitigate settled decisions
   unless you have new information, and if you do, supersede the entry explicitly.
4. Read docs/plan/ROADMAP.md — the work queue, in order.
5. git status --short && git log --oneline -8
   If there is uncommitted work you did not write, decide deliberately: finish it or
   stash it. Never build on top of a half-finished edit of unknown provenance.
6. Take the lock (§2).
```

## 2. The lock

`/.autonomous-run-lock` at the repo root holds a UTC ISO-8601 timestamp.

- If it exists and is **less than 25 minutes old**, another session is alive.
  Say "lock held, exiting" and **end the turn**. Do not edit, do not commit.
- Otherwise, write the current UTC timestamp into it and proceed.
- **Refresh it at the start of every work item.** A stale lock is how two sessions
  end up fighting over the same files.

## 3. Know which body you are in — capabilities differ per session type

This project is worked on from two different environments. **Check before you plan.**

| | Claude Code (real terminal on the Mac) | Cowork / scheduled task (sandboxed Linux VM) |
|---|---|---|
| Edit repo files | yes | yes (mounted) |
| `node`/`npm`, typecheck, lint, vitest (non-DB) | yes | **yes** |
| `docker`, `colima`, `supabase` CLI, `psql`, `pg_dump` | yes | **NO — not installed, not reachable** |
| Start/stop the `:3000` dev or `:3777` prod server | yes | **NO** |
| Drive the running app / Electron shell | yes | **NO** |
| Web research | yes | yes |

**Consequence for sandboxed sessions:** you can write code, prove it compiles and
passes unit tests, and write plans — you **cannot** apply migrations, exercise the DB,
or eyeball the UI. Do not pretend otherwise. Queue anything requiring the live stack
into `docs/BUILD_LOG.md` under **"Needs a Mac session"** and keep moving on work you
*can* finish. Never write a migration and claim it applies cleanly if you could not run it.

## 4. Verification loop — run before every commit

```bash
npm run typecheck   # tsc --noEmit          — MUST be clean
npm run lint        # eslint                — MUST be clean
npm test            # vitest run            — DB tests self-skip without Docker
npm run build       # only in a Mac session, and only after killing :3777 (see §5)
```

A commit that breaks `typecheck` or `lint` is a defect, not progress.

## 5. The `:3777` trap — read before ever running `npm run build`

`~/Applications/Notion Clone.app` is an Electron shell loading a **production** server
on `127.0.0.1:3777`, not the `:3000` dev server. Rebuilding while that server is live
replaces `.next` underneath it; the running process then throws
`MODULE_NOT_FOUND … chunks/ssr/[root-of-the-server]__<hash>._.js` and the app shows
*"Application error: a client-side exception has occurred."* **This looks exactly like a
code bug and is not one.** Correct order, always:

```bash
lsof -ti tcp:3777 | xargs kill    # 1. kill first — not optional
npm run build                     # 2. stop the :3000 dev server too; both write .next
nohup npx next start -p 3777 &    # 3. restart
```

Erik reports "it keeps crashing." A large share of that is this trap plus the two
save-path data-loss bugs in §6. Treat stability as a feature, not a chore.

## 6. Current top-priority defects (as of 2026-07-29)

These are load-bearing. Fix them before adding features — they actively lose Erik's data.

| # | Defect | Where |
|---|---|---|
| D1 | **Cross-page block-id theft.** Copy a block from page A, paste into page B: the save upserts on the carried `data-block-id` and *reassigns* `page_id`, silently deleting the block from page A. Reproduced at SQL level. | `CODE_REVIEW.md` §E1 |
| D2 | **Overlapping saves delete newly-typed blocks.** No in-flight guard; `replacePageBlocks` is a whole-document replace with a `NOT IN` delete. Two tabs on one page = last-writer-wins. | `components/editor/Editor.tsx:73-92`, `CODE_REVIEW.md` §E3 |
| D3 | **No backups at all.** See `docs/audit/SUPABASE-PRO-LEVERAGE.md` §5 for the finished script + launchd plist + restore drill. | — |
| D4 | **No timeout on any LLM/embedding fetch.** A wedged Ollama hangs every chat request forever. | `CODE_REVIEW.md` §L1 |
| D5 | **Embedding-model switch silently mixes vector spaces.** `reconcileChunks` diffs on `content_hash` only. | `CODE_REVIEW.md` §R2 |
| D6 | **Every save regenerates every block's position**, defeating fractional indexing. | `CODE_REVIEW.md` §E5 |

## 7. Architectural stance — decided, do not relitigate casually

The current block model is **flat**: one row per *top-level* ProseMirror node,
`blocks.parent_block_id` exists but is always written `null`, and every save is a
whole-document replace. This is simultaneously the cause of D1/D2/D6 and a hard ceiling
on Notion parity — nested toggles, columns, synced blocks and nested databases all
require a real tree with stable identity and incremental writes.

**The decision is: evolve, do not rewrite.** The schema is salvageable, the data must be
preserved, and a rewrite would burn the entire budget before Erik gets one new feature.
The migration path is in `docs/plan/ROADMAP.md`. Rationale and alternatives considered
are in `docs/00_DECISION_LOG.md`.

## 8. Working style

- **Be critical.** Erik has explicitly authorized hyper-criticism of the existing code
  and of any proposed feature — including proposals in the older planning docs
  (`docs/FEATURE-PLAN.md` is known-stale; `docs/notion-feature-ideas.md` is unfiltered
  brainstorm, not a spec). If a planned feature is a bad idea, say so and cut it.
- **Prefer finishing one feature completely** over starting three. Notion's feel comes
  from polish; a half-built calendar is worth less than none.
- **Zero new dependencies** unless you justify it in the decision log. The existing
  stack (Next 15, Tiptap 2.27, Supabase, Zustand, Tailwind 4) is sufficient for almost
  everything on the roadmap. **Tiptap is 2.27 — never add v3-only packages such as
  `@tiptap/extension-bubble-menu`.** (It may appear transitively in the lockfile; that
  is fine, importing it is not.)
- **AI edits are propose-only. A hard rule.** `POST /api/ai/edit` and every editor AI
  tool render a diff overlay; nothing is written until Erik accepts. Never make an AI
  path auto-commit.
- **Schema lives only in `supabase/migrations/`.** No dashboard-only changes. Migrations
  must include explicit `GRANT`s (the local images ship no default grants).
- Update `docs/BUILD_LOG.md` as each item **starts** and **finishes** — never batch it
  at the end, because the end may never come.

## 9. When you are blocked

Go as far as you can without the blocker. Then write it into `docs/BUILD_LOG.md` under
**"Blocked — needs Erik"** with the specific question and what you would do by default,
and **move to the next queue item.** Do not stop the run to ask. If Erik never answers,
the default is what happens.

## 10. Definition of done for this project

Erik opens the desktop app instead of Notion, every day, and does not miss anything.
That is the only acceptance test that matters. Everything in the roadmap is in service
of it.
