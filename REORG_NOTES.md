# REORG_NOTES.md — code organization audit

> Written 2026-07-26 during the overnight run on branch `claude/overnight-2026-07-26`.
> Audit performed **before** any changes were made. Findings are split into
> **Applied** (low-risk, done this session, build-verified) and
> **Recommended — needs Erik's decision** (structural; deliberately NOT done unattended).

---

## 0. Two STATUS.md claims were wrong — corrected here

| STATUS.md claim | Reality |
|---|---|
| `main` does not typecheck or build (`Backlinks` import) | **Already fixed** by merge commit `6a0d1c5`, which restored `components/backlinks/Backlinks.tsx`. `tsc --noEmit` and `npm run build` both exit 0 on the branch point. No code change was needed. |
| `lib/db/pages.ts:405 getAllPages()` is referenced by zero code | **Refuted.** It is imported at `app/api/pages/route.ts:3` and called at `:15`; that route is fetched by `components/editor/MentionMenu.tsx:60` to power the `@`-mention popup. It is live. Do not delete it. |

The line number also drifted: `getAllPages` is now at `lib/db/pages.ts:415`, not `:405`.

---

## 1. Server/client boundary — CLEAN, no action

The highest-risk category came back with zero violations. All 65 `"use client"` files were
checked for direct *and transitive* imports of `lib/db/*`, `lib/supabase/server`,
`createServiceSupabase`, or `server-only`.

- Every client-side reference to `lib/db/*` is an `import type`, erased at compile time
  (e.g. `components/sidebar/PageTree.tsx:5`, `components/editor/Editor.tsx:20`,
  `components/ai-panel/AiPanel.tsx:19`).
- `lib/db/types.ts` has zero imports of its own, so it cannot smuggle server code in transitively.
- `components/sidebar/Sidebar.tsx` and `components/backlinks/Backlinks.tsx` import `lib/db/*`
  at runtime but are **async Server Components** (no `"use client"`) — correct pattern.

This codebase is disciplined here. Worth keeping that way.

---

## 2. APPLIED this session (low-risk only)

### 2.1 Removed confirmed-dead code (2 symbols)

Each was verified by a repo-wide search across `.ts/.tsx/.md/.sql/.json` including `app/`,
`desktop/`, `scripts/`, `supabase/`, and `docs/` — not just a bare grep of `lib/`.

| Symbol | Location | Evidence |
|---|---|---|
| `listMarkdownFiles()` | `lib/export/vaultFs.ts:63` | Only its own declaration line matches anywhere in the repo. Its doc comment claims it is "for orphan reconciliation", but the shipped orphan logic (`lib/export/exportPage.ts:266-275` `reconcileAll()`) walks `Object.keys(manifest)`, not the filesystem. Superseded, never wired. |
| `PROPERTY_TYPE_LABELS` | `components/database/propertyTypes.ts:32` | Built via `.reduce()` over `PROPERTY_TYPES`, never read — not even inside its own file. |

### 2.2 Extracted byte-identical duplicated helpers

**`lib/export/pmWalk.ts` (new)** — the ProseMirror-node walking primitives were copy-pasted
verbatim across all three exporters. `byPosition`, `asNode`, `childNodes`, `collectText`, and
the `PMMark`/`PMNode` type definitions were **byte-identical** in:

- `lib/export/serialize.ts` (Markdown)
- `lib/export/serializeHtml.ts` (print-to-PDF HTML)
- `lib/export/serializeDocx.ts` (Word)

Verified identical field-by-field before extraction, not assumed from the function names.

**`lib/format.ts` (new)** — `formatShortDate()`. The exact same
`toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })` appeared in
three places: `app/(workspace)/home/page.tsx:16-21`, `components/page-meta/PageMetaBar.tsx:89-94`,
`app/actions/meetings.ts:71-76`.

> **Deliberately excluded:** `components/files/AttachmentsPanel.tsx:84-89` looks like a fourth
> copy but is **not** one — it passes `undefined` as the locale (so it follows the viewer's
> locale, not forced US) and guards `Number.isNaN(date.getTime())`. Folding it in would be a
> user-visible behavior change, not a refactor. Left alone.

---

## 3. RECOMMENDED — needs Erik's decision (NOT done unattended)

