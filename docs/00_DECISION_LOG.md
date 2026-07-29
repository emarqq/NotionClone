# Decision Log

> Authoritative. Decisions here are settled — do not relitigate without new information.
> To change one, add a new entry that explicitly **supersedes** the old by number.
> Claude authors these directly; Erik decides product, scope and risk appetite only.

---

### D-001 — Evolve the existing app; do not rewrite. (2026-07-29)

**Context.** Erik offered a full rebuild if the architecture is wrong, but stated that
preserving the existing pages is crucial.

**Decision.** Evolve. Keep the Next.js 15 + Supabase + Tiptap stack and the existing
database, and migrate the block model in place.

**Reasoning.** The parts that are genuinely hard and genuinely done — the page tree with
fractional indexing, the RAG pipeline with hash-diffed chunking, the hybrid-search RPC,
the provider registry, the markdown vault mirror, the Electron shell, the tab shell —
are all sound and would have to be rebuilt identically. The defects are concentrated in
*one* place: the editor save path. A rewrite would spend the entire budget reaching
today's feature set, and would put the irreplaceable data through an unnecessary
migration. **Rejected alternatives:** (a) rewrite on a local-first CRDT engine
(Yjs/Automerge/Electric) — genuinely better for multi-device and offline, but it is a
ground-up change to persistence, RAG ingest and export all at once, for a single user on
a single machine who does not have a sync problem today; (b) adopt an off-the-shelf
Notion clone (AppFlowy, Affine, Docmost) — abandons the RAG/knowledge-graph work that is
the main reason this app exists rather than being Notion.

**Consequence.** The roadmap's first structural item is the block-tree migration
(D-002), not a greenfield schema.

---

### D-002 — The flat block model is the root defect and must become a real tree. (2026-07-29)

**Context.** `blocks` stores one row per *top-level* ProseMirror node.
`blocks.parent_block_id` exists in the schema but is written `null` everywhere. Every
save is a whole-document replace: rewrite all rows, `DELETE … WHERE id NOT IN (…)`, and
regenerate every `position`.

**Decision.** Move to a genuine block tree with stable identity and incremental,
transactional writes. Do it as a sequence of small, individually shippable steps rather
than one migration, and land the *safety* fixes (D1/D2 in the brief) before the
*structural* ones.

**Reasoning.** This single design choice causes, directly:
- **D1** cross-page block-id theft (upsert on a pasted id reassigns `page_id`),
- **D2** overlapping saves deleting newly-typed blocks (`NOT IN` delete with no
  in-flight guard),
- **D6** fractional indexing being pointless because every position is rewritten anyway,
and it is a hard ceiling on nested toggles, multi-column layouts, synced blocks, inline
databases and block-level page history — i.e. on most of what "all of Notion" means.
Patching the save path without fixing the model would leave the ceiling in place.

**Consequence.** `parent_block_id` becomes real and indexed; writes become diff-based
(insert/update/delete only what changed); a block row is owned by exactly one page and
the server refuses to re-parent a row that another page owns.

---

### D-003 — Stay local-primary on Postgres; the hosted Pro project is for durability, not serving. (2026-07-29)

**Decision.** Keep the local Supabase stack as the read/write primary. Use the new Pro
subscription for off-site backup storage and as a scratch target for migration
verification — not as the live database.

**Reasoning.** Full analysis in `docs/audit/SUPABASE-PRO-LEVERAGE.md` §4. Summary: the
app is server-first with several sequential queries per page open; local Postgres answers
in ~1 ms and `us-west-2` in 30–90 ms, turning an imperceptible page open into a visible
200–500 ms stall and putting the internet in the middle of a RAG pipeline whose LLM is on
`localhost`. It would also break offline use of a laptop notes app, for +$10/mo.

**Revisit when** Erik wants the app on a second device — at that point shared hosted
Postgres plus Realtime Broadcast/Presence becomes the only sane design and the latency
cost is worth paying.

---

### D-004 — Backups come before features. (2026-07-29)

**Decision.** The nightly `pg_dump` + off-site copy + **restore drill** is the first
thing installed, ahead of any roadmap feature.

**Reasoning.** On 2026-07-07 a routine `supabase db reset` destroyed a "Personal" space
and dozens of pages. Nothing about that risk has changed since: inspection on 2026-07-29
confirmed no hosted project holds this data and no backup exists. Every hour spent
building features on an unbacked-up database is borrowed against the same accident. A
backup that has never been restored is a rumour, so the drill is part of the deliverable,
not a follow-up.

---

### D-005 — The markdown vault mirror is a content mirror, not a backup, and must not be sold as one. (2026-07-29)

**Context.** `lib/export/` continuously mirrors pages to `~/ObsidianVault/NotionClone`.
It is why the July incident was not total.

