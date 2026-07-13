# Second-Brain / Obsidian Mirror — Investigation Report

> Read-only investigation for designing an external "second brain" that mirrors this
> app's pages into an Obsidian vault as markdown. Generated 2026-07-11 on branch
> `feat/markdown-export`. Concrete file paths and code references throughout; where
> something is missing or uncertain it is called out explicitly.

## ⚠️ Headline finding (read this first)

**The app does not write markdown into Supabase Storage.** The markdown-export feature
you recently added writes rendered, Obsidian-flavored `.md` **directly to a local
filesystem vault** (default `~/ObsidianVault/NotionClone`), and it **already emits
`[[wikilinks]]`**. So the premise "pull all `.md` files from a Storage bucket" does not
match reality — there are no `.md` files in Storage to pull.

The cleanest second-brain design is therefore **not** a Storage sync script. It's one of:
- **Point the exporter at your Obsidian vault** — set `EXPORT_VAULT_DIR` to the vault
  path; the app renders wikilinked markdown to disk on every page save. (Recommended.)
- **Read the existing export directory** + its manifest (`.notion-export/manifest.json`)
  and copy/rsync into Obsidian.
- **Regenerate markdown yourself from the DB** using the reusable serializer
  `lib/export/serialize.ts` if you want full control over frontmatter/filenames.

The only thing genuinely worth a Storage pull is **attachments/images** (see §4/§5),
which *are* in a private `attachments` bucket and are currently left as unresolved
`/api/files/{id}` references inside the exported markdown.

---

## 1. Project shape

**Framework / language** (`package.json`):
- Next.js `15.5.20`, App Router, Turbopack (dev + build). React `19.1.0`. TypeScript `^5`.
- Supabase: `@supabase/supabase-js ^2.110.0`, `@supabase/ssr ^0.12.0`.
- Editor: TipTap `^2.27.2` (+ `prosemirror-markdown`). State: `zustand ^5`.
- Ordering: `fractional-indexing`. Frontmatter: `gray-matter`. Import parsers:
  `mammoth`/`unpdf`/`xlsx`. Tailwind CSS `^4`.

**Top-level directories:**
- `app/` — App Router. `app/actions/*` server actions (pages, editor, ai, comments,
  meetings); `app/api/*` route handlers (ai, comments, export, files, import, ingest,
  pages, spellcheck); `(workspace)/` route group; `login/`.
- `components/` — UI by feature: editor, sidebar, ai-panel, tabs, app-shell, backlinks,
  comments, files, page-actions, page-cover, page-meta, settings, theme.
- `lib/` — core logic: `supabase/` (clients), `db/` (data access), `export/` (markdown
  mirror), `import/` (doc importer), `rag/`, `llm/`, `links/`, `comments/`; plus
  `env.ts`, `positions.ts`.
- `supabase/` — local stack: `config.toml`, `seed.sql`, `migrations/` (6 SQL files).
- `desktop/` — Electron wrapper (own package.json). `docs/` — design docs
  (`ARCHITECTURE.md` is authoritative). `middleware.ts` — auth/session refresh.

**Supabase client configuration** — all in `lib/supabase/`, env read via
`requireEnv()` in `lib/env.ts`:
| File | Function | Key used | Purpose |
|---|---|---|---|
| `lib/supabase/client.ts` | `createBrowserSupabase()` | anon | Browser, cookie session |
| `lib/supabase/server.ts` | `createServerSupabase()` | anon | Server components/actions, respects RLS |
| `lib/supabase/server.ts` | `createServiceSupabase()` | **service role** | Server-only, **bypasses RLS** |
| `lib/supabase/middleware.ts` | `updateSession()` | anon | Refresh cookie, redirect to `/login` |

`createServiceSupabase()` (`lib/supabase/server.ts:43`) is the pattern an external script
should replicate — plain `createClient(url, serviceKey, { auth: { persistSession:false }})`,
with a runtime guard that throws if run in a browser.

