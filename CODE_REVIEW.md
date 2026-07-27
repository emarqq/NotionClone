# CODE_REVIEW.md

> Focused review of the three most load-bearing pieces per STATUS.md: the block
> editor, the LLMProvider layer, and the RAG assistant/retriever.
> Written 2026-07-26 on branch `claude/overnight-2026-07-26`.

**Legend**
- **VERIFIED** — I reproduced the mechanism myself (SQL run against a disposable
  Postgres, or traced the code path end to end). Not just pattern-matched.
- **CONFIRMED** — traced in code by a reviewer, consistent with my reading, but
  not independently reproduced at runtime.
- **SUSPECTED** — plausible from the code, not proven.

Only **one** item was fixed this session (E2, below). Everything else is logged
rather than fixed, per the instruction to keep unattended changes low-risk — the
severe ones cluster in block persistence and touch identity semantics that
deserve a human decision.

---

## Severity summary

| # | Finding | Area | Severity | Status |
|---|---|---|---|---|
| E1 | Copy-pasting a block between pages silently **moves the source row**, deleting content from the origin page | Editor | **HIGH** | **VERIFIED** — open |
| E2 | One non-UUID `data-block-id` breaks saving for the **entire page**, permanently | Editor | **HIGH** | **VERIFIED** — **FIXED** |
| E3 | No in-flight guard on the debounced save; overlapping saves can delete newly typed blocks | Editor | HIGH | CONFIRMED — open |
| R1 | Partial assistant reply is **lost** when the provider errors mid-stream | RAG | HIGH | CONFIRMED — open |
| R2 | Switching embedding model silently mixes incompatible vector spaces | RAG | HIGH | CONFIRMED — open |
| L1 | No timeout on any LLM/embedding fetch — a wedged Ollama hangs every chat request forever | LLM | HIGH | CONFIRMED — open |
| E4 | `replacePageBlocks` is 3 non-transactional round-trips; deleted blocks can resurrect | Editor | MED-HIGH | CONFIRMED — open |
| L2 | A malformed 200 yields a blank assistant bubble with no error, and the turn isn't saved | LLM | MED-HIGH | CONFIRMED — open |
| E5 | Every save rewrites **every** block row on the page | Editor | MED-HIGH | CONFIRMED — open |
| R3 | Breadcrumb baked into the content hash defeats the "cheap re-ingest" claim on move | RAG | MED | CONFIRMED — open |
| R4 | Rename never re-ingests → stale breadcrumbs in embeddings forever | RAG | MED | CONFIRMED — open |
| R5 | Archived pages still surface in AI answers and citations | RAG | MED | CONFIRMED — open |
| R6 | `reconcileChunks` deletes before embedding — a provider outage degrades the index | RAG | MED | CONFIRMED — open |
| R7 | No delimiting between system prompt, retrieved context, and user question | RAG | MED | CONFIRMED — open |
| L3 | No prompt-size cap anywhere | LLM | MED | CONFIRMED — open |
| R8 | Unhandled `JSON.parse` in the Ollama NDJSON reader | RAG/LLM | MED | CONFIRMED — open |
| E6 | Delete filter built by string concatenation rather than parameterized | Editor | LOW* | CONFIRMED — open |
| L4 | Internal base URLs echoed to the browser in error messages | LLM | LOW | CONFIRMED — open |
| E7 | Pasted-image upload failures are swallowed to `console.error` | Editor | LOW | CONFIRMED — open |

\* LOW as currently exploitable; see the note in E6.

**Confirmed clean** (checked, no defect): SQL injection in `hybrid_search`;
`/api/ai/edit` writing to the DB; embedding batching; vector dimensions; the RRF
fusion math; heading-boundary chunking; stream-lock cleanup; the client/server
boundary (see REORG_NOTES.md §1).

---

## Block editor

### E1 — Copy-pasting a block between pages silently moves the source row (HIGH, VERIFIED)

**The chain:**
1. `components/editor/extensions/block-id.ts:38-41` — `renderHTML` writes
   `data-block-id` into the DOM, so a whole-block copy carries it through the OS
   clipboard.
2. `components/editor/extensions/block-id.ts:37` — `parseHTML` reads it back
   verbatim on paste.
3. `components/editor/extensions/block-id.ts:52-69` — the de-dup
   `appendTransaction` only checks uniqueness **within the current doc**. An id
   pasted from a *different* page is unique here, so it survives.
4. `components/editor/blockSync.ts:69-72` — `blocksFromDoc` uses that id verbatim
   as the row's primary key.
5. `lib/db/blocks.ts:50-52` — `upsert(rows, { onConflict: "id" })` with
   `page_id: pageId`.

