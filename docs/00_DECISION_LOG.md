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
