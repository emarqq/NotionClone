# Build Log

> Append-only. Newest at the bottom. Write **STARTED** when you begin a work item and
> **FINISHED** when it is committed — never batch entries at the end of a session,
> because the session may be cut off mid-item. The last STARTED without a matching
> FINISHED is where the next session resumes.
>
> Format: `## YYYY-MM-DD HH:MM UTC — [STARTED|FINISHED|BLOCKED] — <item>` then details.

---

## 2026-07-29 06:00 UTC — STARTED — Overnight revival session (Cowork, sandboxed)

**Context.** Erik's directive: the app "is not the app I'm looking for"; target is *all
of Notion*; run autonomously overnight; research, audit, plan, then build; keep the
data; set up docs so autonomy is possible; add a usage-limit watchdog scheduled task.
Follow-up directive: be hyper-critical of the existing code *and* of previously proposed
features — "this project is a little bit in shambles, and I need you to revive it."

**Environment.** Cowork sandboxed Linux VM. `node`/`npm` available and working;
**no docker, no supabase CLI, no psql, no pg_dump, no access to the running servers.**
Per brief §3, all DB-touching and UI-driving work this session is deferred to a Mac
session and queued below.

**Session-limit note.** This session already hit one usage limit at ~01:20 local.
Three research subagents were cut off mid-flight; one
(`docs/audit/SUPABASE-PRO-LEVERAGE.md`, 46 KB) completed and survived. The other two
must be re-run.

### FINISHED — Supabase Pro research
`docs/audit/SUPABASE-PRO-LEVERAGE.md`. Read-only inspection of the real Supabase
account plus a Free-vs-Pro breakdown. Headline conclusions:
- **No hosted project currently holds NotionClone's data** — it is local-only, and
  therefore still entirely unbacked-up.
- Recommendation: **stay local-primary, add hosted off-site backup.** Hosted-primary
  would put 30–90 ms of internet in the middle of a server-first app that currently
  answers in ~1 ms, and would break offline use.
- A complete nightly `pg_dump` script, launchd plist, sanity gate and restore-drill
  script are written out in §5 of that document, ready to install.

### FINISHED — Autonomy infrastructure
- `docs/AUTONOMOUS_RUN_BRIEF.md` — the operating contract. Safety rails, the lock
  protocol, the per-environment capability matrix, the `:3777` rebuild trap, the
  current top-priority defect table, and the "evolve, don't rewrite" stance.
- `docs/BUILD_LOG.md` — this file.
- `docs/00_DECISION_LOG.md` — authoritative decision record.

---

## Needs a Mac session
> Work that is written and compiles, but could not be exercised from the sandbox.
> A Claude Code session on the Mac should pick these up and verify them.

- [ ] Install and run the backup system (`docs/audit/SUPABASE-PRO-LEVERAGE.md` §5):
      nightly `pg_dump`, launchd plist, **and the restore drill**. Until the drill has
      run once, this project has no proven backup. **Highest priority of anything here.**
- [ ] Capture a real baseline: page/block/chunk row counts, so the backup sanity gate's
      floor can be tuned and so any future data loss is detectable.

## Blocked — needs Erik
_(nothing yet)_

---

## 2026-07-29 15:05 UTC — STARTED — Session 2 (Cowork, sandboxed): author the missing ROADMAP, then start the defect queue

**Lock.** Previous lock timestamp was `2026-07-29T14:38:06Z`, 27 min stale at pickup →
previous session died without committing (`git status` clean apart from an untracked
`.claude/settings.local.json`). Lock taken at `2026-07-29T15:05:02Z`.

**Environment.** Cowork sandboxed Linux VM. `node v22.22.3` / `npm 10.9.8` present;
`docker`, `psql`, `supabase` all absent; no access to `:3000`/`:3777`. Per brief §3 this
session ships code + unit tests only; anything DB- or UI-exercised is queued below.

**Gap found on orientation.** `docs/plan/ROADMAP.md` **did not exist**, despite being
referenced as the authoritative work queue by `docs/AUTONOMOUS_RUN_BRIEF.md` §1/§7 and by
decision D-006. The 06:00 session was cut off before writing it. Every subsequent session
would have had no queue to pull from, so writing it is item 1.

**Roadmap authored.** `docs/plan/ROADMAP.md` (committed in `1275785`) plus
`docs/audit/NOTION-FEATURE-MATRIX.md`. Phases A–E + M, with the ordering principle
*stop losing data → stop crashing → remove the structural ceiling → close the parity gaps
Erik hits daily → everything else*, and an explicit **Cut** section so no later session
re-adds sharing/multiplayer/hosted-primary/Notion-sync from the stale planning docs.

---

## 2026-07-30 01:04 UTC — STARTED — Session 3 (Cowork, sandboxed): land A2/A3, then the Phase C queue

**Lock.** Previous timestamp `2026-07-29T23:57:38Z`, **67 min stale** at pickup → the
previous session died mid-item without committing. Lock taken at `2026-07-30T01:04:34Z`.

**Inherited working tree.** Four modified files, uncommitted:
`lib/db/blocks.ts`, `app/actions/editor.ts`, `components/editor/Editor.tsx`, `STATUS.md`.
Reviewed the full diff before touching anything: it is a complete, coherent
implementation of **A2** (server-side block-id remint, exactly as decided in D-007) and
**A3** (in-flight mutex + monotonic save sequence), plus **§E6** (the
string-concatenated `NOT IN` delete filter replaced with a chunked explicit id list).
It matches the roadmap and the decision log rather than diverging from them, so the call
is **finish it, not stash it** (brief §1 step 5).

**Environment.** Cowork sandboxed Linux VM. `node v22.22.3` / `npm 10.9.8`;
no `docker`, no `psql`, no `supabase`, no access to `:3000`/`:3777`.

**Toolchain note — `npm test` was broken in the sandbox and is now unblocked.**
`node_modules/` is shared over the mount and was installed on the Mac, so it carries
only `@rolldown/binding-darwin-arm64`; vitest 4 loads rolldown natively and died with
`MODULE_NOT_FOUND: ./rolldown-binding.linux-arm64-gnu.node`. Fixed **without touching the
repo** by installing `@rolldown/binding-linux-arm64-gnu@1.1.5` into a sandbox-local
`node_modules` on a parent path (`/sessions/<id>/node_modules`), which Node's upward
resolution finds from `node_modules/rolldown/dist/shared/`. Nothing in the repo or in
Erik's install changed. **Any future sandboxed session must redo this one-liner** or it
will wrongly conclude the test suite is unrunnable and skip rule §4:
```bash
mkdir -p /sessions/<session>/node_modules && cd /tmp && npm init -y \
  && npm i @rolldown/binding-linux-arm64-gnu@1.1.5 \
  && cp -r node_modules/@rolldown /sessions/<session>/node_modules/
```