Because the upsert sets `page_id` on conflict, the **existing row belonging to
page A is reassigned to page B**. Page A's delete pass (`lib/db/blocks.ts:59-67`)
is scoped to page A's own `page_id`, so nothing repairs it.

**I verified the database mechanism directly** on a disposable Postgres:

```sql
-- block belongs to page A
insert into blocks (id, page_id, ...) values ('bbbb0001-…','page-A', …);
-- page B saves, upserting the same id (the pasted data-block-id)
insert into blocks (id, page_id, ...) values ('bbbb0001-…','page-B', …)
  on conflict (id) do update set page_id = excluded.page_id, …;
```
Result: `page A block count` went **1 → 0**; page B went 0 → 1. The row moved.

**Failure scenario:** Erik selects a whole paragraph on Page A (triple-click),
copies, pastes onto Page B. Page B autosaves ~1.5s later. Next time Page A is
opened, that paragraph is **gone** — no error, no warning, no undo path.

**Why I did not fix it:** the obvious fix (strip `blockId` on paste) also fires
for drag-and-drop, and block identity is what `comment_threads.block_id` anchors
to (`supabase/migrations/20260707000000_inline_comments.sql:14`). Reminting ids
on drag would orphan comment threads (they survive via `on delete set null`, but
detach). Choosing between "strip only on cross-page paste", "scope the upsert
server-side so it can never reassign `page_id`", or "accept comment reanchoring"
is a design decision, not a mechanical fix.

**Recommended fix (needs your call):** server-side is the robust place — make
`replacePageBlocks` refuse to adopt a row already owned by another page (e.g.
pre-filter incoming ids against `select id from blocks where page_id <> $1`, and
remint any collision). That closes the hole regardless of how the id got there,
and leaves drag/comment behavior untouched.

### E2 — One non-UUID `data-block-id` breaks the whole page's saves (HIGH, VERIFIED) — **FIXED**

`blocks.id` is `uuid not null`, and *all* blocks for a page go in a **single**
batched upsert (`lib/db/blocks.ts:40-56`). I verified on the scratch database
that a batch containing one invalid uuid is rejected **in its entirety** — the
valid row in the same statement did not land (count 0).

So pasting a block from any external editor that uses a non-UUID
`data-block-id` makes **every** block on that page fail to save, indefinitely,
until the offending block is deleted. `components/editor/Editor.tsx:226` only
shows a generic "Save failed — retrying on next edit", giving no clue which
block is at fault.

**Fixed** in `components/editor/extensions/block-id.ts`: `parseHTML` now accepts
the attribute only if it matches a UUID, else returns `null` so the existing
`appendTransaction` mints a fresh id. This is safe because persisted content is
loaded as **JSON** (`docFromBlocks` → `Editor.tsx:158 content: initialDoc`), not
by parsing HTML — so this rule only affects clipboard input, never load.
Covered by `tests/editor/blockId.test.ts` (11 cases).

Note this does **not** fix E1: a valid UUID pasted from another page still
passes the check, by design.

### E3 — No in-flight guard on the debounced save (HIGH, CONFIRMED)

`components/editor/Editor.tsx:73-92` — `flush()` has no mutex; `dirtyRef` is
cleared when a save *starts*, not when it completes. Two saves can therefore be
in flight at once, and `replacePageBlocks` is a whole-document replace with a
`NOT IN` delete (`lib/db/blocks.ts:57-67`). If the **older** request lands last,
its delete pass removes blocks that exist only in the newer snapshot — content
the user just typed is deleted, not merely overwritten.

Same root cause makes **two tabs on one page** a guaranteed data-loss scenario:
`initialDoc` is built once at load (`Editor.tsx:67-71`) and never reconciled;
last writer wins wholesale. There is no version/ETag check anywhere.

### E4 — `replacePageBlocks` is three non-transactional round-trips (MED-HIGH, CONFIRMED)

`lib/db/blocks.ts:33-81` does upsert → delete → touch as three separate calls.
If the upsert commits and the delete then fails, the function throws and the
action reports failure — but the upsert already landed. Blocks the user deleted
remain in the DB and **reappear as phantom blocks** on next load.

### E5 — Every save rewrites every block row (MED-HIGH, CONFIRMED)

`components/editor/blockSync.ts:62-82` regenerates `position` for **every**
top-level node on every call and always sends the full array; `lib/db/blocks.ts:40-56`
upserts all of them with a new `updated_at`. Typing one character on a 200-block
page writes 200 rows every ~1.5s (`Editor.tsx:46`), plus a full `NOT IN` delete
and a `pages` touch — and re-triggers four `after()` background jobs
(`app/actions/editor.ts:13-37`). This undercuts the stated rationale for
fractional indexing ("so drag-and-drop never mass-reindexes") since ordinary
typing already mass-rewrites, and it widens the blast radius of E1/E3/E4.

