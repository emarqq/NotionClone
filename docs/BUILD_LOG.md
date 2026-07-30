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
- [ ] **Verify A2 end-to-end in the running app** (`e61e823`). Copy a whole block out of
      page A, paste it into page B, save, then confirm in SQL that **page A still has its
      row** and page B's copy carries a *different* id — and that a second save does not
      remint again (i.e. the `Editor.tsx` attr rewrite actually landed). Unit-tested
      against a fake PostgREST builder only; never run against Postgres.
- [ ] **Verify A3 in a browser** (`e61e823`). Type continuously for ~10 s on a page and
      confirm exactly one save is in flight at a time (network panel), that the indicator
      settles on "Saved", and that nothing typed during a save is lost.
- [ ] Housekeeping: `rm -f .git/*.stale.* .git/objects/*/tmp_obj_*` — orphaned temp files
      from sandboxed sessions, which cannot unlink (see the toolchain note above).
- [ ] **Apply and test `20260730000000_exclude_archived_from_search.sql`** (C4, `cff7583`).
      **This SQL has never been parsed by Postgres.** Run `bash tests/db/setup-scratch-db.sh`
      then `npm test` — `tests/db/searchArchived.test.ts` has 11 tests that currently
      self-skip. **Scratch container only (port 54329), never the real stack** (brief §1).
      Then re-check `docs/plan/ROADMAP.md` C4 from `[~]` to `[x]`.
- [ ] **Exercise C1's timeouts against a real wedged Ollama** (`6bde50f`). Unit tests use a
      stubbed hanging fetch; the thing worth confirming with the real server is that a
      genuinely long generation is *not* truncated by the idle deadline (D-010) — i.e. ask
      for something long and watch it finish. Also confirm `/api/ai/chat` now fails in ~30 s
      with `stop ollama` rather than hanging.
- [ ] **Exercise C2 in the app** (`69f3c3e`): start a chat, kill Ollama mid-answer, confirm
      the partial stays on screen, that "Ask again" works, and — the actual bug — that the
      partial is **still there after a browser refresh**, tagged `_(response incomplete …)_`.

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

**Second toolchain quirk — stale git `*.lock` files.** The repo mount permits `rename()`
but **not `unlink()`**, so every git command that updates a ref or the index leaves its
`HEAD.lock` / `index.lock` behind (`warning: unable to unlink … Operation not permitted`)
and the *next* git command dies with `Unable to create … File exists`. `rm` cannot clear
them either. Workaround: **rename them out of the way** — `mv HEAD.lock HEAD.lock.stale`
works where `rm` does not. A sandboxed session should put a wrapper in front of git:
```bash
for f in .git/*.lock .git/refs/heads/*.lock .git/logs/refs/heads/*.lock; do
  mv "$f" "$f.stale.$RANDOM" 2>/dev/null
done
```
Left `.git/*.stale.*` strays behind (unremovable from here, harmless). **A Mac session
should `rm -f .git/*.stale.* .git/*.tmp_obj_* .git/objects/*/tmp_obj_*` once** — there is a
pile of orphaned temp objects from earlier sandboxed sessions.

### FINISHED — A2 (BUG-1) + A3 (BUG-2) + §E6 — `e61e823`, tests in `3a5fcf8`

Both HIGH-severity editor data-loss paths are closed. Full rationale is in the commit
messages; the short version:

- **A2 / BUG-1 — cross-page block-id theft.** `replacePageBlocks` pre-checks every
  incoming id against `blocks.page_id` and **remints** any id owned by a different page
  rather than re-parenting the row. The `{old→new}` remap flows back through
  `saveBlocksAction` into `Editor.tsx`, which rewrites the `blockId` attrs in an
  out-of-history transaction — without that the editor keeps sending the stolen id and the
  row churns a new uuid on every save, detaching comment anchors as it goes. Server-side
  as decided in D-007.
- **A3 / BUG-2 — overlapping saves deleting newly-typed blocks.** In-flight mutex +
  monotonic save sequence; `dirty` now clears on *completion* and only if the doc is still
  the snapshot that was sent; edits arriving mid-save flush immediately. Two tabs on one
  page remains last-writer-wins — that needs B2's optimistic concurrency, not this.
- **§E6** — the `NOT IN` delete filter was built by interpolating ids into a quoted
  PostgREST list. Replaced with a chunked explicit id-list delete scoped to `page_id`, so
  it is now structurally incapable of touching another page's row.