**Env vars for the DB connection** (`.env.example`; real values in `.env.local`, not read):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Export/import-related env: `EXPORT_VAULT_DIR`, `EXPORT_ENABLED`, `IMPORT_SOURCE_DIR`.
There is **no shared dotenv loader** — each client-creation site reads `process.env`
directly, so an external script must load its own env.

---

## 2. Supabase schema

Schema lives only in `supabase/migrations/` (never dashboard). Everything is created in
`20260703000000_initial_schema.sql`; later migrations add columns/RPCs.

### Hierarchy: `spaces` → `pages` (self-referential tree)

**`spaces`** — root. `id uuid PK`, `name`, `slug UNIQUE`, `icon`, `position (collate "C")`,
`created_at`. Seeded with two spaces: **School** (`school`) and **Work** (`work`); no
pages/blocks are seeded.

**`pages`** (`initial_schema.sql:19`):
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| space_id | uuid NOT NULL | **FK → spaces ON DELETE CASCADE** |
| parent_page_id | uuid | **FK → pages(id) ON DELETE CASCADE** — the hierarchy |
| title | text NOT NULL default 'Untitled' | |
| icon | text | |
| position | text NOT NULL (collate "C") | fractional index |
| is_archived | boolean | |
| created_at / updated_at | timestamptz | `updated_at` trigger-maintained |
| is_favorite, last_viewed_at | | added `20260703100000` |
| cover_url, cover_position | | added `20260703300000`; `cover_url` stores a `files.storage_path` |

Hierarchy = `parent_page_id` self-FK (NULL = top-level), scoped by `space_id`.

### Content: the `blocks` table (source of truth)

**`blocks`** (`initial_schema.sql:34`) — **one row per top-level Tiptap/ProseMirror node**:
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| page_id | uuid NOT NULL | **FK → pages ON DELETE CASCADE** |
| parent_block_id | uuid | FK → blocks(id) CASCADE (rarely used; nesting lives in JSON) |
| type | text NOT NULL | CHECK: `paragraph, heading, checklist_item, bullet_list, ordered_list, table, code, callout, toggle, image, file_embed, divider, quote` |
| **content** | **jsonb NOT NULL default '{}'** | **the ProseMirror node JSON** |
| position | text NOT NULL (collate "C") | fractional index |
| created_at / updated_at | timestamptz | |

Confirmed by `components/editor/blockSync.ts` (`node.toJSON()` → `content`;
`docFromBlocks()` rebuilds `{type:"doc",content:[...]}`). **Nested structure (table rows,
task items, toggle bodies) lives *inside* that JSON, not as separate block rows** — so to
render a page you read its block rows ordered by `position` and treat each `content` as a
full top-level PM node.

**Shape of one `content` field** (constructed from the code model — no block seed data
exists). A heading row:
```json
{ "type": "heading", "attrs": { "level": 2 },
  "content": [ { "type": "text", "text": "Project Notes" } ] }
```
A paragraph with bold, an internal link mark, and a page mention:
```json
{ "type": "paragraph", "content": [
  { "type": "text", "text": "See " },
  { "type": "text", "marks": [{ "type": "bold" }], "text": "the plan" },
  { "type": "text", "marks": [{ "type": "link",
      "attrs": { "href": "/work/2222…-2222" } }], "text": "here" },
  { "type": "pageMention", "attrs": { "pageId": "1111…-1111" } }
] }
```
(Editor node names like `taskList`/`taskItem` map to the `type` enum values such as
`checklist_item` via `NODE_TYPE_TO_BLOCK_TYPE` in `blockSync.ts`; the stored JSON keeps
the ProseMirror type name.)

### Links / backlinks: the `links` table

