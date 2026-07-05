# Notion Feature Inspiration — Build Menu for the Clone

A planning menu of Notion's real, current (2025–2026) feature set, organized by category. For each feature you get a short name, a 1–2 sentence description of what it does in Notion, and a rough **implementation-complexity** tag from a solo-dev perspective (**Low / Medium / High**).

**Legend**
- ✅ **HAVE** — the clone already has this (based on current state); skip or polish only.
- 🟡 **PARTIAL** — a related capability exists; this is an extension of it.
- ⬜ **NEW** — not in the clone yet.

**Current clone baseline (assumed already built):** workspaces/"spaces", nested page hierarchy, block-based editor, sidebar with Favorites + Recents, page rename / change-icon / archive / delete, drag-and-drop page reordering, AI panel with RAG over the user's own pages, tags, page-to-page links, file attachments.

Complexity is relative to a single developer maintaining an existing block editor + Supabase/Postgres backend. "High" usually means either hard real-time/CRDT work, a whole new data subsystem (databases), or heavy infra (hosting, transcription).

---

## 1. Block Types & Editor

The heart of Notion is a block-based editor where every piece of content (paragraph, heading, image, page) is a draggable, transformable "block."

| Feature | What it does | Status | Complexity |
|---|---|---|---|
| Text / paragraph block | Basic writing block; the default. | ✅ HAVE | Low |
| Headings (H1/H2/H3) | Three heading levels; H2/H3 are collapsible in current Notion. | 🟡 (likely have) | Low |
| Bulleted / numbered / to-do lists | Standard lists; to-do adds a checkbox that can strike through. | 🟡 | Low |
| Toggle list | Collapsible block that hides/shows nested content. | ⬜ | Low–Medium |
| Quote block | Indented, styled quotation. | ⬜ | Low |
| Callout block | Boxed note with an emoji icon and background color, for emphasis/tips. | ⬜ | Low |
| Divider | Horizontal rule to separate sections. | ⬜ | Low |
| Code block | Monospaced block with syntax highlighting and language selector; copy button. | ⬜ | Medium |
| Math / LaTeX (block & inline) | Render TeX equations inline or as blocks (KaTeX-style). | ⬜ | Medium |
| Quote/Highlight & rich text formatting | Bold, italic, underline, strikethrough, inline code, text/highlight colors, links. | 🟡 | Low–Medium |
| Toggle headings | Headings that collapse the section beneath them. | ⬜ | Medium |
| Columns / column layout | Arrange blocks side-by-side in resizable columns; Notion now supports flexible multi-column drag. | ⬜ | Medium–High |
| Table (simple) | Basic non-database grid table for static content. | ⬜ | Medium |
| Image block | Inline image with resize, caption, alignment. | 🟡 (attachments) | Low–Medium |
| Video / audio / file embeds | Upload or embed media that plays inline. | 🟡 | Medium |
| Web bookmark | Paste a URL → rich preview card (title, description, favicon). | ⬜ | Medium (needs link unfurl service) |
| Embed block | Embed 500+ external tools (YouTube, Figma, Maps, Loom, PDFs, tweets) via iframe/oEmbed. | ⬜ | Medium |
| Synced block | A block that mirrors content live across multiple pages; edit once, updates everywhere. | ⬜ | High |
| Table of contents block | Auto-generated, clickable outline from the page's headings. | ⬜ | Low–Medium |
| Breadcrumb block | Shows the page's location in the hierarchy, inline. | 🟡 (breadcrumbs exist) | Low |
| Button block | Configurable button that runs actions (insert blocks, create pages, edit DB rows). | ⬜ | Medium–High |
| Sub-page block | A nested page rendered as a block in the parent. | ✅ HAVE | — |
| Link-to-page block | An inline pointer/alias to another page. | ✅ HAVE | Low |
| Block-level slash conversion | Turn any block into another type (e.g., text → heading → to-do). | 🟡 | Low–Medium |
| Block drag handle + reorder | Grab handle to drag/reorder/indent blocks; multi-select. | 🟡 (page reorder exists) | Medium |
| Duplicate / move-to / color / comment on block | Right-click block menu actions. | ⬜ | Low–Medium |
| Nested / indented blocks | Blocks can contain child blocks to arbitrary depth. | 🟡 | Medium |

---