**Evidence.** `npm run typecheck` clean, `npm run lint` clean, `npm test`:
```
 ✓ tests/hooks/enforceStatusUpdate.test.ts (17 tests)
 ✓ tests/llm/providerContract.test.ts (41 tests)
 ✓ tests/db/replacePageBlocks.test.ts (15 tests)
 ✓ tests/export/pmWalk.test.ts (12 tests)
 ✓ tests/editor/blockId.test.ts (11 tests)
 ✓ tests/db/hybridSearch.test.ts (20 tests | 19 skipped)
 Test Files  6 passed (6)
      Tests  97 passed | 19 skipped (116)
```
The 15 new tests run against `tests/db/fakeSupabase.ts`, a deliberately minimal in-memory
PostgREST stand-in that **throws on any chain it does not model** and refuses an
unfiltered delete, so a future refactor fails loudly instead of passing vacuously.

**`UNVERIFIED` against the real stack** (sandboxed session, brief §3): the remint path has
not been exercised against Postgres, and the `Editor.tsx` attr rewrite has not been driven
in a browser. Queued below.

### FINISHED — C1 (BUG-4) — `6bde50f`

Every LLM and embedding fetch now carries a deadline (`lib/llm/timeout.ts`). Applied
across both providers' `chatStream`, `generate`, `embed` and `healthCheck`, including the
custom-finetune health check's *two* requests (each gets its own budget) — and body reads
are inside the deadline, since `fetch()` resolves as soon as headers arrive and reading the
body is its own chance to hang.

**The judgment call, recorded as D-010:** for streams this is an **idle** deadline
refreshed per chunk — 30 s to the *next* token, not 30 s for the whole answer. A total cap
would truncate legitimate long generations, trading a visible hang for silent corruption of
an answer the user then trusts. A test asserts a slow-but-alive stream (150 ms of chunks
against a 60 ms budget) completes untouched.

Also: `EmbeddingProvider` had **no contract suite at all**, which is how a HIGH-severity
hang in the pre-first-token path survived three code reviews. It has one now.

`.env.example` is gitignored in this repo, so the three new env vars
(`LLM_TIMEOUT_MS`, `EMBEDDING_TIMEOUT_MS`, `LLM_HEALTHCHECK_TIMEOUT_MS`) are documented
there on Erik's disk and in D-010, not in a tracked file.

### FINISHED — C2 (§R1) — `69f3c3e`

A provider failure mid-stream used to rethrow, skipping persistence: the user watched
thirty tokens arrive and the whole assistant turn was gone after a refresh. Now the failure
is held, the partial is persisted tagged `_(response incomplete — <reason>)_`, and the SSE
`error` event carries `partial` + `retryable` so the panel reports that the partial was
saved and offers **Ask again** (which re-sends rather than resuming — D-011 explains why).

Deliberately no schema change; the marker convention already existed for aborts. D-011
records that if a `status` column is ever added, these markers should migrate into it
rather than both being maintained.

### FINISHED (code) / BLOCKED (verification) — C4 (§R5) — `cff7583`

`20260730000000_exclude_archived_from_search.sql` adds the `is_archived` filter to both
search RPCs, inside the candidate CTEs so a page with 30 archived chunks cannot crowd the
live chunk out of the fusion. File chunks attached to an archived page are excluded too;
unattached files are not (D-012). 11 tests written.

> **`UNVERIFIED`.** The SQL has never been parsed by Postgres and the 11 tests self-skipped
> — no docker/psql/supabase in this session (brief §3). Queued above. **Do not mark C4 done
> until that runs.**

---

## Session 3 summary — 2026-07-30 (Cowork, sandboxed)

Five commits: `e61e823`, `3a5fcf8`, `748bf72`, `6bde50f`, `69f3c3e`, `cff7583`.
Roadmap **A2, A3, C1, C2** closed; **C4** written but its migration unverified.
That is every remaining defect in the brief's table that a session without Docker or a
browser can actually finish — A1/A4/A5, B*, C3 and D4 all need the Mac.

**Test suite: 101 → 167 tests** (138 passing, 29 Docker-gated), and the three files added
all pin *specific historical data-loss bugs* rather than adding coverage for its own sake.

**What I did not do, and why.** I did not start Phase D. Phase A is not finished — A1
(backups) and A4 (transactional reconcile) are Mac-only, and A5 (the crash root-cause) needs
the running app and the Electron logs. Starting a feature while the highest-priority item in
the queue is "this project has no proven backup" would be the wrong call, and the roadmap's
gating clarification says a sandboxed session should work the 🧪 items and stop — which is
what happened.