**`links`** (`initial_schema.sql:62`) — denormalized page graph:
```
links(id, source_page_id → pages CASCADE, source_block_id → blocks CASCADE,
      target_page_id → pages CASCADE, created_at, UNIQUE(source_block_id, target_page_id))
```
- **Backlinks** = `WHERE target_page_id = X`; **forward links** = `WHERE source_page_id = X`.
- Reconciled from block content by `reconcilePageLinks()` in `lib/db/links.ts`; read by
  `getBacklinks()`. This table is a clean queryable page graph if you'd rather not parse JSON.

### Other tables (for completeness)
- **`files`** — attachment metadata (see §4). **`chunks`** — RAG (plain-text extraction +
  `vector(768)` embeddings; `source_type ∈ {page,file}`; `space_id` has **no FK**, by design).
- **`tags`**/**`page_tags`** — tagging (present in schema; **not surfaced in exported
  frontmatter**, see §3). **`comment_threads`**/**`comments`** — inline comments (a
  ProseMirror `comment` mark carrying a `threadId` is the source of truth).
- **`ai_conversations`**/**`ai_messages`**, **`app_settings`**.

RLS is enabled on every table with a blanket `authenticated` full-access policy;
server writes use the service-role client which bypasses RLS.

---

## 3. The markdown conversion

**Location:** `lib/export/` (the page exporter — the feature you added) and a separate
`lib/import/` (document importer that mirrors external reference docs). Key files:
`exportPage.ts` (orchestration), `serialize.ts` (PM-JSON → markdown), `frontmatter.ts`,
`manifest.ts`, `paths.ts`, `vaultFs.ts`, `config.ts`, `schedule.ts`, plus
`app/api/export/route.ts`.

**Is it complete/working?** **Yes — substantially complete and live**; a subagent
confirmed real generated files on disk under `~/ObsidianVault/NotionClone/`. Deferred /
lossy pieces, all explicitly commented, not stubs that throw:
- **Images are markers only, not copied** (`serialize.ts:220` — byte-copy to
  `_attachments/` is "v2"). Emits `![alt](/api/files/{id})`, which won't render in Obsidian.
- **Comment marks are intentionally stripped** (`serialize.ts:98`).
- **Editable-page import deferred** (`importDoc.ts:48` — a documented seam).
- **No `tags` in frontmatter** even though `tags`/`page_tags` exist in the schema.

**What triggers it?** Automatic **fire-and-forget hooks on every page mutation** via
`after()` in `lib/export/schedule.ts` (same pattern as RAG ingest; a failed export never
breaks the save):
- block save → `scheduleExport(pageId)` (`app/actions/editor.ts:49`)
- rename → `scheduleExportRename()` (re-mirrors children's `parent` link + inbound backlinks)
- create / move / reparent / set-icon / duplicate / move-to-space → `scheduleExport()`
- delete → `scheduleDelete()`
- Batch: `POST /api/export {all:true}` → `reconcileAll()`; `{pageId}` re-mirrors one page.

**No migration, no cron.** Note: `reconcileAll()` is reachable **only via the
`/api/export` route** — no UI button is wired to it. So per-save hooks are the only live
trigger in normal use; a full backfill must be POSTed manually.

**What has actually been converted?** Live trees exist on disk under both `Notion/`
(exported pages) and `Imported/` (imported docs), including a stray `Personal` space —
matching STATE.md's note about pending uncommitted work. Because export is per-save, only
pages touched since the feature went live are guaranteed mirrored; **run `POST /api/export
{all:true}` once to backfill everything** before relying on completeness.

**Buckets / paths / naming** — **filesystem, not Storage** (`config.ts`):
- Vault root: `EXPORT_VAULT_DIR`, default `~/ObsidianVault/NotionClone`.
- Exporter owns `<vault>/Notion/` (`EXPORT_SUBDIR="Notion"`); importer owns
  `<vault>/Imported/`. Archived subtrees under `<vault>/Notion/Archive/`.
- Manifests (dot-folders Obsidian ignores): `<vault>/.notion-export/manifest.json`,
  `<vault>/.notion-import/manifest.json`.
- **One `.md` per page.** Path mirrors the page tree:
  `<vault>/Notion/<Space>/<ancestor titles…>/<Title>.md`, with a parallel `<Title>/`
  folder holding descendants. Segments are sanitized titles (`paths.ts:sanitizeSegment`,
  120-char cap, illegal chars stripped, page-id fallback); collisions get ` (2)`, ` (3)`.
- Writes are atomic (temp + rename); a content-hash in the manifest skips unchanged files.

**Frontmatter** — built with `gray-matter`/`js-yaml` (`frontmatter.ts` +
`exportPage.ts:130`). Fields for exported pages: `id`, `title`, `icon`, `created`,
`updated`, `parent` (as `"[[Parent basename]]"`, omitted at top level), `aliases`
(`[pageId]`), `archived`. **No `tags`.** Real head of an exported file
(`~/ObsidianVault/NotionClone/Notion/Work/AIdentified.md`):
```yaml
---
id: 7660d368-d1aa-4b93-9c8e-3caf12c8a739
title: AIdentified
created: '2026-07-09T19:36:27.452178+00:00'
updated: '2026-07-09T19:36:35.136609+00:00'
aliases:
  - 7660d368-d1aa-4b93-9c8e-3caf12c8a739
---
```
Imported docs use the same builder plus `imported: true` and `sourcePath`.

**PM-JSON → markdown** — `lib/export/serialize.ts` →
`serializeBlocksToMarkdown(blocks, { resolveWikilink })`: a hand-rolled, pure, one-way
recursive ProseMirror walker (deliberately not `@tiptap/markdown`, which is v3-only; repo
is on TipTap 2.27). Emits Obsidian-flavored markdown (headings, nested lists/tasks,
blockquotes, fenced code with language, tables, `> [!note]` callouts, foldable toggles,
`---`, images-as-markers). Inline marks → `**bold**`, `*italic*`, `~~strike~~`,
`==highlight==`, `<u>…</u>`, inline code, links; comment marks stripped. Degrades
gracefully on unknown nodes (never throws).

---

## 4. Relations & links

### Page-to-page links — preserved, already emitted as `[[wikilinks]]`

Stored in two layers:
1. **In block `content` JSON** (source of truth): a **`pageMention` inline atom node**
   (`components/editor/extensions/page-mention.ts`, `attrs.pageId`/`label`/`spaceSlug`) —
   the primary mechanism — or a **`text` node with a `link` mark** whose `href` is an
   internal path `/{slug}/{uuid}`. External URLs are plain and untracked.
2. **The `links` table** (denormalized graph, reconciled by `lib/db/links.ts`).

**Survival into markdown:**
- **`pageMention` atoms → real Obsidian wikilinks** (`serialize.ts:104` `renderMention`):
  `[[<targetBasename>]]` or `[[<targetBasename>|<label>]]`, resolving page-id → current
  vault basename via the `resolveWikilink` callback (fed from the export manifest). A
  two-phase reconcile in `reconcileAll()` guarantees targets resolve. **This is exactly
  what you need for Obsidian.**
- **Internal `link`-mark links are NOT converted** — they render as
  `[text](/slug/uuid)` (`serialize.ts:99`), a dead relative URL in Obsidian. Only
  mention-atoms become wikilinks. If you regenerate markdown yourself, supply your own
  `resolveWikilink` mapping and also rewrite these internal-href link marks (match
  `/^\/[^/]+\/([0-9a-f-]{36})/`, see `lib/links/extract.ts`) into wikilinks.

### Attachments / images — separate private bucket + `files` table

- Bytes live in a **private Supabase Storage bucket named `attachments`**
  (`initial_schema.sql:209`, `public=false`, authenticated-only RLS). **Not** base64,
  **not** in block content.
- Metadata in **`files`** (`initial_schema.sql:72`): `id, space_id, page_id, block_id,
  storage_path (UNIQUE), filename, mime_type, size_bytes, extraction_status, created_at`.
- **Upload path convention** (`app/api/files/route.ts:73`):
  `${space_id}/${pageId}/${randomUUID()}-${filename}` inside `attachments`. Imported raw
  docs: `imported/${sha256(sourcePath)}/${safeFilename}`.
- **How blocks reference images** (`components/editor/Editor.tsx:209`): image node
  `src = "/api/files/{fileId}"` — a **relative app URL**, not a storage path. That route
  (`app/api/files/[id]/route.ts`) looks up the row and 302-redirects to a freshly signed
  URL (bucket is private).
- **In exported markdown**, images are lossy: `![alt](/api/files/{id})` verbatim
  (`serialize.ts:220`). To materialize images in Obsidian your sync must: parse
  `/api/files/{id}` → look up `files` by id → read `storage_path` → download bytes from
  `attachments` → rewrite the link to a local `_attachments/…` path.

---

## 5. Access for a sync script

Because markdown is on the **local filesystem**, the recommended architecture is:

**Markdown → don't build a Storage pull.** Either set `EXPORT_VAULT_DIR` to your Obsidian
vault directly, or read the existing `<vault>/Notion/` tree (+ `.notion-export/
manifest.json` for the page-id ↔ path map). The app already writes wikilinked markdown to
disk. To force a full backfill first: `POST /api/export` with `{ "all": true }`
(`app/api/export/route.ts` → `reconcileAll()` at `lib/export/exportPage.ts:223`).

**Attachments → a small Storage pull is worth it** (the one thing genuinely in Storage):
- Single private bucket: **`attachments`** (confirmed — every `storage.from(...)` call in
  the repo targets only `attachments`). No public bucket. No `.md` in Storage.
- Cleanest method: **service-role client + Storage JS API**, driven off the `files` table:
  1. `select storage_path, filename, page_id, mime_type from files` (SQL or
     `supabase.from('files').select()`).
  2. `supabase.storage.from('attachments').download(storage_path)` per row; write to disk.
  Prefer the `files` table over `storage.list()` — it gives `page_id`/`filename` so you can
  co-locate each attachment with its page's `.md`.
- **Env/auth a script needs** (names only): `NEXT_PUBLIC_SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` (service role required — bucket is private and RLS only
  grants `authenticated`). Anon key would need a logged-in session.
- Supabase **CLI storage commands are a poor fit** (no CLI workflow here; id-keyed paths
  are awkward for `storage cp`). Direct SQL alone can't fetch bytes. So: **table read for
  the manifest + JS `download()` for the bytes.**

**If you'd rather regenerate markdown from the DB** (full control over frontmatter/
filenames/tags): reuse `serializeBlocksToMarkdown(blocks, { resolveWikilink })` from
`lib/export/serialize.ts`, reading `blocks` ordered by `position` per page, and provide
your own page-id → filename map. This also lets you fix the two current gaps (internal
`link`-mark links not wikilinked; images left as `/api/files/{id}`; no `tags` frontmatter).

---

## Gaps / uncertainties (stated, not guessed)
- **No block/content seed data** — the `content` JSON examples in §2 are constructed from
  the code model (`blockSync.ts`, `links/extract.ts`), not copied from real rows.
- **Completeness of the on-disk export is not guaranteed** — export is per-save; pages
  untouched since the feature landed may be missing until a `{all:true}` reconcile runs.
  `reconcileAll()` has no UI trigger.
- **Images and internal link-mark links do not survive usefully** into current markdown
  (markers / dead relative URLs). Wikilinks from `pageMention` atoms *do*.
- **No `tags` frontmatter** despite tags existing in the schema.
- `.env.local` holds real values; not read. Env var **names** verified from `.env.example`
  and client code.
