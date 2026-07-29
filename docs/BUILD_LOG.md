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