**The single most valuable thing a Mac session can do next is A1.** Not C4's verification,
not A5. There is still no proven backup of Erik's notes; everything else is an improvement
to something that could vanish.

## Blocked — needs Erik
_(nothing — every decision this session was mine to make and is recorded in
`docs/00_DECISION_LOG.md` as D-010, D-011, D-012.)_

---

## 2026-07-30 01:40 UTC — FINISHED — Adversarial review of this session's own diff, and the seven defects it found

Ran an independent read-only review over `e61e823..HEAD` before calling the session done,
rather than trusting my own commits. **It found seven real defects in the code I had just
committed, one of which was a straight regression.** Worth recording as evidence that
review of a session's own output is not ceremony — the A3 concurrency guard in particular
introduced a worse bug than the one it fixed.

Fixed in `995f5e3` (editor) and `3ae04c1` (AI panel + providers):

1. **Unbounded 0 ms retry storm.** A3 correctly stopped clearing `dirty` on failure, but
   the `finally` rescheduled on `dirty` alone. A failing save therefore rescheduled itself
   immediately, failed, and repeated — a continuous round-trip-rate loop of server actions
   for as long as the failure lasted, while the UI claimed it would retry on the next edit.
   It also outlived unmount, since nothing cancels a timer installed after cleanup ran.
2. **Editor could stop saving permanently.** `savingRef` was claimed before the synchronous
   `blocksFromDoc`, which can throw; the flag would never clear and every later flush would
   return at the guard, indicator stuck on "Saving…".
3. Orphaned debounce timer (the `finally` overwrote `timerRef` without clearing it).
4. `applyBlockIdRemap` walked `descendants`, so a nested node sharing a reminted id was
   rewritten inside its parent's `content` JSON — a change that, because the transaction is
   tagged for `onUpdate` to ignore, would never be marked dirty and never saved.
5. **Retry forked a new conversation.** `lastSendRef` kept the pre-`meta` `conversationId`
   (null on a first turn), so "Ask again" created a second conversation and orphaned the one
   holding the partial answer the UI had just promised was saved.
6. **Retry duplicated the user turn** — and C2's own comment asserted it did not.
7. **The D-011 failure marker was fed back into the model's context**, so the model read its
   own previous answer as ending in a sentence about a fetch failure.

Plus: `describeFetchFailure` destroyed `err.name`, which broke `/api/ai/edit`'s
client-abort suppression and would have thrown `TypeError: Invalid state` out of its own
catch; `res.json()` timeouts were unlabelled; the NDJSON/SSE readers released the reader
lock without cancelling the body (a latent version of the very leak C1 exists to close);
and `send()`'s `isStreaming` guard is state and lags a task, so it was not real mutual
exclusion.

**The migration came out clean.** Reviewed by eye against both originals: the diff is
exactly the four primary-key `left join`s plus two predicates per CTE, the `returns table`
blocks are byte-identical (so `create or replace` is legal), no fan-out is possible, no new
ambiguous references, and filtering before `limit 20` is correct because window functions
evaluate after `WHERE`. Still **UNVERIFIED** — never executed.

### Two findings deliberately not fixed

- **Unmount/`pagehide` flush is a no-op while a save is in flight**, so Cmd-W inside one
  save round-trip can lose the last keystrokes. Firing a second overlapping save there is
  *exactly* BUG-2, so the serialization guard stays. The honest fix is B1 (diff-based
  writes, making the final flush small and order-independent) plus B2 (optimistic
  concurrency). Pre-A3 behaviour was not better — it attempted a write that could delete
  other blocks. **Do not "fix" this by removing the guard.**
- **`archivePage` is per-page; `lib/export/exportPage.ts` uses subtree semantics**
  (`page.is_archived || ancestors.some(...)`). So for a child of an archived parent the
  exporter files it under `Archive/` while retrieval keeps quoting it. Pre-existing
  disagreement, surfaced by C4 rather than caused by it. **Decide which semantics wins
  before someone reports it as a bug in C4** — my default is subtree (archiving a parent
  should put its children away too, which is what Notion does), which means `archivePage`
  should mark descendants and `getPageTree` should stop re-parenting orphans to the space
  root. That is a behaviour change to page management, so it belongs in its own item, not
  smuggled into a retrieval fix.