### 3.1 Four API routes bypass `lib/db/*` and query Supabase directly — *highest-value structural item*

The `app/actions/* → lib/db/* → Supabase` rule is followed perfectly by all six files in
`app/actions/*` (zero direct `createServiceSupabase`/`.from(...)` calls). But four **API route**
handlers — server code held to the same principle — improvise raw queries instead:

| Location | What it does inline | What's missing |
|---|---|---|
| `app/api/files/route.ts:149-176` (DELETE) | `.from("files").select(...)`, `storage.remove()`, `.from("files").delete()` | `lib/db/files.ts` already exports `getFileById()` doing the same lookup, but has no `deleteFileRecord` — so the route improvised. |
| `app/api/files/route.ts:75-98` (POST) | `storage.upload()` + cleanup `.remove()` | No `lib/db/files.ts` upload helper. |
| `app/api/ingest/route.ts:100-121` | `.from("pages").select("id").eq("is_archived", false)`, `.from("files").select("id").in("extraction_status", …)` | Needs a `listNonArchivedPageIds()` / `listFilesByExtractionStatus()`. `getAllPages()` exists but joins space slugs and isn't a fit as-is. |
| `app/api/ai/chat/route.ts:47-71` (`enrichSources`) | `.from("spaces").select(...)`, `.from("files").select(...)` | Needs a `lib/db` batch lookup. |

**Why I didn't do it:** each requires designing and naming new `lib/db` functions and rewriting
a live route — a behavior-affecting refactor of the file-upload and ingest paths with no test
suite to catch a regression. Worth doing, but with you awake.

### 3.2 `registry.ts:54` silently swallows an unrecognized provider id

```ts
const key = factories[id] ? id : fallback;
```

If `EMBEDDING_PROVIDER` (or `LLM_PROVIDER`, or the `app_settings` override) names a provider that
isn't in the factory map, it **silently substitutes the fallback** — no log, no warning, no throw.
`embeddingFactories` (`registry.ts:16-18`) contains only `{ ollama }`, so STATUS.md's claim here
is **confirmed true**. A typo like `EMBEDDING_PROVIDER=custom-finetun` runs on Ollama forever with
no signal.

Also: `providerSettings()` swallows any Supabase failure with a bare `catch {}` (`registry.ts:41-43`),
again with no logging.

**Decision needed:** should an unknown provider id log a warning, throw at startup, or stay
silent-by-design? This is a product call about failure modes, not a bug fix. My recommendation:
log a warning at minimum — silent misconfiguration of the embedding model is expensive to
discover, because it corrupts the `chunks` table shape only in hindsight.

### 3.3 `app_settings.llm_provider_id` / `embedding_provider_id` are read but never written

Repo-wide, these keys appear **only** in `lib/llm/registry.ts`. There is no settings UI, server
action, or seed row that writes them. The documented `app_settings → env → ollama` resolution
chain therefore has a dead first tier — env vars are the only working override today. This lines
up with STATUS.md's "Settings route — not started". Not a bug; just note the doc overstates what
exists.

### 3.4 `healthCheck()` and `capabilities()` — implemented on both providers, zero call sites

Confirmed by repo-wide grep: `lib/llm/types.ts:40`, `lib/llm/providers/ollama.ts:140`,
`lib/llm/providers/custom-finetune/index.ts:153`, and nothing else. `git log -S healthCheck` shows
it was added in the first commit and never called since.