## 2. Databases (the big differentiator)

Notion databases are collections of pages, each row is a full page, columns are typed "properties," and the same data can be shown through many **views**. This is the single most valuable — and most complex — area to build.

### 2a. Database views

| View | What it does | Status | Complexity |
|---|---|---|---|
| Table view | Spreadsheet-like grid; the default database view. | ⬜ | Medium–High |
| Board / Kanban view | Cards grouped into columns by a select/status property; drag between columns. | ⬜ | Medium |
| List view | Minimal stacked rows, good for docs/notes. | ⬜ | Low–Medium |
| Gallery view | Card grid with cover images; good for visual content. | ⬜ | Medium |
| Calendar view | Rows placed on a month/week calendar by a date property. | ⬜ | Medium–High |
| Timeline / Gantt view | Horizontal bars across time; dependencies and date ranges. | ⬜ | High |
| Chart view | Bar/line/donut/number charts over database data (2024–25 addition). | ⬜ | High |
| Linked database view | Embed a filtered/sorted view of an existing database on any page, without duplicating data. | ⬜ | High |

### 2b. Property (column) types

| Property | What it does | Complexity |
|---|---|---|
| Text / Number / Checkbox / URL / Email / Phone | Basic scalar fields; number supports formatting (currency, %, progress bar/ring). | Low |
| Select / Multi-select | Colored tags from a managed option set (your existing "tags" is close to this). | Low–Medium |
| Status | Special select grouped into To-do / In-progress / Complete stages. | Medium |
| Date | Single date or range, with optional time and reminders. | Medium |
| Person | Assign workspace members to a row. | Medium |
| Files & media | Attach files/images to a row. | Low (you have attachments) |
| Created/Last-edited time & by | Auto-populated audit fields. | Low |
| Formula | Spreadsheet-style expression over other properties (v2 formula language, dates, lists, conditionals). | High |
| Relation | Link rows to rows in another database (one/two-way). | High |
| Rollup | Aggregate a related database's property (sum, count, min/max, show original, etc.). | High |
| Button (property) | Per-row button that runs actions. | Medium–High |
| ID (auto-increment) | Unique sequential row IDs with optional prefix. | Low |
| Location / Place | Address/map property (newer). | Medium |

### 2c. View controls & data ops

| Feature | What it does | Complexity |
|---|---|---|
| Filters | Show rows matching conditions; supports AND/OR filter groups. | Medium |
| Sorts | Multi-level sorting. | Low–Medium |
| Grouping / sub-grouping | Group rows (and board columns) by a property. | Medium |
| Column show/hide, reorder, freeze, width | Per-view column configuration. | Medium |
| Calculations (footer aggregations) | Count, sum, average, %, unique, etc. per column. | Medium |
| Conditional formatting / color by property | Color rows or cells by property values. | Medium |
| Row peek / open-as-page / side-peek | Open a row as a centered modal, side panel, or full page. | Medium |
| Database templates (per-DB) | Predefined row templates with pre-filled properties and page content. | Medium |
| Sub-items & dependencies | Hierarchical rows and task dependencies (project management). | High |

> **Guidance:** Databases are a large, self-contained subsystem. A pragmatic first slice: a single **Table view** with Text/Select/Date/Checkbox properties + filter + sort, reusing your existing tag system for Select. Board/Calendar/Gallery views can share the same underlying schema and be layered on later. Save Relations/Rollups/Formulas for a dedicated phase — they're where most of the complexity lives.

---

## 3. Templates & Reusable Structures

| Feature | What it does | Status | Complexity |
|---|---|---|---|
| Page templates | Duplicate a pre-built page (meeting notes, project brief, etc.) into the workspace. | ⬜ | Low–Medium |
| Template gallery | Curated/community templates you can browse and clone into your space. | ⬜ | Medium |
| Database row templates | One-click new rows with pre-filled properties + body content. | ⬜ | Medium |
| Buttons (template automation) | A button that inserts a block of pre-defined content or creates a page/row. | ⬜ | Medium–High |
| Duplicate page/subtree | Copy a page (and its children) as a starting point. | 🟡 | Low–Medium |
| "Turn into template" | Save any page as a reusable template. | ⬜ | Low–Medium |

---

## 4. Collaboration

