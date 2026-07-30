# ROADMAP — NotionClone

> **The work queue. Take items from the top, in order.**
> Authoritative for *what to build next*. Supersedes `docs/FEATURE-PLAN.md` and
> `docs/notion-feature-ideas.md` (decision D-006). Rationale for anything structural
> lives in `docs/00_DECISION_LOG.md`; progress lives in `docs/BUILD_LOG.md`.
>
> Written 2026-07-29. Ordering principle, in strict precedence:
> **(1) stop losing data → (2) stop crashing → (3) remove the structural ceiling →
> (4) close the Notion-parity gaps Erik actually hits daily → (5) everything else.**
>
> A feature is not "done" when it compiles. It is done when it is verified, the docs are
> updated, and it is committed.

**Legend** — `[ ]` not started · `[~]` in progress · `[x]` done ·
🖥 = **requires a Mac session** (docker / supabase CLI / running app) · 🧪 = unit-testable
from the sandbox.

---

## Phase A — Stop losing data, stop crashing *(nothing else ships until A1–A5 are done)*

Erik's data is irreplaceable and currently unbacked-up. Three items in the brief's defect
table (BUG-1, BUG-2, BUG-3) destroy content silently. This phase is the whole
justification for D-004.

> **Gating clarification.** "Nothing else ships" gates *feature* work, not *this queue*.
> A1 and A4 need a Mac session; a sandboxed session must not idle waiting for them — it
> should work A2, A3 and A5 code, then continue into Phase C's 🧪 items. The gate exists
> to stop anyone starting Phase D while data loss is live, not to create a deadlock.

- [ ] **A1 🖥 — Install the backup system, including a restore drill.**
      The script, launchd plist, sanity gate and drill are already written out in
      `docs/audit/SUPABASE-PRO-LEVERAGE.md` §5. Nightly `pg_dump` → local + off-site copy.
      **The drill is part of the deliverable** — a backup that has never been restored is
      a rumour (D-004). Record the drill result in `BUILD_LOG.md`; until that line exists,
      treat this project as having no backups.
      *Also capture a baseline row count (pages/blocks/chunks) so the sanity gate has a
      real floor and future loss is detectable.*

- [x] **A2 🧪 — Fix BUG-1: cross-page block-id theft.** ✅ `e61e823` + `3a5fcf8` (2026-07-30). Server-side remint; 15 unit tests. Not yet driven against Postgres — see BUILD_LOG "Needs a Mac session". `CODE_REVIEW.md` §E1.
      **Decided (see D-007): fix it server-side.** `replacePageBlocks` must refuse to
      adopt a block row already owned by a different page — pre-check the incoming ids
      against `select id, page_id from blocks where id = any($1)`, and remint any id whose
      row belongs elsewhere, returning the remap to the caller so the editor can rewrite
      its `blockId` attrs in place. Chosen over stripping `blockId` on paste because that
      also fires on drag-and-drop and would orphan `comment_threads.block_id` anchors.
      Closes the hole regardless of how the id arrived.

- [x] **A3 🧪 — Fix BUG-2: overlapping saves delete newly-typed blocks.** ✅ `e61e823` (2026-07-30). In-flight mutex + save sequence in `Editor.tsx`; both (a) and (b) done. Not yet driven in a browser. `CODE_REVIEW.md` §E3.
      Two parts, both required:
      (a) an in-flight mutex on the debounced flush — never two saves for one page at once,
          and clear `dirty` only when a save *completes*;
      (b) a monotonic save sequence number, so a stale response can never move the UI's
          save state backwards or overwrite a newer snapshot.
      Two tabs on the same page stays last-writer-wins for now; the real fix is B2.

- [ ] **A4 🖥 — Make `replacePageBlocks` transactional.** `CODE_REVIEW.md` §E4.
      Upsert → delete → touch is three non-transactional round-trips; a failure between
      them resurrects deleted blocks as phantoms. Move the whole reconcile into a single
      Postgres function called via RPC. Also kills §E6 (the delete filter is currently
      built by string concatenation instead of being parameterized).
      *Migration — verify on the scratch container (`tests/db/setup-scratch-db.sh`), never
      the real stack.*