### E6 — Delete filter built by string concatenation (LOW as exploitable, CONFIRMED)

`lib/db/blocks.ts:59-67`:
```ts
deleteQuery.not("id", "in", `(${keepIds.map((id) => `"${id}"`).join(",")})`)
```
Ids are interpolated into a raw PostgREST filter with no escaping of `"`. Today
the `uuid` column type gates this (a bad id fails the upsert first — E2), so I
could not demonstrate injection. It remains a defense-in-depth gap: if `id` ever
becomes `text`, or a path reaches this without the upsert gate, it is directly
exploitable. Worth switching to a parameterized/array form regardless.

### E7 — Pasted-image upload failures are swallowed (LOW, CONFIRMED)

`components/editor/Editor.tsx:192-214` — the upload's only failure handling is
`.catch((err) => console.error(...))` at :212. To the user the paste silently
does nothing: no error, no retry.

---

## LLM provider layer

### L1 — No timeout on any provider fetch (HIGH, CONFIRMED)

There is no `AbortSignal.timeout` anywhere in `lib/llm/`. Worse,
`EmbeddingProvider.embed()` (`lib/llm/types.ts:47-52`) takes **no signal at all**,
and `lib/llm/providers/ollama.ts:194-198` passes none.

`app/api/ai/chat/route.ts:166-171` calls `retrieve()` — which calls `embed()` —
**before** the abortable generation loop, and without `request.signal`.

**Failure scenario:** Ollama is up but wedged (model-load hang / OOM stall — a
real Ollama failure mode). Every `/api/ai/chat` request hangs on the very first
network call, forever. No SSE event is ever sent, the HTTP response never
completes, and the client aborting does not help because the signal never
reaches that fetch. Recovery requires restarting the server.

Compounding: `ingestPage(...)` is called fire-and-forget in
`app/actions/editor.ts:15`, `app/actions/pages.ts:163`, `app/actions/meetings.ts:110`.
With no timeout, each edit during an outage leaks a hung connection in a process
(`next start -p 3777`) that stays up for days.

### L2 — A malformed 200 becomes a blank bubble with no error (MED-HIGH, CONFIRMED)

