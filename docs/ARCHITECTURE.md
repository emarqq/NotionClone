# Personal Notion Clone — Phase 0 Architecture Doc

## Context

Erik is replacing Notion with a single-user, self-hosted knowledge workspace covering two domains (School, Work), with a built-in AI assistant that runs on a free local LLM (Ollama) today and a personally fine-tuned model later — swappable behind a provider interface with no app-layer rewrite. This document is the Phase 0 deliverable: schema, provider interface, RAG pipeline, and folder structure. **Approval of this plan = confirmation to build Phase 1 only** (core workspace, no AI). Phases 2–3 each get their own gate.

Decisions already made with Erik:
- **Supabase: local dev now, hosted later.** Everything goes through versioned migrations in `supabase/migrations/` so `supabase db push` to a cloud project works later with zero schema drift. No dashboard-only changes, ever.
- **Hardware: ≤16 GB RAM Mac** → default chat model `llama3.1:8b` (Q4), embeddings `nomic-embed-text` (768-dim). Both swappable via config.

---

## 1. Database schema (Supabase Postgres + pgvector)

Content model decision (the big one): **a real `blocks` table is the source of truth, one row per top-level editor node.** Tiptap's document maps 1:1 — each top-level ProseMirror node (paragraph, heading, toggle, table…) is one block row; *inline* rich text (bold, links, mentions) stays as a small ProseMirror JSON fragment inside that row's `content` column. This is the standard "Notion-on-Tiptap" pattern: it gives block-level granularity for AI operations, backlinks, and diff-based edits, without fighting ProseMirror by decomposing below the block level. The alternative (one JSONB doc per page) is simpler to sync but makes per-block AI ops, block-anchored backlinks, and partial saves much uglier — and the spec explicitly asked for a real schema. Trade-off flagged in §6.

| Table | Purpose | Key columns |
|---|---|---|
| `spaces` | Top-level School / Work | `id uuid pk`, `name`, `slug unique`, `icon`, `position` — seeded with School + Work |
| `pages` | Infinite-nesting page tree | `id`, `space_id fk`, `parent_page_id fk nullable (self)`, `title`, `icon`, `position text` (fractional index), `is_archived bool`, `created_at`, `updated_at` |
| `blocks` | One row per top-level editor node | `id`, `page_id fk cascade`, `parent_block_id fk nullable (self — toggle/list children)`, `type text check` (`paragraph, heading, checklist_item, table, code, callout, toggle, image, file_embed, divider, quote`), `content jsonb` (PM inline fragment + attrs, e.g. heading level, checked state), `position text` (fractional index), timestamps |
| `tags` | Global tag registry | `id`, `name citext unique`, `color` |
| `page_tags` | M:N | `pk (page_id, tag_id)` |
| `links` | Backlinks, derived on save from `@mention`/wikilink nodes in block content | `id`, `source_page_id`, `source_block_id`, `target_page_id`, `unique (source_block_id, target_page_id)`. Backlinks for page P = `select … where target_page_id = P` |
| `files` | Attachment metadata (bytes in Supabase Storage) | `id`, `space_id`, `page_id nullable`, `block_id nullable`, `storage_path`, `filename`, `mime_type`, `size_bytes`, `extraction_status` (`pending / done / failed / unsupported`), `created_at` |
| `chunks` | **Unified RAG + full-text index** for pages *and* files | `id`, `source_type` (`page` \| `file`), `page_id fk cascade nullable`, `file_id fk cascade nullable` (check: exactly one set), `space_id` (denormalized for filtering), `chunk_index int`, `heading_path text[]`, `content text`, `content_hash text`, `token_count int`, `embedding vector(768)`, `embedding_model text`, `tsv tsvector generated always as (to_tsvector('english', content)) stored` |
| `ai_conversations` / `ai_messages` | Chat history | conversation: `id`, `title`, `space_filter uuid nullable`; message: `id`, `conversation_id fk`, `role`, `content text`, `sources jsonb` (resolved citations), `created_at` |
| `app_settings` | Runtime config (active provider, model names, RAG params) | `key text pk`, `value jsonb` |