- [ ] **A5 🖥 — Root-cause BUG-7: "it keeps crashing."**
      This is Erik's single most-repeated complaint and no one has actually diagnosed it.
      Do not assume it is all the `:3777` stale-build trap — *prove* it. Concretely:
      (a) read `~/Library/Logs/NotionClone.log` and the Electron main-process log for the
          real exception signatures, and correlate their timestamps against `.next`
          chunk mtimes and the `next start` process start time (the technique that
          identified the 2026-07-27 `MODULE_NOT_FOUND`);
      (b) add a persistent renderer-crash handler in `desktop/electron/src/main.js`
          (`render-process-gone`, `child-process-gone`, `unresponsive`) that appends to a
          log instead of dying silently, plus an auto-reload on renderer crash;
      (c) add a React error boundary around the editor and the AI panel so one bad
          subtree shows a recoverable message instead of blanking the whole app;
      (d) make the Electron shell **fail loudly** when `:3777` is not serving, instead of
          rendering a white window — health-check the port before `loadURL` and show a
          real message with the restart command;
      (e) fix the two known in-app crashers: the BubbleMenu unmount crash on in-place
          editor↔database swaps (`Editor.tsx`, already worked around once) and the stale
          AI-panel conversation id (`9527b30`).
      **Acceptance:** Erik uses the app for a week without a blank window, and any crash
      that does happen leaves a log line naming its cause.

---

## Phase B — Remove the structural ceiling

Per D-002 the flat block model is the root cause of A2/A3/A4 and a hard ceiling on most
of what "all of Notion" means. Evolve it in shippable steps; do not rewrite (D-001).

- [ ] **B1 🖥 — Diff-based writes.** Stop rewriting every row on every keystroke
      (`CODE_REVIEW.md` §E5: typing one character on a 200-block page writes 200 rows
      every 1.5 s and re-triggers four background jobs). Compare the outgoing block set
      against the last-saved snapshot held client-side; send only inserts, updates and
      deletes. Keep a block's `position` untouched unless its neighbours changed — which
      is the entire point of the fractional indexing that already exists.

- [ ] **B2 🖥 — Optimistic concurrency.** Add a monotonically-increasing `version` (or
      reuse `updated_at` as an ETag) per page. A save carrying a stale version is rejected
      rather than applied. This is what makes two tabs — and later, a second device —
      safe. Depends on A4 (needs the transactional RPC to check-and-set atomically).

- [ ] **B3 🖥 — Make `parent_block_id` real.** It exists in the schema and is written
      `null` everywhere. Populate it, index it, and load/save the tree recursively.
      Unlocks, in order of Erik's likely use: nested toggles, nested lists as first-class
      blocks, multi-column layouts, synced blocks, inline databases.

- [ ] **B4 🖥 — Block-level page history.** Once writes are diffs (B1) and ordered (B2),
      an append-only `block_revisions` table is cheap, and gives the one thing that makes
      data loss survivable *from inside the app*: per-page undo across sessions.
      This is the feature that would have made the 2026-07-07 incident a nuisance.

---

## Phase C — Reliability of the AI surface

These do not lose data but they are why the app feels broken.

- [x] **C1 🧪 — Fix BUG-4: timeouts on every LLM/embedding fetch.** ✅ `6bde50f` (2026-07-30). `lib/llm/timeout.ts`; idle deadline for streams (D-010), 5 s health checks, EmbeddingProvider contract suite added. `CODE_REVIEW.md` §L1.
      A wedged Ollama currently hangs every `/api/ai/chat` forever and leaks a connection
      per edit during an outage, in a server that stays up for days.
      `EmbeddingProvider.embed()` must take an `AbortSignal` (an interface change — update
      the contract test suite in `tests/llm/`), and `retrieve()` must be passed
      `request.signal`. **Default: 30 s per generation request, 15 s per embedding call,
      overridable by env.** Erik never chose these numbers; they are my defaults and I am
      not blocking on them.
- [x] **C2 🧪 — Fix R1: don't lose a partial assistant reply on a mid-stream error.** ✅ `69f3c3e` (2026-07-30). Persisted with an in-body marker (D-011); panel offers *Ask again*.
      Persist what streamed, mark the turn errored, let the user retry.
- [ ] **C3 🖥 — Fix BUG-5: embedding-model switch mixes vector spaces.** `CODE_REVIEW.md` §R2.
      `reconcileChunks` diffs on `content_hash` only and never checks `embedding_model`.
      Store the model on the chunk, treat a model change as a full invalidation, and ship
      the re-embed script that `STATUS.md` has listed as missing since 2026-07-26.