**Decision.** Keep and harden it as the knowledge-graph surface (Erik's explicit
priority: *"every page that is created should turn into an MD file that's included in
the knowledge graph"*). Do **not** count it as the backup.

**Reasoning.** It preserves prose and wikilinks only. It does not preserve block-level
structure or `blockId` attrs, inline comments, database property values and
`db_property_options`, `links` backlink rows, RAG `chunks`/embeddings, favorites/recents,
`app_settings`, fractional `position` keys, or Auth users. Restoring from it would
produce a pile of documents, not the app's state.

---

### D-006 — Older planning docs are downgraded to non-authoritative. (2026-07-29)

**Decision.** `docs/FEATURE-PLAN.md` and `docs/notion-feature-ideas.md` are no longer
inputs to the work queue. `docs/plan/ROADMAP.md` supersedes both.

**Reasoning.** `FEATURE-PLAN.md` is documented-stale — items 1, 2, 3, 7 and 9 are marked
"not started" and have in fact shipped, which makes it actively misleading to an
autonomous session picking work off it. `notion-feature-ideas.md` is unfiltered
brainstorm with no prioritisation and no distinction between "Notion does this" and
"this would be neat". Erik has authorised cutting proposed features that are bad ideas;
the roadmap is where that filtering is recorded.

---

### D-007 — Cross-page block-id theft is fixed on the server, not in the paste handler. (2026-07-29)

**Context.** `CODE_REVIEW.md` §E1, VERIFIED at SQL level: `data-block-id` survives the OS
clipboard, and `replacePageBlocks`'s `upsert(..., { onConflict: "id" })` sets
`page_id: pageId` on conflict — so pasting a block copied from page A into page B *moves*
the row, deleting the paragraph from page A with no error and no undo path. The previous
review deferred this as "needs a human decision".

**Decision.** Fix it in `replacePageBlocks`: an incoming block id whose row is already
owned by a different page is **reminted** to a fresh uuid rather than adopted, and the
remap is returned to the caller so the editor can rewrite its `blockId` attrs in place.
No block row ever changes `page_id` through the editor save path.

**Reasoning.** The three candidates were (a) strip `blockId` on paste, (b) strip only on
cross-page paste, (c) guard server-side. (a) is wrong: the same ProseMirror paste path
handles drag-and-drop, so it would remint ids on every drag and detach every
`comment_threads.block_id` anchor (`20260707000000_inline_comments.sql:14`; they survive
via `on delete set null`, but detached is still lost). (b) requires the client to know
what the server owns — it cannot, without a round-trip, which is exactly the server check
in (c). (c) also closes the hole for ids that arrive by any *other* route (import, AI
tools, a future API), which (a) and (b) do not. The cost is one extra `select` per save,
which B1 (diff-based writes) will reduce to only the ids that actually changed.

**Consequence.** Roadmap A2. `replacePageBlocks` gains a return value; callers that
ignore it are not wrong, only lossier (the pasted block keeps working, it just carries a
new id on the next load).

---

### D-008 — There will be no tags UI; `tags`/`page_tags` are scheduled for removal. (2026-07-29)

**Context.** `tags` and `page_tags` have existed since the initial schema with zero reads
and zero writes, and `docs/FEATURE-PLAN.md` still lists a tags UI as planned work.

**Decision.** Do not build it. Drop both tables in a later migration once a grep confirms
nothing reads them.

**Reasoning.** Notion has no global tag system — it has multi-select *properties* on
database rows, which `db_property_options` and the database-pages work already implement
(and which are strictly more useful, being per-database and typed). A parallel global tag
namespace would be a second, weaker way to categorise the same pages, and every such
duplicate surface is one more thing to keep consistent for a single user who did not ask
for it. Inert schema is not free: it shows up in every schema read, every audit, and
every future migration.

---

### D-009 — LLM and embedding fetches get default timeouts chosen by me, not by Erik. (2026-07-29)

**Context.** `CODE_REVIEW.md` §L1. No `AbortSignal.timeout` anywhere in `lib/llm/`;
`EmbeddingProvider.embed()` takes no signal at all. The 2026-07-26 session listed "what
timeout is right" as needing Erik's decision, and therefore shipped nothing — leaving a
HIGH-severity hang in place for three days over a number.

**Decision.** 30 s per chat/generation request, 15 s per embedding call, both overridable
via env (`LLM_TIMEOUT_MS`, `EMBEDDING_TIMEOUT_MS`). `EmbeddingProvider.embed()` takes an
`AbortSignal` — an interface change, so the provider contract suite in `tests/llm/` is
updated with it.

**Reasoning.** These are engineering defaults, and engineering is mine to decide (brief
preamble). A local 8B model on Erik's machine answers a first token in well under 30 s or
it is wedged; embeddings are sub-second and 15 s is already 20× headroom. Any timeout at
all is enormously better than the current behaviour, and a wrong-by-2× timeout is a
tunable env var, not a defect. Blocking a HIGH data-availability fix on a preference
question was the actual mistake.
