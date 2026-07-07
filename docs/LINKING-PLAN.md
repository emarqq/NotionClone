# Plan: Linking — hyperlinks, page mentions, backlinks

## Context
`docs/ARCHITECTURE.md` designed a `links` table to be "derived on save from
@mention/wikilink nodes in block content" (`Backlinks for page P = select … where
target_page_id = P`). The table exists (`supabase/migrations/20260703000000_initial_schema.sql`,
lines 62–71) with a matching `Link` type (`lib/db/types.ts:71`) but is **completely
unused** — nothing reads or writes it, and the editor has no link/mention UI. This plan
wires up all three linking capabilities against the existing schema (no migration needed).

Research confirmed (Tiptap 2.27.2, MIT, no Pro): StarterKit 2.27 bundles **neither** Link
nor Mention (no conflict); `@tiptap/extension-link` has **no** default `Mod-k` (we add it);
and the repo's `SlashMenu.tsx` is a **hand-rolled** suggestion popup (no `@tiptap/suggestion`
dependency), so we mirror it for the mention popup and skip that package entirely.

**Decision (confirmed with user):** the `links` table is page→page only. Page-mention nodes
always create backlinks; inline hyperlinks create a backlink **only** when the href points at
an internal page path (`/{slug}/{pageId}`); pure external URLs stay as `<a>` marks, untracked.

## Key facts established during exploration
- **`links` schema:** `unique (source_block_id, target_page_id)`; all three FKs
  (`source_page_id`, `source_block_id`, `target_page_id`) `on delete cascade`. So deleting a
  block/page auto-removes its link rows — we only reconcile links for blocks that still exist.
- **`source_block_id` = the block row `id`.** `blocksFromDoc` (`components/editor/blockSync.ts:69`)
  sets each top-level block row's `id` to its node's `blockId` attr (`block-id.ts` auto-assigns
  UUIDs to top-level nodes). Inline mentions nest inside a block's `content` JSON, so an
  extractor pairs each mention with its **containing block row's `id`**.
- **Save path pattern to mirror:** `saveBlocksAction` (`app/actions/editor.ts`) calls
  `replacePageBlocks` then `scheduleIngest(pageId)`, which uses `after()` from `next/server`
  to re-derive RAG chunks fire-and-forget (`.catch` so it never breaks the save). `ingestPage`
  re-reads blocks server-side and `reconcileChunks` diffs existing-vs-desired rows (delete
  stale, insert new). We add a parallel `scheduleLinkSync` → `reconcilePageLinks`.
- **Pure walker precedent:** `lib/rag/blockText.ts` (`segmentsFromBlocks`) is a pure, sync,
  server-only-free ProseMirror-JSON walker. Our link extractor mirrors it (unit-testable).
- **No client page list exists.** Sidebar renders pages server-side; the client only receives
  `spaces`. `lib/db/*` are all `import "server-only"`. So the mention popup gets pages via a
  new **route handler** (mirrors the existing `/api/spellcheck` client-fetch in `autocorrect.ts`).
- **Routing:** `/{spaceSlug}/{pageId}` (`app/(workspace)/[spaceSlug]/[pageId]/page.tsx`).
- **Custom-extension idiom:** `Node.create` with vanilla DOM / `renderHTML` (see `callout.ts`);
  the repo uses **no** `ReactNodeViewRenderer`. Bubble menu is `AIToolsMenu.tsx` (built-in
  `BubbleMenu` from `@tiptap/react` — do NOT add the v3 `@tiptap/extension-bubble-menu`).

## Dependency
- Add **`@tiptap/extension-link@2.27.2`** only (pin to match core `2.27.x`). Mentions are
  hand-rolled — **no** `@tiptap/extension-mention` / `@tiptap/suggestion`.

---

## Commit 1 — Inline hyperlinks (Link mark)
- `npm i @tiptap/extension-link@2.27.2`.
- **`components/editor/extensions/link.ts`** — extend the MIT mark to add the shortcut:
  `export const Link = TiptapLink.extend({ addKeyboardShortcuts: () => ({ 'Mod-k': () => {
  useLinkEditorStore.getState().open(this.editor); return true } }) })`.
  Configure at registration: `Link.configure({ openOnClick: true, autolink: true,
  linkOnPaste: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer',
  class: 'editor-link' } })` → external URLs open in a new tab; clicking opens the link.
- **`components/editor/linkEditorStore.ts`** — tiny Zustand store (mirror `aiProposalStore.ts`):
  holds `{ editor, from, to, initialHref } | null`; `open(editor)` captures the current
  selection + `editor.getAttributes('link').href`; `close()`.
- **`components/editor/LinkEditor.tsx`** — SlashMenu-style fixed-position popup driven by the
  store: a URL `<input>` positioned at the selection via `editor.view.coordsAtPos` (clamped to
  viewport, same as `SlashMenu`). Enter → normalize URL (prepend `https://` if no protocol and
  not an internal path) → `editor.chain().focus().extendMarkRange('link').setLink({ href }).run()`.
  Empty input → `unsetLink()`. Escape → close. Capture-phase keydown like SlashMenu.
- **`AIToolsMenu.tsx`** — add a **"Link"** button in the main panel (beside `MARK_BUTTONS`,
  lines 49–55) that calls `useLinkEditorStore.getState().open(editor)`; active state via
  `editor.isActive('link')`.
- **`Editor.tsx`** — register `Link` in the `extensions` array (lines 102–129); mount
  `<LinkEditor editor={editor} />` next to `<SlashMenu>` (line ~190).
- **CSS** — add `.editor-link` (and later `.page-mention`) styles to the editor stylesheet
  alongside the existing `.callout`/`.toggle` rules.

## Commit 2 — Page mentions (custom node + suggestion popup)
- **`components/editor/extensions/page-mention.ts`** — `Node.create` mirroring `callout.ts`:
  `name: 'pageMention', group: 'inline', inline: true, atom: true, selectable: true`;
  `addAttributes` = `pageId`, `label`, `spaceSlug` (round-trip via `data-*` like the callout
  `data-emoji`); `parseHTML: [{ tag: 'a[data-type="page-mention"]' }]`; `renderHTML` → an
  `<a data-type="page-mention" data-page-id href="/{spaceSlug}/{pageId}" class="page-mention">label</a>`;
  `renderText` → `[[label]]`. JSON round-trips losslessly (atom + attrs). `spaceSlug` is stored
  so clicks navigate without a lookup (minor known limitation: stale if a page changes space —
  acceptable for single-user; extraction only needs `pageId`).
- **`lib/db/pages.ts`** — add `getAllPages()` → `{ id, title, spaceSlug, icon }[]` (join
  `pages`×`spaces`, `is_archived = false`, order by title).
- **`app/api/pages/route.ts`** — GET handler returning `getAllPages()` (server-only stays on the
  server; client fetches JSON — mirrors the `/api/spellcheck` fetch pattern).
- **`components/editor/MentionMenu.tsx`** — clone `SlashMenu.tsx` (transaction listener,
  `coordsAtPos` positioning, capture-phase Arrow/Enter/Esc nav, viewport clamp). Two triggers:
  `@` → `/(?:^|\s)@([^\s@]{0,50})$/`; `[[` → `/(?:^|\s)\[\[([^\]\n]{0,50})$/` (allows spaces).
  Track which trigger matched to compute the replaced range. Fetch pages once from `/api/pages`
  (cache in a ref), filter by title `includes(query)`, exclude the current `pageId`. On select:
  `editor.chain().focus().deleteRange(range).insertContent([{ type: 'pageMention', attrs:
  { pageId, label, spaceSlug } }, { type: 'text', text: ' ' }]).run()`. Empty results → hide.
- **`Editor.tsx`** — register `PageMention`; mount `<MentionMenu editor={editor} pageId={pageId} />`
  next to `<SlashMenu>`; add `editorProps.handleClickOn` (alongside the existing `handlePaste`):
  when `node.type.name === 'pageMention'`, `preventDefault` and `router.push('/'+attrs.spaceSlug+'/'+attrs.pageId)`
  (same nav as a sidebar `<Link>`; `Editor` is a client component with `useRouter`).
- **CSS** — `.page-mention` (link-colored inline chip).

## Commit 3 — Backlink extraction on save
- **`lib/links/extract.ts`** (pure, no `server-only` — mirror `blockText.ts`):
  `extractLinkTargets(blocks: {id, content}[], selfPageId): { sourceBlockId, targetPageId }[]`.
  Recurse each block's `content`: `pageMention` node → `attrs.pageId`; a text node carrying a
  `link` mark whose `href` matches `^/[^/]+/([0-9a-f-]{36})(?:[/?#]|$)` → the captured pageId
  (internal-URL case the user approved). Dedupe by `(sourceBlockId, targetPageId)`; drop
  self-links (`targetPageId === selfPageId`).
- **`lib/db/links.ts`** (`import "server-only"`):
  - `reconcilePageLinks(pageId)` — mirror `reconcileChunks`: `getBlocks(pageId)` →
    `extractLinkTargets` → **filter desired targets to existing page ids** (guard against a
    mention to a since-deleted page tripping the FK) → read existing `links where
    source_page_id = pageId` → delete stale ids (`.in('id', …)`) → insert new rows
    `{ source_page_id, source_block_id, target_page_id }`.
  - `getBacklinks(pageId)` → distinct source pages via `links`×`pages`×`spaces` where
    `target_page_id = pageId AND source_page_id <> pageId`, non-archived, ordered by title;
    one entry per source page: `{ pageId, title, spaceSlug, icon }[]`.
- **`app/actions/editor.ts`** — add `scheduleLinkSync(pageId)` (copy `scheduleIngest`, using
  `after()` + `.catch`) and call it in `saveBlocksAction` right after `replacePageBlocks`,
  next to `scheduleIngest`. Fire-and-forget; never breaks the save.

## Commit 4 — Backlinks UI
- **`components/backlinks/Backlinks.tsx`** — async server component (template =
  `components/files/AttachmentsPanel.tsx`): `await getBacklinks(pageId)`; empty → render nothing;
  else a "Linked references" section listing each source page as
  `<Link href={'/'+b.spaceSlug+'/'+b.pageId}>` with `PageIcon` + title.
- **`app/(workspace)/[spaceSlug]/[pageId]/page.tsx`** — mount `<Backlinks pageId={page.id} />`
  below the editor (after `<SubPagesList>` / near the `mt-12` `AttachmentsPanel` block, ~line 51).

---

## Files at a glance
| Area | New / Edit | Path |
|---|---|---|
| Link mark | new | `components/editor/extensions/link.ts` |
| Link popup + store | new | `components/editor/LinkEditor.tsx`, `components/editor/linkEditorStore.ts` |
| Bubble-menu button | edit | `components/editor/AIToolsMenu.tsx` |
| Mention node | new | `components/editor/extensions/page-mention.ts` |
| Mention popup | new | `components/editor/MentionMenu.tsx` |
| Page-list endpoint | new | `app/api/pages/route.ts` + `getAllPages` in `lib/db/pages.ts` |
| Extension registration + click nav | edit | `components/editor/Editor.tsx` |
| Link extraction (pure) | new | `lib/links/extract.ts` |
| Link reconcile + backlinks query | new | `lib/db/links.ts` |
| Save-path hook | edit | `app/actions/editor.ts` |
| Backlinks section | new + edit | `components/backlinks/Backlinks.tsx`, `.../[pageId]/page.tsx` |
| Styles | edit | editor stylesheet (`.editor-link`, `.page-mention`) |

No migration — `links` table already exists.

## Verification (report actual observed output)
1. `npm run typecheck` && `npm run lint` — clean.
2. `npm run dev` (:3000). Create page **A** and page **B**.
3. In A, type `@` → popup lists pages → pick **B** → inline mention inserted. Repeat with `[[`.
4. Click the mention → navigates to **B**. Reload B → **Backlinks** section shows **A**
   (link sync runs in `after()`, so verify after navigation/reload).
5. In A, select text → bubble-menu **Link** button (and **Cmd-K**) → enter
   `https://example.com` → click opens in a new tab. Reload A → link persists.
6. Drive the flow with the Playwright MCP / `/verify` on :3000 and report real UI state +
   command output. (Desktop `.app` needs a rebuild per CLAUDE.md, but verification is on :3000.)