- [~] **C4 🧪 — Filter archived pages out of retrieval**  ⚠️ code + 11 tests written `cff7583` (2026-07-30), **migration UNVERIFIED — needs a Mac session to apply on the scratch container.** File chunks on an archived page are excluded too (D-012). (`§R5`) — archived pages are
      currently retrieved and cited. One `is_archived` predicate in both search RPCs.
- [x] **C5 🧪 — Prompt hygiene:** ✅ `9dd2a22` (2026-07-30). Delimited + escaped source blocks, char caps (question/source/total/edit selection), split malformed-vs-truncated stream parsing, and `lib/llm/redact.ts` stripping endpoints from anything sent to the browser *or* written into the conversation. 33 tests. delimit system / retrieved-context / user question
      (`§R7`), cap prompt size (`§L3`), handle the unguarded `JSON.parse` in the Ollama
      NDJSON reader (`§R8`), stop echoing internal base URLs to the browser (`§L4`).

---

## Phase D — The Notion-parity gaps Erik actually hits

Ordered by *frequency of daily friction*, not by how impressive they are.

- [ ] **D1 — Global search UI.** `hybrid_search` has existed and been test-covered since
      2026-07-26 and is still only reachable through the RAG retriever. A ⌘K palette over
      it — pages by title, then content — is the single highest-value missing surface in
      the app. `docs/ARCHITECTURE.md` §5 already plans `app/search/`.
- [ ] **D2 — Archive / trash browsing and restore.** Pages can be archived and then never
      seen again. This is currently a data-loss path dressed as a feature.
- [ ] **D3 — Settings route.** `app_settings.llm_provider_id` / `embedding_provider_id`
      are *read* by the registry and *written* nowhere — that resolution tier is only
      reachable by hand-written SQL. Also the home for theme, vault path, and (from A1)
      backup status. Include a sign-out control; there is currently none anywhere in the UI.
- [ ] **D4 — Database views beyond the table, + the filter engine underneath them.**
      Erik named **tables and calendars** explicitly, so this is not optional polish.
      Order: **(a) the filter/sort/group engine first** — a recursive AND/OR filter tree
      compiled to SQL, *not* evaluated in JS — because per the feature matrix this is the
      one load-bearing abstraction from which table, board, calendar, list and gallery all
      fall out; **(b) board** (grouping reuses the existing `db_property` model);
      **(c) calendar** (needs date handling the app does not have yet — build it here, and
      it is also the substrate D5/M-phase scheduling reads from); **(d)** persist
      filter/sort per view. Phases 2–5 of the original database plan.
      *Do not build calendar as a bespoke screen — build it as a view over the same
      engine, or you will maintain two query paths forever.*
- [ ] **D5 — Columns / multi-column layout.** Blocked on B3.
- [ ] **D6 — Code-block syntax highlighting, equation blocks.** Small, self-contained,
      high visual payoff. Do them when a bigger item is blocked.
- [x] **D7 — Outline panel: include H4** ✅ (2026-07-30). Scans h1–h4; `level` widened to `1|2|3|4`, indent falls out of the existing formula. Original text: (`OutlinePanel.tsx:47` scans h1–h3 only, but the
      slash menu inserts H4). One-line fix; bundle it with any nearby work.

---

## Phase M — Meeting capture: record → transcribe → notes