Indexes: HNSW on `chunks.embedding` (`vector_cosine_ops`), GIN on `chunks.tsv`, GIN on a generated tsvector over `pages.title`, btree on `(page_id, position)` for blocks, `(space_id, parent_page_id)` for pages, `target_page_id` on links.

Search RPC: `hybrid_search(query_text, query_embedding, space_filter, k)` — Postgres function doing FTS top-20 + cosine top-20 fused with **Reciprocal Rank Fusion**, returns top-k with source metadata. Global search UI and the RAG retriever share this one function (global search just also matches page titles).

Auth/RLS: Supabase Auth email login (just Erik), RLS enabled on all tables with a simple `auth.role() = 'authenticated'` policy — minimal, per the non-goals, but not disabled (matters when pushed to hosted).

Positioning: fractional indexing (string keys, e.g. `a0`, `a0V`) for pages and blocks — no mass reindex on drag-and-drop.

## 2. `LLMProvider` interface

Two interfaces, not one — chat/generation and embeddings are configured **independently**, because Erik will swap the chat model for his fine-tune but should keep the embedding model stable (changing it forces re-embedding the whole vault + a vector-dim migration).

```ts
// lib/llm/types.ts
interface LLMProvider {
  readonly id: string;                          // 'ollama' | 'custom-finetune' | 'anthropic'
  chatStream(req: ChatRequest): AsyncIterable<ChatDelta>;   // RAG panel, continue/draft
  generate(req: GenerateRequest): Promise<GenerateResult>;  // one-shot: summarize, format, rewrite
  capabilities(): { contextWindow: number; supportsJsonMode: boolean };
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;                  // must match vector(768) column
  embed(texts: string[]): Promise<number[][]>;
}

// ChatRequest = { messages: ChatMessage[]; system?: string; temperature?: number;
//                 maxTokens?: number; signal?: AbortSignal }
```

- **Registry pattern** (`lib/llm/registry.ts`): providers register by id; active ids resolved from env (`LLM_PROVIDER=ollama`, `EMBEDDING_PROVIDER=ollama`) with `app_settings` override via a settings page. Switching = config change only.
- **`OllamaProvider`** (default): `http://localhost:11434`, chat `llama3.1:8b`, embed `nomic-embed-text`. Called **only from server-side API routes** — never from the browser.
- **`providers/custom-finetune/`**: a real working stub implementing `LLMProvider` against an **OpenAI-compatible `/v1/chat/completions` endpoint** (what llama.cpp server, vLLM, and Ollama all expose), with a README explaining exactly what to change to point it at the LoRA-tuned model. Choosing the OpenAI wire format here means the fine-tune can be served by any of those runtimes with just a base-URL + model-name change.
- `AnthropicProvider` is an optional stub behind the same interface; app is fully functional without it.

All Category-B editing tools and the RAG assistant call the same registry — no separate model path anywhere.

## 3. RAG pipeline

```
INGEST (on page save, debounced 2s; on file upload → background job)
  page blocks ──┐
                ├→ extract text → chunk → embed (EmbeddingProvider) → upsert chunks
  files ────────┘   (pdf/docx/xlsx)   (heading-aware)      (skip if content_hash unchanged)

QUERY (AI panel question)
  question → embed → hybrid_search RPC (FTS + vector → RRF → top 8, optional space filter)
           → prompt assembly: numbered [1]..[8] source excerpts + breadcrumbs + question
           → LLMProvider.chatStream → stream to UI
           → citations [n] resolved to page/file links; full retrieved-source list ALWAYS shown
```