**I deliberately did NOT delete this**, even though a pure dead-code rule would flag it: it is
declared interface surface, specified in `docs/ARCHITECTURE.md:49`, and both implementations are
real and working (Ollama's even verifies the configured model tag exists). Deleting it would throw
away working capability that a Settings "Test connection" button would want. **Recommendation: wire
it up, don't remove it.**

Related, if you do wire it up:
- `capabilities()` returns a hardcoded `{ contextWindow: 8192 }` on both providers
  (`ollama.ts:136-138`, `custom-finetune/index.ts:149-151`) regardless of the configured model —
  already inaccurate for any non-default model.
- `custom-finetune.healthCheck()` only proves *a* server answers; it never verifies
  `CUSTOM_LLM_MODEL` is actually servable, unlike Ollama's, which checks the model tag list
  (`custom-finetune/index.ts:172-189` vs `ollama.ts:158-171`). A bad model name reports `ok: true`.

### 3.5 Provider divergences worth knowing (no action required)

Both providers genuinely stream (Ollama NDJSON, custom-finetune SSE), both pass `signal` straight
to `fetch`, both throw plain `Error` with no retry, and neither is a stub. The interface is more
uniform than expected. Two shared (not divergent) weaknesses:

- A malformed 200 response silently yields `{ text: "" }` on both (`ollama.ts:133`,
  `custom-finetune/index.ts:146`) — indistinguishable from "the model said nothing".
- With `temperature` unset, each backend falls back to its **own** native default, so switching
  providers silently changes generation randomness. Undocumented.

### 3.6 Remaining duplication — extractable, but each needs a judgment call

| Duplication | Locations | Why not done |
|---|---|---|
| Fractional-index comparator (`byPosition`) | `lib/rag/blockText.ts:13-14`, `lib/db/blocks.ts:25`, `lib/db/pages.ts:120-121,148`, `lib/db/databases.ts:25` (+ the 3 export files, now shared) | Belongs in `lib/positions.ts`, but some sites are a string-only twin (`byPositionKey`) with a different parameter type. Unifying means picking one signature across `lib/db` — mechanical but broad, and touches every ordered read in the app. |
| SSE stream parsing | `components/ai-panel/useAiChat.ts:98-149` (inline) vs `components/editor/AIProposalCard.tsx:27-48` (`readSseEvents()` generator) | Same buffer/`\n\n`-split/`data:`-strip algorithm; one already factored out. Low-risk in principle, but it is the live streaming path for both chat and AI edits — I'd want it exercised manually before landing. |
| `SlashMenu` / `MentionMenu` floating-menu shell | `SlashMenu.tsx:136-160` vs `MentionMenu.tsx:161-185` (keydown block is byte-identical); `MenuState` shape and ref bookkeeping near-identical | The shell is mechanically shareable, but trigger detection and apply/insert genuinely differ. Merging risks subtle keyboard-handling regressions in the editor's two most-used popups. |
| `lib/links/extract.ts:22-39` vs `lib/comments/extract.ts:21-35` | Identical `PMMark`/`PMNode` types + `asNode()`, same recursive collect+dedupe skeleton | Differ only in which mark/node type they scan for. Could share the types (now also in `lib/export/pmWalk.ts` — arguably a repo-wide `lib/pm/` module is the real answer). That is a cross-cutting decision about where PM types live. |

### 3.7 `lib/llm/providers/custom-finetune/` is a folder where every sibling is a flat file

`ollama.ts` is a file; `custom-finetune/` is a directory (`index.ts` + `README.md`), wired in at
`registry.ts:9`. Cosmetically inconsistent. **I left it**: the `README.md` documents the
embeddings-stay-on-Ollama constraint and its adjacency to the provider is arguably the point.
Flattening buys consistency and costs that. Your call.

### 3.8 Database option/config actions are unreachable from any UI — intentional, do not delete

`app/actions/databases.ts` — `updatePropertyConfigAction:65`, `renameOptionAction:85`,
`recolorOptionAction:92`, `reorderOptionAction:99`, `deleteOptionAction:106` have zero importers,
and the `lib/db/databases.ts` functions behind them are reachable only through these. This is a
**named Phase-1 scope cut**, not an accident — `docs/ARCHITECTURE.md:213` says "no option
rename/recolor/delete UI (server functions exist)". Same for `DatabaseRowBundle`
(`lib/db/types.ts:150`, forward-scaffolding for the Phase 2 peek panel) and `PageTag`
(`lib/db/types.ts:71`, the deliberately inert `page_tags` table). **Left in place deliberately.**

---

## 4. Other small things found, not acted on

- `components/editor/OutlinePanel.tsx:47` scans h1–h3 only, so H4 headings — which the slash menu
  can insert — never appear in the outline. (Already in STATUS.md's known issues; still true.)
- `docs/FEATURE-PLAN.md` is stale: items 1, 2, 3, 7, 9 are marked "not started" but have shipped.
- No barrel-file or import-path inconsistencies found; `@/`-alias usage is consistent codebase-wide.
- No fully orphaned files exist in `app/`, `components/`, or `lib/`.