Erik named this explicitly as a must-have ("recording meetings, and then transcribing the
notes"), and it is the one place where a local app can beat Notion outright: no per-seat
AI credits, no upload of private audio, no minute caps. Full technical groundwork is in
`docs/audit/NOTION-FEATURE-MATRIX.md` §3.3 — read it before starting.

The current `createMeetingNoteAction` only seeds an 8-block template. That is the shell;
this phase fills it.

- [ ] **M1 🖥 — Audio capture in the Electron shell.** macOS `ScreenCaptureKit` delivers
      microphone and system audio as **two separate streams**; Electron exposes Chromium
      loopback via `getDisplayMedia`. Capture both channels separately.
      *This is the key design point:* two-channel capture gives "me vs. them" separation
      for free, which is why **speaker diarization is unnecessary for the common case** —
      Notion's own speaker labelling is only reliable on 1:1 calls. Write to disk as it
      records; never hold a meeting in memory.
      **Watch out:** macOS TCC keys permissions to code identity, so an unsigned rebuild
      silently loses the microphone/screen-recording grant. Budget for code signing.

- [ ] **M2 🖥 — Local transcription.** `whisper.cpp` / `faster-whisper`,
      `large-v3-turbo`, which runs 17–80× realtime on Apple Silicon — an hour-long meeting
      transcribes in roughly a minute. Run it as a local sidecar process behind the same
      provider-registry pattern `lib/llm/` already uses, so the model is swappable and
      nothing new is hard-coded. Chunk with timestamps.

- [ ] **M3 — Transcript → page.** Stream partial transcripts into the meeting page's
      Notes block as they arrive; store the finished transcript as a collapsed toggle plus
      an audio attachment (the attachments pipeline with its 50 MB cap and signed URLs
      already exists — check the cap against real meeting audio and raise it).
      Timestamps link back into the audio.

- [ ] **M4 — Summary and action items.** Reuse the existing propose-only AI path — a
      meeting summary is *proposed* as a diff, never auto-written (brief §8). Action items
      become task blocks; once D4's calendar exists, ones with dates become rows in it.

- [ ] **M5 — Ingest the transcript into RAG.** The whole point of a local second brain:
      "what did we decide about X" should search meetings too. Chunk transcripts with
      speaker + timestamp breadcrumbs, same `content_hash` diffing as pages.

**Estimate:** ~9–13 working days for M1–M5 to something usable. M1 is the risky one; if
`ScreenCaptureKit` fights back, the fallback is an aggregate device (BlackHole), which is
uglier but well-trodden.

---

## Phase E — Second brain / knowledge graph

Erik's stated differentiator: *"every page that is created should turn into an MD file
that's included in the knowledge graph."* The vault mirror (`lib/export/`) already does
half of this. Per D-005 it is a **content mirror, not a backup**, and must never be
counted as one.

- [ ] **E1 — Harden the vault mirror**: rename and delete propagation, wikilink integrity,
      idempotent re-export, a reconcile command that proves DB and vault agree.
- [ ] **E2 — Backlinks and graph surfacing in-app** — `links` rows exist and
      `components/backlinks/` renders them; make them a first-class panel, not a footer.
- [ ] **E3 — Fix R3/R4**: the breadcrumb is baked into the chunk content hash, so a *move*
      forces a full re-embed while a *rename* never re-ingests at all — leaving stale
      breadcrumbs in the embeddings forever. Separate breadcrumb from hashed content.

---

## Cut — proposed and deliberately not building

Recorded so no future session re-adds them from the stale planning docs. Erik has
explicitly authorised cutting bad ideas (brief §8).

- **Sharing, permissions, multi-tenancy, billing, public page publishing.** Single user,
  one machine. Explicitly out of scope in the brief's goal statement.
- **Real-time multiplayer collaboration (CRDT/Yjs).** Rejected in D-001. There is one
  user on one machine; it would be a ground-up change to persistence, RAG ingest and
  export for a problem that does not exist. **Revisit only if** Erik wants a second
  device — at which point D-003's "revisit when" clause fires too.
- **Hosted-primary Postgres.** D-003: turns a ~1 ms page open into a 200–500 ms stall and
  breaks offline use of a laptop notes app.
- **Google Calendar integration** (old FEATURE-PLAN item 10). A two-way sync with a
  third-party OAuth surface, for a single user who has a calendar app already. Cut until
  the database calendar view (D4) exists and the need is concrete.
- **Notion API import.** Erik is leaving Notion, not syncing with it. The markdown
  importer already handles a one-time Notion markdown export, which is the actual need.
- **`tags` / `page_tags` tables.** They exist and are entirely inert. Notion itself has no
  global tags — it has multi-select *properties*, which the database work (D4) already
  provides. **Decision: do not build a tags UI; drop the tables** in a later migration
  once it is confirmed nothing reads them.
- **AI paths that auto-commit edits.** Non-negotiable, brief §8. Propose-only, forever.

---

## Standing rules for anyone pulling from this queue

1. **Never** `supabase db reset` on the real stack. Scratch container, port 54329.
2. Refresh `.autonomous-run-lock` at the start of every item.
3. `npm run typecheck && npm run lint && npm test` clean before every commit.
4. Append STARTED / FINISHED to `docs/BUILD_LOG.md` as it happens, never in a batch.
5. Zero new dependencies without a decision-log entry. Tiptap is **2.27** — no v3-only
   packages (`@tiptap/extension-bubble-menu` in particular).
6. If an item needs the live stack and you are sandboxed, write the code, unit-test what
   you can, and queue the verification under **"Needs a Mac session"**. Never claim a
   migration applies cleanly if you could not run it.
