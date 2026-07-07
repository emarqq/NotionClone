# Feature Plan — Batch (created 2026-07-06)

Living checklist for the upcoming feature batch. Update "Status" and "Notes" as work lands — this file, not the original request, is the source of truth for decisions made during implementation.

**Audit baseline** (confirmed against current code 2026-07-06 — see corrections in `docs/notion-feature-ideas.md`):
- SlashMenu (`components/editor/SlashMenu.tsx`) already offers: Text, Heading 1/2/3, Bullet list, Numbered list, To-do list, Table, Quote, Code block, Callout, Toggle, Divider, plus AI "Continue writing". No Heading 4, no equation/math, no toggle-heading variant, no image item (images insert only via paste).
- `Editor.tsx` registers only StarterKit's default marks — Bold, Italic, Strike, Code. No Underline, Highlight, Link, Color, or TextAlign extensions are installed. `heading.levels` is capped at `[1, 2, 3]`.
- The only `BubbleMenu` in the app is `AIToolsMenu.tsx`, and it's AI-actions only (Summarize/Format/Organize/Continue writing/Rewrite) — **there is no existing formatting bubble menu with Bold/Italic/Strike buttons to extend**. Item 1 below needs to build that menu from scratch.
- The `links` table (`supabase/migrations/20260703000000_initial_schema.sql`) exists in schema but has **zero reads or writes anywhere in the codebase today** — fully unused.
- Page icon is already fully built end-to-end (picker, persistence, rendering everywhere). Cover image, inline hyperlinks, page-to-page mention links, comments, and a theme toggle system do **not** exist yet in any form.

---

## Small editor wins

### 1. Underline, highlight (multicolor) marks + Heading 4; wire into bubble menu
Status: not started
Notes: No formatting bubble menu currently exists (see baseline) — this item includes building that menu, not just extending one. Needs `@tiptap/extension-underline`, a multicolor `@tiptap/extension-highlight` config, and extending `heading.levels` to `[1,2,3,4]` in `Editor.tsx`.

### 2. Ctrl+A / Cmd+A scoped to page content only
Status: not started
Notes:

### 3. Fill remaining slash-menu block-type gaps (H4, equation/math, toggle-heading variants)
Status: not started
Notes: Confirmed gaps: H4 (blocked on item 1's heading-levels change), equation/math block (no KaTeX/math dependency present), toggle-heading (only a plain `Toggle` node exists via the custom extension in `components/editor/extensions/toggle.ts`). Multi-column layouts are explicitly deferred — do not build.

## Linking

### 4. Inline hyperlinks (Cmd/Ctrl+K), external links open in new tab
Status: not started
Notes: No `@tiptap/extension-link` dependency and no Cmd-K keybinding exist today — fully new work.

### 5. Page-to-page links via "@" or "[[" picker
Status: not started
Notes: No page-picker/mention UI exists in the editor. `docs/notion-feature-ideas.md` previously marked "Link-to-page block" as already built — corrected to reflect that only whole sub-pages render as blocks; there's no inline page-link/mention node.

### 6. Backlinks derived into `links` table + Backlinks section
Status: not started
Notes: The `links` table schema exists but is completely unused (no code reads or writes it). This is net-new: derive-on-save logic plus a "Backlinks" UI section reading `where target_page_id = current page`.

## Page customization

### 7. Page icon + cover image
Status: not started
Notes: Page icon is already fully built (`IconPicker`, `PageActionsMenu.tsx`, `lib/icons.tsx`, persisted via `lib/db/pages.ts`) — only cover image is new work. No `cover_image` column exists; will need a migration.

### 8. Inline comments (anchored, threaded, resolvable) + bubble menu Comment button
Status: not started
Notes: No `comments` table and no comment UI anywhere in the codebase — fully new subsystem (schema + UI + bubble menu wiring, which pairs with item 1's new formatting bubble menu).

## Theming

### 9. Theme system: light/dark/system toggle + custom accent colors w/ auto-contrast text
Status: not started
Notes: Current dark mode is purely OS-driven (`prefers-color-scheme` media query in `app/globals.css` + hardcoded Tailwind `dark:` classes) — no toggle, no `next-themes`, no persisted preference, no accent-color CSS variables exist yet. This is a full theme-system build, not an extension of an existing toggle.

## Integrations

### 10. Google Calendar connection (read-only agenda view for v1)
Status: not started
Notes: No existing Calendar integration code found. OAuth tokens/secrets must stay server-side per instruction — likely a new server-side route + token storage table, never exposed to the browser or URLs.

## The big subsystem (gated — do LAST)

### 11. Notion-style databases (typed properties, table view first, then kanban/calendar)
Status: not started
Notes: Do not start until items 1–10 above are shipped. Gate behind its own design doc per instructions before any implementation begins.

### 12. Tables/visuals generated from database data
Status: not started
Notes: Blocked on item 11's query layer — cannot start until then.