If the stream never yields non-empty content, `app/api/ai/chat/route.ts:196-199`
leaves `fullText` empty, so the `if (fullText.length > 0)` guard at :212 means
**the turn is never persisted** — yet :224 still sends `{type:'done'}`.
`components/ai-panel/useAiChat.ts:134-139` just flips `streaming: false`, and
`MessageBubble.tsx:110-117` has no empty-content fallback. The user is left with
a permanently blank assistant bubble, no error, no retry, and no trace after
refresh. (The edit path is better guarded: `AIProposalCard.tsx:146` no-ops on
empty text, so it can't blank out a selection.)

### L3 — No prompt-size cap (MED, CONFIRMED)

`app/api/ai/chat/route.ts:120-125` and `app/api/ai/edit/route.ts:73-75` check
only for non-empty input. Selecting an entire imported document and hitting
"summarize" sends the whole thing uncapped. `capabilities().contextWindow`
exists but is hardcoded to 8192 and has no callers (REORG_NOTES §3.4), so
nothing could enforce a budget even if it wanted to.

### L4 — Internal base URLs echoed to the browser (LOW, CONFIRMED)

`lib/llm/providers/ollama.ts:88-96,123-131` (and the custom-finetune
equivalents) interpolate `baseUrl` into thrown errors, which
`app/api/ai/chat/route.ts:226-229` and `app/api/ai/edit/route.ts:95-103` send to
the client verbatim. Low impact for a single-user local app. **No API keys are
leaked** — `authHeaders()` is never stringified into an error or log (checked).

---

## RAG assistant / retriever

### R1 — Partial assistant reply lost on mid-stream provider error (HIGH, CONFIRMED)

`app/api/ai/chat/route.ts:201-205` — the stream `catch` rethrows when the abort
wasn't client-initiated, which **skips** the `if (fullText.length > 0) { addMessage(...) }`
block at :212-222. The user already saw 30 streamed tokens; after a refresh the
assistant turn has vanished from history entirely. Contrast the client-abort
path, which correctly persists partial text tagged `_(response interrupted)_`.
The fix is small — persist before rethrowing.

### R2 — Switching embedding model silently mixes vector spaces (HIGH, CONFIRMED)

`lib/rag/ingest.ts:134-147` — `reconcileChunks` diffs on `content_hash` only. It
never compares a row's `embedding_model` against the active provider. Switch the
embedding model and every chunk whose *text* is unchanged keeps its **old**
model's vector, while new/changed chunks get the new model's. `vector(768)` is
dimensionally compatible, so nothing errors — but cosine distance across two
model spaces is meaningless, and `hybrid_search`'s vector arm silently blends
them. `embedding_model` is written (`ingest.ts:179`) and never read anywhere.

### R3 — Breadcrumb in the content hash defeats "cheap" re-ingest (MED, CONFIRMED)

`lib/rag/chunker.ts:116` bakes the `Space > ancestors > title` breadcrumb into
the chunk text that is then hashed (:121). Moving a subtree changes the
breadcrumb for **every descendant**, so every chunk hash changes and the whole
subtree is re-embedded — directly contradicting the comment at
`app/actions/pages.ts:159-160` claiming the hash diff makes this cheap.

### R4 — Rename never re-ingests (MED, CONFIRMED)

`app/actions/pages.ts:60-68` — `renamePageAction` calls `renamePage()` and
`scheduleExportRename()`, but never `ingestPage`, and never cascades to
descendants. The breadcrumb embedded in every chunk's `content` (and thus its
embedding and `tsv`) goes stale the moment any ancestor is renamed, and stays
stale until the page happens to be re-saved. The `title` column returned by
`hybrid_search` is fresh (it's joined live), so this is invisible in the UI while
quietly degrading retrieval.

### R5 — Archived pages still answer questions (MED, CONFIRMED)

`lib/db/pages.ts:293-300` — `archivePage()` only flips `is_archived`; chunks are
untouched (they're removed only on real delete, via cascade). Neither
`hybrid_search` nor `neighbor_search` filters on `is_archived`. Archiving a page
to "put it away" does not stop the assistant retrieving it, citing it, and
linking to it.

### R6 — `reconcileChunks` deletes before embedding (MED, CONFIRMED)

`lib/rag/ingest.ts:107-186` — stale rows are deleted (:150-153), then new chunks
are embedded (:165) and inserted (:163-183), across three non-transactional
calls. If embedding throws (Ollama down), the page is left with **fewer** chunks
than either the old or the new state. Because ingestion is fire-and-forget, the
user gets no signal that the page's RAG index silently degraded.

### R7 — No delimiting around retrieved context (MED, CONFIRMED — structural)

`lib/rag/prompt.ts:11-29` concatenates retrieved chunk text into the user turn
with only a `[n] Title — heading` label — no fence, no XML wrapper, no escaping
(`chunker.ts:116` passes content through verbatim). A note containing
instruction-like text is indistinguishable from the real instructions. Blast
radius is small here (single user, own notes, local model), but there is zero
defense-in-depth. Cheap to improve: wrap sources in explicit delimiters and tell
the model to treat them as data.

### R8 — Unhandled `JSON.parse` in the NDJSON reader (MED, CONFIRMED)

`lib/llm/providers/ollama.ts:56,60` — no try/catch. A truncated line from a
killed Ollama throws a raw `SyntaxError` that is indistinguishable from any
other stream failure, and triggers R1's data-loss path.

### Confirmed clean in this area

- **No SQL injection in `hybrid_search`.** `query_text` is a bound RPC parameter
  and is parsed with `websearch_to_tsquery`, which tolerates arbitrary input by
  design. I verified this empirically — `tests/db/hybridSearch.test.ts` fires 10
  hostile strings (quotes, `& | !`, `:*`, unbalanced parens, `'; drop table
  chunks; --`, unicode, empty) and asserts none throw **and** that the chunks
  table still has all its rows afterwards.
- `/api/ai/edit` contains no Supabase import and no DB write — the propose-only
  rule holds.
- Embedding calls are batched at 32 (`ollama.ts:186-221`), not per-chunk.
- Vector dimensions are consistent and runtime-guarded (`ollama.ts:213-217`).
- RRF math matches standard k=60 fusion; heading-boundary chunking is correct.
- Required indexes exist (`chunks_embedding_idx` HNSW, `chunks_tsv_idx` GIN,
  `chunks_page_idx`, `links_source_page_idx`).

---

## What I'd fix first

1. **E1 + E3 + E4** — the block-persistence cluster. These are the only findings
   that destroy user content with no error and no undo. E1 is verified and
   reachable by an ordinary copy-paste.
2. **L1** — one wedged Ollama takes down all chat with no recovery short of a
   restart; a timeout is a few lines.
3. **R1** — losing an answer the user already watched stream in is very visible,
   and the fix is moving one block above a rethrow.
4. **R2** — silent, and only discovered long after the damage (a corrupted index
   looks like "the AI got worse").