Defaults (each ambiguous per the spec, so: choice + reasoning, override welcome):
- **Chunking:** heading-aware splitting, target ~400 tokens, ~40-token overlap, each chunk prefixed with its breadcrumb (`Work > Meetings > 2026-06 > Pricing`). Heading-aware beats fixed-size because school/work notes are heading-structured, and the breadcrumb gives the 8B model orientation it otherwise lacks.
- **Retrieval:** top-20 FTS + top-20 vector → RRF → top 8 into the prompt (~3.2k tokens of context — safe in llama3.1's window with room for the answer). Hybrid because FTS catches exact terms (course codes, tickers, names) that pure cosine similarity misses.
- **Stale-chunk handling:** chunks carry `content_hash`; re-ingest deletes-and-replaces only changed chunks.
- **Citations:** the model is instructed to cite `[n]`; because 8B models are imperfect at this, the UI *always* renders the retrieved-sources panel independent of inline citations, so answers are verifiable even when citation markers are sloppy (flagged in §6).

Text extraction (all free/JS): PDF via `unpdf`, DOCX via `mammoth`, XLSX via SheetJS (`xlsx` — sheet cells → text rows). **PPTX: no good free JS extractor exists** — v1 stores/serves PPTX but marks `extraction_status='unsupported'` (not indexed). Flagged in §6.

## 4. Editor: Tiptap (ProseMirror)

Chosen over building on raw ProseMirror or using BlockNote/Editor.js because: (a) top-level-node ↔ block-row mapping fits the schema in §1; (b) ProseMirror **decorations** are exactly the machinery needed for the propose → diff → accept/reject overlay (render proposed text inline with add/remove marks *without touching the stored doc* — the hard requirement of never auto-committing falls out of the architecture); (c) headless — styling is ours via Tailwind; (d) mature ecosystem for slash-commands, mentions (`@page` → `links` rows), tables, task lists. AI proposals live client-side as pending transactions; only an explicit Accept dispatches + persists.

## 5. Folder structure

```
app/
  (workspace)/[spaceSlug]/[pageId]/page.tsx    # editor route
  search/  settings/
  api/ai/chat/route.ts                          # streaming RAG endpoint
  api/ai/edit/route.ts                          # Category-B tools (propose only)
  api/ingest/route.ts  api/files/route.ts
components/
  editor/        # Tiptap setup, block components, diff-review UI, selection context menu
  ai-panel/      # chat, citations, source list
  sidebar/       # space/page tree
lib/
  db/            # typed queries (supabase-js), fractional-index helpers
  llm/
    types.ts  registry.ts
    providers/ollama.ts
    providers/custom-finetune/   # working OpenAI-compatible stub + README
    providers/anthropic.ts       # optional
  rag/
    chunker.ts  retriever.ts  prompt.ts
    extractors/ (pdf.ts, docx.ts, xlsx.ts)
supabase/
  migrations/    # source of truth; `supabase db push` → hosted later
  seed.sql       # School + Work spaces
docs/ARCHITECTURE.md   # this document, committed to the repo
```

## 6. Flagged trade-offs (free/open-source constraints & open questions)

1. **Blocks table vs. page-level JSONB** — chose blocks table (AI/diff/backlink granularity, and the spec asked for it); cost is a sync layer between Tiptap transactions and block rows (~a day of careful work in Phase 1). JSONB-per-page would be simpler but blocks Category-B tooling.
2. **Embedding dim lock-in** — `vector(768)` matches `nomic-embed-text`. Swapping embedding models later = column alter + full re-embed (a script, not a redesign; `embedding_model` column makes stale rows detectable). A paid embedding API would be better quality but violates the local-free constraint — flagging per your instruction.
3. **8B citation faithfulness** — free-model constraint. Mitigated by always-visible source list; a cloud provider (optional `AnthropicProvider`) would cite more reliably.
4. **PPTX text extraction** — no solid free JS library. v1: stored but unindexed. Alternatives if it matters: LibreOffice headless conversion or a tiny Python sidecar (both free but add a runtime dep) — decide later.
5. **Postgres FTS vs. dedicated search** (Meilisearch etc.) — staying in Postgres per your "avoid extra infra" preference; FTS + trigram is plenty at personal-vault scale.

## 7. Phase plan (each phase gated on Erik's confirmation)

- **Phase 1 (on approval of this plan):** Next.js 15 + TS + Tailwind scaffold, local Supabase stack (`supabase init/start`), migrations for §1 schema, page tree CRUD + sidebar, Tiptap block editor with block-row persistence, file upload to Storage with inline image/PDF preview. **No AI, no search.**
- **Phase 2:** extraction pipeline, chunker, embedding worker, `hybrid_search` RPC, global search UI, RAG demonstrated via test route.
- **Phase 3:** AI panel (streaming chat + citations), provider registry + Ollama default + fine-tune stub, all five Category-B editing tools with propose → diff → accept/reject.

### Phase 1 verification checklist (what Erik runs at the gate)
1. `supabase start` && `supabase db reset` — migrations + seed apply cleanly, School/Work spaces exist.
2. `npm run dev` → create nested pages 3 levels deep in both spaces; reload — tree persists.
3. Type mixed content (headings, checklist, toggle, table); reload — blocks persist as rows (`select type, count(*) from blocks group by 1` in Studio shows real block rows, not one blob).
4. Drag-reorder blocks and pages — order survives reload (fractional indexing).
5. Upload a PDF + an image to a page — image renders inline, PDF previews, rows in `files` with `extraction_status='pending'`.
6. `npm run typecheck` && `npm run lint` pass.

## Addendum — Feature batch (2026-07-03)

**Tab system:** Zustand store (`kh-tabs` localStorage persistence) in `components/tabs/` + `components/app-shell/AppShell.tsx`. Navigate-in-tab semantics with in-app back/forward history (per-tab scroll restore). Shortcuts: ⌘T (new tab), ⌘W (close), ⌘1–9 (tab index), ⌘\ (toggle sidebar).

**Schema migration 20260703100000:** Added `pages.is_favorite bool` and `pages.last_viewed_at timestamp`. Set `position` columns to `COLLATE "C"` (fixes fractional-index ordering bug). Replaced `pages.updated_at` trigger with `set_updated_at_ignore_view_meta()` — viewing/starring no longer bump edited date; only block edits (via `replacePageBlocks`) trigger it.

**New `lib/db/pages` functions:** `toggleFavorite(pageId)`, `touchLastViewed(pageId)`, `getFavorites(spaceId)`, `getRecents(spaceId)`, `duplicatePage(pageId, space?)` (shallow, fresh block UUIDs), `movePageToSpace(pageId, targetSpaceId)` (subtree cascade, files included).

**Sidebar + home:** Sections: Home (dashboard), Favorites, Recents. Route `/home` dashboard.

**Meeting notes:** `app/actions/meetings.ts` — template action seeding 8 validated blocks (date header, attendees, agenda, notes, decisions, next steps, transcript link, close-date picker).

**Page metadata & outline:** `components/page-meta` bar (favorites, last-viewed timestamp, metadata). `components/editor/OutlinePanel.tsx` — DOM-driven MutationObserver + IntersectionObserver for heading-level TOC; closes on nav.

**Desktop:** real Electron app (macOS only), own npm package at `desktop/electron/` (electron + electron-builder devDeps, not part of the root Next.js app); main process `desktop/electron/src/main.js` ports the `launch.sh`/`stop.sh` startup sequence (colima → Supabase → `next start -p 3777`, idempotent reuse, detached server so quitting the app doesn't kill it). Installed as "Notion Clone.app" to `~/Applications` (ad-hoc signed); old Chrome-app-mode shim kept as fallback at "Notion Clone (Chrome).app". Logs at `~/Library/Logs/NotionClone.log`. See `desktop/README.md`.

## Addendum — Phase 3 AI assistant (built 2026-07-03)

Phases 2+3 landed together, exactly per §2–§5 above. Key facts for future work:

- **`lib/llm/`**: `types.ts` + `registry.ts` (resolution: `app_settings` keys `llm_provider_id`/`embedding_provider_id` → env `LLM_PROVIDER`/`EMBEDDING_PROVIDER` → `ollama`; instances cached, settings cached 30s). Providers: `providers/ollama.ts` (`/api/chat` NDJSON streaming, `/api/embed` batched ×32, 768-dim enforced) and `providers/custom-finetune/` (OpenAI-compatible SSE; README documents the fine-tune swap — env vars only, embeddings stay on nomic-embed-text). Env defaults: `OLLAMA_BASE_URL` http://localhost:11434, `OLLAMA_CHAT_MODEL` llama3.1:8b, `OLLAMA_EMBED_MODEL` nomic-embed-text, `CUSTOM_LLM_BASE_URL/_MODEL/_API_KEY`.
- **Migration `20260703200000_hybrid_search.sql`**: `hybrid_search(query_text, query_embedding vector(768), space_filter uuid, match_count int)` — top-20 FTS (websearch_to_tsquery) + top-20 cosine, RRF k=60, returns chunk cols + resolved `title`; explicit GRANT EXECUTE (local images ship no default grants).
- **`lib/rag/`**: `chunker.ts` (heading-aware, ~400 tok target / ~40 overlap, chars÷4 estimate, breadcrumb prefix, sha256 `content_hash`), `blockText.ts` (ProseMirror JSON → segments; collapses a leading h1 that duplicates the page title), `extractors/` (unpdf per-page / mammoth / xlsx per-sheet; pptx+images → unsupported), `ingest.ts` (hash-diff reconcile: keeps unchanged rows without re-embedding), `retriever.ts`, `prompt.ts`. Chunk deletion on page/file delete is FK-cascade, no code path.
- **Ingestion triggers**: `after()` in `saveBlocksAction`, `renamePageTitleAction`, `movePageToSpaceAction` (re-ingests subtree — breadcrumbs/space_id change), file upload route. Backfill/reindex: `POST /api/ingest` `{pageId?|fileId?|all?}`.
- **Routes**: `POST /api/ai/chat` (SSE: `meta` w/ enriched sources+hrefs → `delta`* → `done`; persists to `ai_conversations`/`ai_messages`, last-8-message history window, partial responses persisted with `_(response interrupted)_`), `POST /api/ai/edit` (5 tools; **propose-only, provably never writes** — verified by block-hash snapshots before/after).
- **UI**: `components/ai-panel/` (⌘J toggle, zustand `kh-ai-panel`, sources list always rendered under every assistant message independent of `[n]` markers), `components/editor/AIToolsMenu.tsx` (BubbleMenu; Tiptap 2.27's built-in — do NOT add `@tiptap/extension-bubble-menu`, that's v3) + `AIProposalCard.tsx` (diffWords red/green, Accept dispatches one editor transaction → normal debounced save; Reject/Esc discards) + SlashMenu "Continue writing".
- **Known limitation (§6.3 confirmed in practice)**: llama3.1:8b can hallucinate on sparse sources despite the grounding prompt (fabricated a "chapter 3" from a 2-line note in verification). The always-visible sources list is the mitigation; a stronger chat model or the fine-tune improves this.

## Addendum — Desktop build caveat & cleanup (2026-07-04)

- **Stale-build gotcha:** the desktop app (`~/Applications/Notion Clone.app`) loads the `:3777` **production** server (`next start`), a different surface from the `:3000` dev server. Source edits appear live on `:3000` but not in the desktop app until you `npm run build` and restart `:3777` — the Electron startup reuses an existing `.next` build (only rebuilds when `.next/BUILD_ID` is missing). Don't `next build` while `:3000` dev is running (both write `.next`). Rebuild recipe is in the root `README.md` and `CLAUDE.md`.
- **Duplicate-app cleanup:** removed redundant bundles — `desktop/electron/dist/` (regenerable via `npm run dist`, gitignored), the old `desktop/Notion Clone.app` stub, and the Chrome-app-mode shim `~/Applications/Notion Clone (Chrome).app`. The source repo + `~/Applications/Notion Clone.app` are the only remaining copies.
- **Turbopack build:** `npm run build` (`next build --turbopack`) + `next start -p 3777` verified working end-to-end (was previously flagged broken; see `desktop/README.md`).

## Addendum — Markdown export / Obsidian vault mirror (2026-07-07)

One-way mirror of every page to Markdown in an Obsidian vault. **Postgres stays the source of truth; there is deliberately no file → Postgres import.** New module `lib/export/`:

- **Serializer** (`serialize.ts`, pure/sync): ProseMirror block JSON → Obsidian Markdown via a hand-rolled walker (extends `lib/rag/blockText.ts`). NOT `@tiptap/markdown` — that package is **Tiptap v3-only** and this repo is 2.27; the walker also degrades gracefully on the editor's injected `comment` mark / `blockId` attr / foreign `file_embed` rows, where a reconstructed-schema serializer would throw. Custom nodes: callout → `> [!note] {emoji}`, toggle → foldable callout `> [!note]{+|-} {summary}`, pageMention → `[[basename]]` (aliased `[[basename|label]]` on collision, resolved via the manifest); `comment` mark stripped. `prosemirror-markdown` is a documented inline-escaping fallback (not currently used).
- **Frontmatter** (`frontmatter.ts`): gray-matter/js-yaml — **never hand-concatenated** (js-yaml quotes wikilink values like `"[[Parent]]"`). Fields: `id, title, icon, created, updated, parent: "[[…]]", aliases: [id]`. **Tags omitted** (schema exists but is written nowhere yet — add `getPageTags` + the field once a tag-writer ships); **`space` omitted** (the top folder encodes it, so a space-move stays a pure fs rename).
- **Filenames / manifest**: readable sanitized title; sidecar `<vault>/.notion-export/manifest.json` maps `pageId → {segment, path, hash, title, archived}` so renames/moves rename files instead of orphaning them. Layout `<Space>/<ancestors…>/<Title>.md` with a sibling `<Title>/` folder for children (Notion-export style); `<name>.md` and `<name>/` share one collision namespace. Archived pages (or any with an archived ancestor) mirror under `Archive/`.
- **Atomic + safe** (`vaultFs.ts`): temp-file + rename (same volume, EXDEV-safe; never clobbers a good file on a failed serialize), every path resolved **within** the owned `<vault>/Notion` root, and a single process-local serial op queue (`manifest.ts` `withExportLock`) so concurrent `after()` hooks never race on the fs/manifest.
- **Triggers** (`schedule.ts`): `scheduleExport` / `scheduleExportRename` / `scheduleDelete` wired next to the RAG `scheduleIngest` in `saveBlocksAction` + `renamePageTitleAction` and the `pages.ts` create/rename/move/moveToSpace/setIcon/duplicate/archive/delete actions. Rename/reparent/space-move all reduce to one path-reconcile (move `.md` + child folder, rewrite descendant manifest prefixes); rename additionally re-exports the page's **direct children** (their `parent` wikilink) and **backlink sources** (`getBacklinks`, so inbound `[[oldName]]` links don't break).
- **Backfill**: `POST /api/export {pageId?|all?}` (clones `/api/ingest`). `all` = two-phase reconcile (assign every path, then serialize so all `[[wikilinks]]` resolve to exact basenames) + prune manifest-tracked orphans. Config: `EXPORT_VAULT_DIR` (default `~/ObsidianVault/NotionClone`, leading `~` expanded), `EXPORT_ENABLED=false` to disable. **nodejs runtime only** (fs/os); never runs at import/build time.