| Feature | What it does | Status | Complexity |
|---|---|---|---|
| Real-time multiplayer editing | Multiple users edit the same page live, with presence cursors/avatars. | ⬜ | High (CRDT/OT + realtime infra) |
| Comments (page & inline) | Threaded comments on a page or anchored to specific text/blocks; resolve threads. | ⬜ | Medium |
| Mentions (@person / @page / @date) | Inline references to people, pages, or dates that notify/link. | 🟡 (links exist) | Medium |
| Notifications & inbox | In-app + email/mobile notifications for mentions, comments, assignments; an Inbox feed. | ⬜ | Medium |
| Sharing & permissions | Per-page/per-workspace access levels: Full access, Edit, Comment, View. | ⬜ | Medium–High |
| Guests | Invite external emails to specific pages without full workspace membership. | ⬜ | Medium |
| Teamspaces | Sub-workspaces with their own members, permissions, and default pages. | 🟡 (spaces exist) | Medium |
| Page history / version history | Timeline of past versions with restore (retention varies by plan). | ⬜ | Medium–High |
| Suggested edits / edit mode | Track-changes-style suggestions before accepting (newer). | ⬜ | High |
| Presence & "last edited by" | Show who edited/viewed and when. | ⬜ | Low–Medium |
| Public/link sharing with roles | Share a link with view/comment/edit scope. | ⬜ | Medium |

---

## 5. Organization, Navigation & Search

| Feature | What it does | Status | Complexity |
|---|---|---|---|
| Nested pages & hierarchy | Pages within pages, arbitrary depth. | ✅ HAVE | — |
| Sidebar with Favorites & Recents | Pin pages; recently visited list. | ✅ HAVE | — |
| Breadcrumbs | Show/ navigate the current page's ancestor path. | ✅ HAVE | — |
| Drag-and-drop reordering | Reorder/nest pages in the sidebar. | ✅ HAVE | — |
| Quick Find / command palette | Fast fuzzy search + jump-to across all pages (Cmd/Ctrl-K). | 🟡 (RAG search exists) | Medium |
| Full-text search | Search page titles and body content, ranked. | 🟡 | Medium |
| Backlinks | Automatically list every page that links to the current page. | ⬜ | Medium |
| Wikis / verified pages | Turn a page tree into a wiki with owners, verification badges, and expiry. | ⬜ | Medium |
| Trash / archive with restore | Soft-delete with a recoverable trash bin. | 🟡 (archive/delete exist) | Low–Medium |
| Custom sidebar sections | Group pages into named sidebar sections (Private/Shared/Teamspaces). | 🟡 | Low–Medium |
| Page tabs / split view | Open multiple pages in tabs or side-by-side (desktop). | ⬜ | Medium |
| Table of contents / outline sidebar | Right-rail outline of headings on the current page. | 🟡 (Contents rail exists) | Low |

---

## 6. AI Features (Notion AI)

Notion has moved from inline writing help toward autonomous **Agents** and cross-tool **Enterprise Search** (2025–2026).

| Feature | What it does | Status | Complexity |
|---|---|---|---|
| Ask / Q&A over workspace | Natural-language questions answered from the user's pages, with citations. | ✅ HAVE (RAG) | — |
| Inline writing assistant | Draft, continue, summarize, improve, translate, change tone, fix grammar on selected text. | 🟡 (panel exists) | Medium |
| AI slash actions in editor | `/ai`-style commands to generate content in place. | 🟡 | Medium |
| AI autofill (database) | Auto-populate a property (summary, category, key info) for each row using AI. | ⬜ | Medium–High |
| AI summarize page / blocks | One-click summary of a long page. | 🟡 | Medium |
| AI blocks (auto-updating) | Embedded AI-generated content that refreshes on demand. | ⬜ | Medium |
| Notion Agent | Personal AI that executes multi-step tasks across the workspace autonomously (2026). | ⬜ | High |
| Custom Agents | Team bots triggered by schedule/workspace events (standups, triage, status reports). | ⬜ | High |
| AI Meeting Notes | Real-time transcription + structured summaries of meetings. | ⬜ | High (audio + transcription infra) |
| Enterprise Search / Connectors | AI search across connected apps (Slack, Google Drive, GitHub, etc.). | ⬜ | High |
| Research Mode | Deep multi-source synthesis across the workspace. | 🟡 (RAG foundation) | Medium–High |
| AI formula / property generation | Describe a formula in words → generated formula. | ⬜ | Medium |

