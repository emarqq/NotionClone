# Handoff Prompt for Claude Fable 5 — NotionClone / "Notion Clone"

> Paste everything below the line into a fresh Claude Fable 5 session (`claude-fable-5`) running
> in this repo. It is written to be given **in one turn, up front** — Fable 5 does its best work
> when the full task specification arrives at once and it runs at `high`/`xhigh` effort. Recommended
> settings: effort `xhigh`, run in the repo root `/Users/erikmarquardt/NotionClone`.

---

## Context and intent

I'm building **Notion Clone**, a single-user, local-first Notion replacement I run on my own Mac.
It is a personal tool, not a product for distribution — optimize for "works great for me," not for
scale, multi-tenancy, or edge cases that can't occur in a single-user local app. I want to add two
net-new features this batch, both modeled closely on their Notion equivalents (screenshots described
below since you can't see images). This is **new work, not WIP to finish** — there is no partial
implementation of either feature sitting in the tree.

**Tech stack (already in place):** Next.js 15.5 (App Router + Turbopack) · React 19 · TypeScript ·
Tailwind v4 · Tiptap 2.27 (ProseMirror) · Supabase (local, `@supabase/ssr`, Postgres + pgvector) ·
Zustand · `fractional-indexing` · Ollama-based local LLM behind a swappable provider registry
(`lib/llm/registry.ts`) with pgvector RAG (`hybrid_search` RPC). Phases 1–3 (core workspace,
RAG/search backend, AI assistant) are already built — **read `docs/ARCHITECTURE.md` in full before
you write any code.** The editor stores one `blocks` row per top-level Tiptap node; ordering is
fractional-indexed. The app also ships as a macOS Electron shell (`desktop/electron/`) that loads a
**production** build on port 3777 — separate from the `:3000` dev server; see `desktop/README.md`
and the "Desktop app" section of `CLAUDE.md` for the rebuild-and-restart gotcha before you try to
verify anything in the desktop shell.

I had two research agents do deep, adversarially-verified research (fan-out web search → fetch →
3-vote claim verification) into how other tools build these two features before writing this prompt.
Their findings are distilled into this doc with citations so you don't have to re-derive them, but
you have `WebFetch`/`WebSearch` available — go pull more detail from any cited source if you need it.

---

## Feature A: Global search (Cmd/Ctrl-K command palette)

**Target UX** (from a Notion screenshot): a command-palette modal (⌘K-style, footer shows `⇧⌘K` as
"Command Search") with a search input at top ("Search or ask a question in..."), a row of filter
chips below it ("Aa Title only", "Created by ▾", "In [space] ▾", "+ Filter"), a results list grouped
by recency ("Yesterday", "Older") with a small type-icon + title per row and a gray parent-page
breadcrumb subtitle for nested pages, a live preview pane on the right showing the selected result's
content, and a footer with keyboard hints (`⏎` open, `⌘L` copy link, `⇧⌘K` command search).

### Current state (verified against the actual repo — do not assume the docs are accurate)

- **The hard backend work is already done and reusable.** `supabase/migrations/20260703200000_hybrid_search.sql`
  defines a working `hybrid_search(query_text, query_embedding, space_filter, match_count)` RPC: top-20
  Postgres full-text search (`websearch_to_tsquery`) fused with top-20 pgvector cosine similarity via
  Reciprocal Rank Fusion (k=60), granted to `authenticated`/`service_role`. `lib/rag/retriever.ts` is
  its only caller today, feeding `app/api/ai/chat/route.ts` (the AI panel's RAG retrieval step).
- **There is no search UI anywhere in the app.** No `/api/search` route, no command palette component,
  no ⌘K binding, no results list, no preview pane. The only thing resembling "search" in the UI is a
  plain space-filter `<select>` inside the AI chat panel (`components/ai-panel/AiPanel.tsx`) — not a
  search feature.
- **Doc/code drift to fix while you're in there:** `docs/ARCHITECTURE.md` §7 lists "global search UI"
  as a completed Phase 2 deliverable and a later addendum claims "Phases 2+3 landed together, exactly
  per §2–§5" — but it was never built. Correct the doc once the real thing exists (or note explicitly
  if you're choosing not to build part of what was originally scoped).
- No `pg_trgm` extension is enabled yet (check `supabase/migrations/` to confirm before assuming).

### Research findings to ground your design

- **Postgres FTS alone cannot power instant-as-you-type search.** `tsvector`/`websearch_to_tsquery`
  does stemmed/lexeme matching, not character-level fuzzy or mid-word substring matching — a misspelled
  query or a partial mid-word match will silently fail to match. (postgresql.org, high confidence)
- **`pg_trgm` (GIN or GiST trigram index) is the right primitive for the fast title/prefix/typo-tolerant
  path.** It automatically accelerates `LIKE`/`ILIKE` and regex queries; the match strictness is a
  runtime-tunable GUC (`pg_trgm.similarity_threshold`, default 0.3, no schema change needed); and
  `word_similarity()` is purpose-built for "does this partial query match *some substring* of this
  longer title" — exactly the instant-title-search case. It's semantics-blind and best suited to short
  fields like titles, not full content. (postgresql.org docs, high confidence — note: a claim that GiST
  outperforms GIN for this specific ordering pattern was checked and **refuted**, don't assume it)
- **RRF fuses purely by rank position**, never raw scores, which is exactly why it can safely combine
  FTS and vector results on incompatible scales — this validates that your existing `hybrid_search`
  RPC's approach is sound and reusable as-is for full-content search results in the palette; you don't
  need to re-architect it, just add a consumer.
- **Recommended architecture: two-tier search**, not one query doing everything — a fast `pg_trgm`
  path over `pages.title` (and any other title-bearing tables) for instant-as-you-type results,
  running *alongside* (not instead of) the existing RRF `hybrid_search` for full-content matches,
  merged/sectioned in the UI. One real-world benchmark (single-source, self-hedged, treat as
  directional only) measured a tuned Postgres hybrid query at ~8.5ms on 50K rows.
- **UI library candidates:** `kbar` (github.com/timc1/kbar) is a well-documented, composable fit —
  `useMatches()` hook + virtualized `KBarResults`, declarative action objects (`id`, `name`, `shortcut`,
  `keywords`, `perform`), composable primitives (`KBarPortal`/`Positioner`/`Animator`/`Search`) you can
  reuse even if you don't adopt the whole library. `cmdk` is a comparable, leaner alternative. **Avoid
  `react-cmdk`** — its search is a naive client-side substring filter over an in-memory list with no
  async/server-backed search and no documented preview-pane support, a poor fit for this feature.
  Neither library documents a built-in live-preview-pane pattern — you'll likely be building a custom
  palette shell (borrowing kbar's primitive composition pattern) rather than dropping a library in
  wholesale, given the preview pane and server-backed hybrid results are core to the target UX.
- **Open questions the research didn't resolve** (use your judgment, document the choice): how Notion/
  Obsidian/Logseq/Anytype actually rank/frecency their own results; whether Meilisearch/Typesense/SQLite-FTS5
  would meaningfully beat a well-indexed Postgres stack for a single-user app (my instinct: no, stay
  Postgres-only, avoid the added operational surface of a second search service for a personal tool —
  but push back if you find a concrete reason otherwise).

---

## Feature B: Meeting note transcriber

**Target UX** (from a Notion screenshot): a meeting page with a "Meeting @Today" block containing a
"Notes" tab/toggle and a prominent "Start transcribing" button; helper text "Notion AI will summarize
the notes and transcript"; an "Instructions: Auto ▾" style-selector dropdown; a consent disclaimer
("By starting, you confirm everyone being transcribed has given consent..."). The sidebar has a
dedicated "Meetings" section showing upcoming calendar events and today's meeting notes. The transcript
accumulates live during the meeting; the user can type free-form notes in a separate pane at the same
time; once stopped, AI generates a structured summary from both streams together.

### Current state (verified against the actual repo)

- **Zero transcription/audio infrastructure exists.** `app/actions/meetings.ts` (`createMeetingNoteAction`)
  only creates a templated page (Details/Attendees/Agenda/Notes as plain ProseMirror blocks) — no audio
  capture, no transcript, no AI summary step. This is a good page-template foundation to build on top of,
  not a transcriber. (Also: `docs/ARCHITECTURE.md` claims this template has 8 sections including
  "transcript link" and "close-date picker" — the actual code only builds 4. Fix that drift.)
  `docs/notion-feature-ideas.md` explicitly logged "AI Meeting Notes" as not-started and previously
  deprioritized — that decision is being reversed now.
  - `package.json` has **no** audio/speech dependency of any kind (no whisper bindings, no
    `mediarecorder` helpers, nothing). This is genuinely greenfield.
- **I checked my other project, WhisperThat, hoping to reuse code — it's a partial match at best.**
  It's a native Swift/CoreML macOS dictation utility (push-to-talk, mic-only, no system-audio capture,
  no persistence — transcripts exist only in memory for one utterance then get typed at the cursor via
  Accessibility APIs and discarded). Its actual STT engine (Parakeet via FluidAudio/CoreML) is Swift-only
  and **not portable** to a Next.js server. What *is* worth carrying over: (1) its protocol-based
  `Transcriber`/`TranscriptEditor` abstraction, which mirrors the swappable-provider pattern your
  `lib/llm/registry.ts` already uses — extend that same registry pattern for a transcription provider
  rather than inventing a new one; (2) its "LLM cleanup with a fail-open fallback to raw output" pattern
  in `OllamaEditor.swift` — never let an AI post-processing step block or corrupt the raw transcript,
  always degrade gracefully.

### Research findings to ground your design

- **Audio capture is the hardest and most platform-specific part.** Microphone capture via
  `getUserMedia` is trivial and works everywhere. **True system/tab audio capture — i.e. hearing "the
  other side" of a video call without a bot joining it — is the hard part**, and it's Electron- and
  macOS-version-specific: it requires `desktopCapturer` feeding `getUserMedia`, and on macOS depends on
  Apple's Core Audio Tap API (macOS 14.2+), which Electron only defaults to from **v39.0.0-beta.4
  onward**. **Your desktop app is currently pinned to Electron `^32.0.0`** (`desktop/electron/package.json`)
  — a real, concrete blocker for full call capture, not a hypothetical. Treat "capture system audio for
  a live call" and "capture my own mic to dictate meeting notes to myself" as two very different scopes
  of ambition; the latter needs zero Electron changes.
- **Every real open-source project in this space runs transcription locally, not via cloud streaming
  APIs** — consistent with your "fully offline" design goal. Concrete prior art, all worth skimming:
  - [WhisperLive](https://github.com/collabora/WhisperLive) (~4.1k★) — WebSocket server streaming
    incremental transcription segments, swappable local backends (faster-whisper/CTranslate2 default,
    TensorRT, OpenVINO).
  - [Buzz](https://github.com/chidiwilliams/buzz) — has a distinct live/presentation mode with an
    "append and correct" rolling transcript, separate from its batch file-transcription mode.
  - [vibe](https://github.com/thewh1teagle/vibe) — fully offline via whisper.cpp (note: verified to
    **not** do simultaneous mic+system-audio capture — it's a transcription/diarization reference only,
    not an audio-capture reference).
  - [ownscribe](https://github.com/paberr/ownscribe) — local-first CLI, macOS Core Audio Taps for
    system audio (no virtual driver needed), bundles a small local LLM (Phi-4-mini via llama.cpp) with
    **four customizable summary templates** — directly analogous to the "Instructions: Auto ▾" selector.
  - [minutes](https://github.com/silverstein/minutes) (~1.3k★) — streams live local transcription to a
    JSONL file in real time and exposes a delta-read tool (`read_live_transcript`) by line cursor or
    duration — a directly reusable pattern for a live-updating transcript UI.
- **Speaker diarization is technically feasible locally without heavy infra** (WhisperX + pyannote, or
  the newer no-Python `pyannote-rs` Rust/ONNX port used by vibe/minutes; diart's published benchmarks
  show CPU-only real-time diarization latency well within a rolling-buffer budget) — but **my instinct
  is skip it for v1**: this is a single-user tool, you know who's speaking, and diarization adds a real
  model-download/HuggingFace-token/dependency cost for a nice-to-have. Push back if you disagree, but
  don't build it by default.
- **Batch/chunked transcription is dramatically simpler than true streaming ASR and is probably the
  right v1 tradeoff** — record short rolling chunks (a few seconds), transcribe each chunk locally as
  it completes, append to a growing transcript. This gets you the "live, rolling transcript" *feel*
  without WebSocket-server complexity or a persistent streaming ASR process. True low-latency streaming
  is a reasonable v2 upgrade if the chunked UX feels too laggy in practice.
- **Notion's own commercial implementation is architecturally the opposite of what you want and should
  only be used as a UX reference, not an architecture to copy**: it streams raw audio to third-party
  sub-processors (OpenAI, Anthropic, Fireworks, Baseten, X.AI) for transcription/summarization, and its
  desktop app requires system-audio + screen-recording OS permissions while its browser version is
  mic-only. Your local-LLM, no-cloud design is a genuine differentiator here — don't compromise it by
  reaching for a hosted STT API out of convenience.
- **Summary generation should be gated behind explicit user action + a minimum-content guard**: Notion
  only generates a summary when the user clicks Stop, and requires at least ~1 minute / ~300 characters
  of transcript first. Replicate that guardrail (gray out / disable "Summarize" until there's enough
  content) rather than letting someone summarize an empty or 2-second transcript.
- **Supabase Realtime gives you a ready, poll-free way to push incremental transcript-segment inserts
  into the open editor tab** — either Postgres Changes (add the table to the `supabase_realtime`
  publication, WAL-based) or Broadcast (lower-latency, can be triggered directly from a Postgres trigger
  via `realtime.broadcast_changes()`). Prefer this over client-side polling.
- **Data model: keep the machine transcript and the user-typed Notes pane as separate but linked
  streams, merged only at summarization time** — this is exactly Notion's own documented approach
  (transcript + manual notes are read together when generating the summary, but stored/edited
  independently while the meeting is live). None of the research surfaced a ready-made schema pattern
  for this in a blocks-based editor, so this is original design work: my recommendation (not a mandate)
  is a dedicated `meeting_transcripts` / `transcript_segments` table (timestamped, one row per chunk,
  linked by `page_id`) rather than shoehorning live transcript segments into the `blocks` table — the
  `blocks` table's per-row-is-a-persisted-editor-node model doesn't fit a rapidly-appending,
  machine-written stream well. The user-typed Notes pane, by contrast, *should* just be ordinary
  `blocks` rows like the rest of the editor. At summarization time, read both, feed them to the LLM
  registry together, and write the resulting summary as new blocks the user can edit normally. Decide
  whether the finished transcript also needs a durable, readable representation as blocks (e.g. for
  RAG ingestion, since the existing chunker only walks `blocks`/`chunks` today and has no
  transcript-aware chunking) — that's a real open decision, not obvious from the research.
- **The biggest open technical decision the research did not resolve for you**: your stack is a Node.js
  server (Next.js), and every credible local STT engine above (whisper.cpp, faster-whisper) is a
  native binary or Python process, not a native Node library. You'll need to choose between (a) a Node
  native binding to whisper.cpp (e.g. `whisper-node`/`nodejs-whisper`-style packages — verify current
  state, these move fast), shelled out to from a Next.js API route running server-side (this repo has
  no edge-runtime constraints blocking that), or (b) a small local sidecar process (Python, following
  the WhisperLive pattern) that the Next.js server talks to over a local socket/WebSocket. (a) keeps
  the stack simpler (no second runtime to manage/ship in the Electron app); (b) is the most proven path
  in the ecosystem. Make this call yourself, document why in `docs/ARCHITECTURE.md`, and design the
  transcription step behind the same kind of provider interface `lib/llm/registry.ts` already
  establishes so it's swappable later either way.

---

## What I need you to do

1. **Read first.** `docs/ARCHITECTURE.md` in full, then this whole prompt again. Don't start writing
   code until you've formed an actual plan for both features — this is genuinely two significant new
   subsystems, not a small patch.
2. **Plan the sequencing.** My instinct: build **search first** — the backend (`hybrid_search`) already
   exists and works, so it's a bounded, lower-risk win, and it'll teach you the codebase's server-action
   /RPC/UI wiring conventions before you tackle the much less certain meeting-transcriber feature. Only
   resequence if you find a concrete reason to.
3. **Delegate the parallelizable parts.** You have the Agent tool and should default to using it for
   independent workstreams rather than doing everything serially in one context — that's standard
   practice for this repo, not optional. Concretely, once you've made the key architecture calls above:
   - The `pg_trgm` migration + search RPC/API-route work and the command-palette React UI can likely
     proceed in parallel once you've defined the API contract between them.
   - For the meeting feature, treat the audio-capture spike (does mic capture + chunked local
     transcription actually work end-to-end in this Electron/Next setup) as a *separate, earlier*
     investigation from the data-model/summarization work — don't let UI/schema work block on an
     unproven audio pipeline, and don't let the audio spike block on UI polish.
   - Use a research/explore-style agent for anything you're not sure exists yet (e.g. current state of
     Node whisper.cpp bindings) rather than guessing from training data — the ecosystem here moves fast.
4. **Verify for real, per this repo's standards.** `npm run typecheck` && `npm run lint` are
   non-negotiable gates. There's no test framework, so exercise both features by hand in the browser
   (`npm run dev` on `:3000`) — actually type-search-select-open a page in the palette; actually record
   a short chunk of your own voice and confirm a transcript segment appears. Don't report either
   feature "done" without describing what you actually observed. If you touch anything that affects the
   Electron desktop shell, follow the rebuild-and-restart steps in `CLAUDE.md` before claiming it works
   there too — dev-server (`:3000`) success does **not** imply desktop-app (`:3777`) success.
5. **Fix the doc/code drift you found along the way** (the "global search UI already shipped" claim,
   the "8 meeting-template sections" claim) as part of finishing each feature, not as a separate pass.
6. **If you hit the Electron-version question** (whether to bump `desktop/electron` off `^32.0.0` to
   get real system-audio capture) — that's a call worth surfacing to me rather than making silently;
   a major Electron bump has blast radius beyond this feature. Ship mic-only meeting transcription as
   v1 if that's the pragmatic choice, and ask before touching the Electron version.
7. **Leave the tree clean** at natural stopping points — commit verified, working slices with clear
   messages as you go rather than accumulating one enormous diff; don't push unless I ask.

## How I want you to work

- **When you have enough information to act, act.** Don't re-derive facts already in this prompt or
  narrate options you won't take. If you're weighing a genuine architecture choice this prompt left
  open, make the call, state your reasoning briefly, and move — don't survey me with options unless
  it's a decision I actually flagged above as mine to make (the Electron version bump).
- **Don't scope-creep.** No refactors, no speculative abstractions, no defensive handling for cases
  that can't happen in a single-user local app. Build these two features well; don't redesign
  adjacent systems while you're in there.
- **Ground every progress claim in a tool result.** Before telling me a gate passed or a feature works,
  point to the actual command output or UI state you observed.
- **Delegate the parallel parts** (see above) — don't do serially what independent subagents could do
  concurrently.
- **Keep a memory file.** Record non-obvious things you learn (a library that turned out not to fit, a
  timing quirk in chunked transcription, a real gotcha in Electron audio permissions) as you go, one
  lesson per note. Don't save what the repo or this prompt already documents.
- **If you're genuinely blocked** on a decision that's mine to make — not "which library" but "should
  we ship without system-audio capture" or "should the desktop app take a major Electron version bump"
  — stop and ask rather than guessing.

Start by reading `docs/ARCHITECTURE.md`, then design Feature A (search) in enough detail to start
delegating implementation work.