> **Guidance:** You already have the hardest AI primitive (RAG). Highest-leverage adds that reuse it: **inline writing assistant** (selection → transform), **AI autofill** once databases exist, and **AI summarize**. Agents/meeting notes/enterprise search are large infra bets — likely out of scope for a clone.

---

## 7. Productivity & Editing UX

| Feature | What it does | Status | Complexity |
|---|---|---|---|
| Slash commands (`/`) | Type `/` to insert any block type or run actions from a searchable menu. | 🟡 | Low–Medium |
| Keyboard shortcuts | Markdown shortcuts (`#`, `-`, `[]`), formatting, navigation, block ops. | 🟡 | Low–Medium |
| Markdown input parsing | Auto-convert `##`, `*`, `>`, ``` ``` ``` etc. into blocks as you type. | 🟡 | Low–Medium |
| Page icons / emojis | Emoji or custom-image icon per page. | ✅ HAVE | — |
| Cover images | Full-width banner image per page (upload, Unsplash, gallery, reposition). | ⬜ | Low–Medium |
| Page-level fonts & full-width toggle | Serif/mono font, small text, full-width layout options. | ⬜ | Low |
| Dates, reminders & recurring | Inline dates with @remind, time zones, and recurring reminders/tasks. | ⬜ | Medium |
| Web Clipper | Browser extension to save any web page into a workspace page/database. | ⬜ | Medium (extension) |
| Quick capture / global new | Fast "new page/task" entry from anywhere. | ⬜ | Low |
| Color & highlight menu | Text/background color on selection. | 🟡 | Low |
| Drag-select multiple blocks | Rubber-band select and act on many blocks at once. | ⬜ | Medium |
| Emoji picker / slash-emoji | `:emoji:` insertion. | ⬜ | Low |
| Duplicate / move / copy-link-to-block | Block anchor links (`#block-id`) and copy-link. | ⬜ | Low–Medium |

---

## 8. Publishing, Sharing & Export

| Feature | What it does | Status | Complexity |
|---|---|---|---|
| Publish to web (Notion Sites) | Turn a page/tree into a public website with a URL, SEO indexing, custom domain, and themes. | ⬜ | High (public rendering + hosting) |
| Public read-only link | Share a single page publicly, view-only. | ⬜ | Medium |
| Export to Markdown | Download page(s) as `.md` (+ assets). | ⬜ | Low–Medium |
| Export to HTML | Download page(s) as static HTML. | ⬜ | Medium |
| Export to PDF | Print/export a page to PDF (workspace-wide PDF on paid plans). | ⬜ | Medium |
| Export database to CSV | Export a database view as CSV. | ⬜ | Low |
| Import (Markdown/CSV/HTML, Evernote, Word, others) | Bring content in from files and other tools. | ⬜ | Medium |
| Duplicate-to-workspace | Let others clone a shared/public page into their own space. | ⬜ | Medium |

---

## 9. Integrations, API & Automations

| Feature | What it does | Status | Complexity |
|---|---|---|---|
| Public REST API | Read/create/update pages, databases, blocks, users, comments programmatically. | ⬜ | Medium–High |
| Webhooks / automation triggers | Fire actions (or external webhooks to Zapier/Make) on database/page events. | ⬜ | Medium–High |
| Database automations | "When property changes → do X" rules inside a database. | ⬜ | High |
| Buttons (action runner) | Buttons that chain actions: create/edit rows, insert blocks, send notifications/email. | ⬜ | Medium–High |
| Embeds / oEmbed | Render external content (Figma, YouTube, Maps, PDFs, tweets) inline. | ⬜ | Medium |
| Link unfurling / bookmarks | Rich previews for pasted URLs. | ⬜ | Medium |
| MCP / connectors | Let external AI tools read/write the workspace; connect Slack/Drive/GitHub. | ⬜ | High |
| OAuth integrations directory | Third-party apps users can authorize. | ⬜ | High |

---

## 10. Platforms, Sync & Offline

| Feature | What it does | Status | Complexity |
|---|---|---|---|
| Desktop app | Native Electron desktop client. | 🟡 (Electron app WIP in repo) | Medium |
| Mobile apps (iOS/Android) | Native mobile clients with quick capture and widgets. | ⬜ | High |
| Offline mode | Read/edit offline; sync on reconnect. | ⬜ | High |
| Cross-device real-time sync | Changes propagate across all sessions instantly. | 🟡 (Supabase) | Medium–High |
| Notion Calendar (companion app) | Standalone calendar app synced with databases + Google/Apple Calendar; scheduling links. | ⬜ | High |
| Notion Mail (companion app) | Email client that turns emails into pages/database rows. | ⬜ | High |
| Notion Forms | Public form → responses land as database rows; conditional logic. | ⬜ | Medium–High |
| Global search across devices | Same search index everywhere. | 🟡 | Medium |

---

## Suggested High-Impact Next Steps

Ranked picks that maximize "feels like Notion" per unit of effort, and that build on what the clone already has.

1. **Slash-command menu + core block types (toggle, callout, quote, divider, code, to-do).** *(Low–Medium)* — This is the most recognizable Notion interaction and touches the editor you already own. Biggest perceived-quality jump for the least new infrastructure.

2. **Rich text + Markdown input shortcuts + inline formatting/color menu.** *(Low–Medium)* — Typing `##`, `- `, `> `, ` ``` ` and getting live conversion, plus a selection toolbar, makes the editor feel "real." Cheap, high daily-use payoff.

3. **A minimal Database v1: single Table view with Select/Date/Checkbox/Text properties, filter + sort.** *(Medium–High)* — Databases are Notion's defining feature and its top reason for lock-in. Reuse your existing tag system for the Select type. Ship Table first; Board/Calendar/Gallery are later views over the same schema.

4. **Board (Kanban) + Gallery + Calendar views on that same database.** *(Medium)* — Once the schema exists, alternate views are largely rendering work and deliver an outsized "wow." Board with drag-between-columns is especially high-impact.

5. **Comments + @mentions + a notifications inbox.** *(Medium)* — Turns a single-player doc tool into a collaboration tool. Inline/threaded comments are self-contained and don't require the hard CRDT work that full multiplayer does.

6. **Inline AI writing assistant (select text → summarize / improve / continue / change tone) and AI autofill for databases.** *(Medium)* — You already have the RAG/AI backbone; this extends it into the editor and (once databases exist) into per-row enrichment — a marquee Notion-AI capability at modest cost.

7. **Cover images + web bookmarks/embeds + link unfurling.** *(Low–Medium)* — Visual polish (covers) plus rich link previews make pages look finished; a small unfurl service unlocks bookmarks and embeds together.

8. **Export to Markdown/PDF and a public read-only share link.** *(Medium)* — Data portability and shareability are frequently-requested, self-contained wins; Markdown export is nearly free given a block model, and read-only public links are a stepping stone toward Notion Sites.

**Deliberately deprioritized for a solo clone:** full real-time multiplayer/CRDT, Notion Sites hosting, AI Meeting Notes/transcription, Enterprise Search connectors, and native mobile apps — each is a large infrastructure investment with low incremental "feels like Notion" return until the core editor + databases are solid.

---

### Sources
- [Using slash commands – Notion](https://www.notion.com/help/guides/using-slash-commands)
- [Block basics – Notion](https://www.notion.com/help/guides/block-basics-build-the-foundation-for-your-teams-pages)
- [Database properties – Notion](https://www.notion.com/help/database-properties)
- [Relations & rollups – Notion](https://www.notion.com/help/relations-and-rollups)
- [Meet your AI team – Notion](https://www.notion.com/product/ai)
- [What's New / Releases – Notion](https://www.notion.com/releases) · [Notion 3.1 (Nov 2025)](https://www.notion.com/releases/2025-11-17)
- [Sharing & permissions – Notion](https://www.notion.com/help/sharing-and-permissions)
- [Export your content – Notion](https://www.notion.com/help/export-your-content)
- [Buttons – Notion](https://www.notion.com/help/buttons) · [Database automations – Notion](https://www.notion.com/help/database-automations)
- [Web Clipper – Notion](https://www.notion.com/help/web-clipper) · [Notion API docs](https://developers.notion.com/)
- [December 2025 updates roundup](https://www.gend.co/blog/discover-latest-features-notion-dec-2025)
</content>
</invoke>
