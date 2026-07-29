# Notion Feature Matrix — north-star spec for a single-user self-hosted clone

**Compiled:** 2026-07-29 · **Scope:** everything Notion ships as of mid-2026, inventoried and triaged.

## Contents

1. [Databases](#1-databases) — property types, views, per-view config
2. [Editor / blocks](#2-editor--blocks) — block list, slash menu, selection model
3. [Calendar & meetings](#3-calendar--meetings) — Notion Calendar, AI Meeting Notes, **local macOS capture + ASR appendix**
4. [Formulas 2.0](#4-formulas-20)
5. [Workspace & navigation](#5-workspace--navigation)
6. [AI features](#6-ai-features)
7. [UX details that make Notion feel like Notion](#7-ux-details-that-make-notion-feel-like-notion)
8. [Verdict — what to build, in order](#8-verdict--what-to-build-in-order)

## How to read this

Every row is `Feature | What Notion does | Priority | Implementation notes & difficulty`.

| Priority | Meaning |
| --- | --- |
| **P0** | Essential. Without it the app is not a Notion replacement. Build first. |
| **P1** | Important. Notion feels broken-ish without it, but you can ship a v1 and add it. |
| **P2** | Nice. Real value, low frequency. Build when the core is solid. |
| **P3** | Skip. Either irrelevant to a single-user self-hosted install, or cost wildly exceeds value. |

**Standing assumption, stated once so it isn't repeated 40 times:** this is **one user, one machine, one workspace**. Therefore *sharing, permissions, guests, teamspaces, member management, groups, SCIM/SAML, audit logs, billing/plans, Notion Sites (public publishing), real-time multiplayer cursors/OT-CRDT sync, comments-as-collaboration, and @person mentions* are **P3 across the board**. They are the single largest chunk of Notion's surface area by engineering cost and contribute approximately zero to a solo user. Cutting them is not a compromise — it is the reason this project is feasible at all. Where a feature has a solo-relevant *residue* (e.g. comments become "private annotations", person property becomes a degenerate one-person tag), that residue is called out and priced separately.

**The honest 80/20, up front.** If you built only the following, you would capture most of Notion's daily value for one person:

1. A fast block editor with markdown-as-you-type, `/` menu, drag handles, and instant local-feel saves.
2. A page tree in a sidebar + `Cmd-P` quick find that opens anything in <100 ms.
3. Databases with ~10 property types, table + board + calendar views, filters, sorts, grouping.
4. `@`-mention linking between pages, plus backlinks.
5. Page history and trash-with-restore (the "I can't lose data" floor).
6. Meeting recording → local transcription → AI summary attached to a page.

Everything else in this document is refinement of those six.

---

## 1. Databases

Databases are Notion's actual product; the editor is the wrapper. This section is longest because it is where a clone most often gives up too early. The critical architectural decision — **a database is a set of pages that share a schema; a *view* is a saved query over that set** — has to be right on day one or you rewrite.

### 1.0 Core model

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Database = collection of pages** | Every row is a full Notion page with its own body content, icon, cover, comments, and sub-pages. Opening a row opens a page. This is the whole trick: databases and documents are the same object. | **P0** | Your `pages` table already is this. Add `database_id` (nullable) to `pages` and a `databases` table holding the schema. Property *values* go in a `page_properties` table (`page_id, property_id, value jsonb`) or a single `properties jsonb` column on `pages`. **Recommendation: one `jsonb` column** — 1 row/page, trivial reads, and Postgres GIN-indexes `jsonb` fine at single-user scale. The normalized table only wins at millions of rows you will never have. Difficulty: medium. |
| **Schema lives on the database, not the row** | Adding a property adds it to every row instantly (value `null`). Renaming a property preserves values. Deleting is soft for 30 days (restorable). | **P0** | Store `properties` as an ordered `jsonb` array of `{id, name, type, config}` on the `databases` row. **Use stable opaque `id`s, never names, as the key into a page's property values** — this is what makes rename-without-data-loss free. Notion's own API does exactly this. Difficulty: low, if you do it from the start; painful retrofit. |
| **Data sources (2025 model change)** | Sept 2025: Notion inserted a layer — a *database* now contains one or more *data sources*, each with its own independent property schema. One full-page database can hold "Tasks" and "Docs" as separate sources. Views bind to **one** data source; you still cannot union two sources into one view. API version `2025-09-03`+ exposes this. | **P3** | This exists to serve template-marketplace packaging and multi-team workspaces. For one user it is pure indirection. Model `database → properties → pages` flat. If you ever want it, it's `data_sources` between `databases` and `pages` — a mechanical migration. Skip. [src](https://developers.notion.com/guides/data-apis/working-with-views) |
| **Inline vs full-page database** | A database can be a **block** embedded mid-page (inline, renders in the flow, has a compact toolbar) or **its own page** (full-page, title = database title, sidebar-visible). Same object; toggle via `⋮⋮ → Turn into inline/page`. | **P0** | One `database` block type whose `content` is `{database_id, view_id, mode: inline|page}`. Full-page = a `page` whose body is a single database block rendered chrome-less. Getting the *toggle* right is a nice-to-have; having both modes is essential. Difficulty: low-medium. |
| **Linked view of a database** | `/linked view of database` embeds a *view* of an existing database anywhere else. Filters/sorts/groups are per-linked-view and do not affect the source. Deleting the linked view leaves the source untouched. This is how Notion does dashboards. | **P1** | Falls out for free if views are rows in a `database_views` table referencing `database_id`, and a block just references a `view_id`. **Design so a view is never "owned" by the page it appears on.** Difficulty: low once the view model is right. |
| **500-property limit / row limits** | Hard cap 500 properties per database. Practical soft limits on rows before views get slow (Notion degrades noticeably past ~5–20k rows in a table view). | **P3 (cap)** / **P1 (perf)** | Don't implement a cap. *Do* paginate/virtualize view rendering from the start — 5k-row tables must scroll at 60 fps. `react-virtual` or TanStack Virtual. [src](https://www.notion.com/help/database-properties) |

### 1.1 Property types

Notion ships 21 property types (per the official help table, mid-2026). Ranked by how much a solo user actually touches them.

| Property | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Title** | Mandatory, exactly one per database, cannot be deleted or retyped. Holds rich text. Is the page title; clicking it opens the page. Renderable as the card/list label. | **P0** | Don't store it as a property at all — it's `pages.title`. Expose it in the schema as a synthetic always-first property. Difficulty: trivial. |
| **Text** | Rich text (bold/italic/links/inline code/mentions/equations) in a cell. Supports "wrap" per view. | **P0** | Reuse the ProseMirror inline fragment you already store in `blocks.content`. A cell editor is a single-line Tiptap instance with block nodes disabled. Difficulty: medium (the *rich* part). A plain-string fallback ships in an hour and is 80% as useful. |
| **Number** | Numeric value + **format**: Number, Number with commas, Percent, and ~30 currencies (USD/EUR/GBP/JPY/…), plus **Bar** and **Ring** progress displays with a configurable divide-by (a number or another number property) and show-number toggle. | **P0** | Store `numeric`. Format is display-only config on the property. Progress bar/ring is ~40 lines of SVG and is disproportionately satisfying — build it. Difficulty: low. |
| **Select** | One option from a managed option list. Options have name + one of ~10 Notion colors, are reorderable by drag, renamable in place (updates all rows), and deletable. Typing a new value in a cell creates the option. Colors auto-assigned. | **P0** | `config: {options: [{id, name, color}]}`, cell value = option `id`. **Key UX:** the cell dropdown must be type-to-filter + Enter-to-create-new. Difficulty: low. |
| **Multi-select** | Same, but an ordered list of option ids. | **P0** | Same store, value = `id[]`. Difficulty: low. |
| **Status** | Like select, but options are bucketed into three fixed **groups**: To-do / In progress / Complete. Groups drive board columns, "is not empty"-style filters, rollup `percent per group`, and the checkbox-ish semantics elsewhere. Each group can hold many options; you can rename/recolor options but not add a fourth group. | **P0** | `config: {groups: [{id, name: 'todo'|'in_progress'|'complete', option_ids: []}], options: [...]}`. Cheap to add, and it's what makes a board view *mean* something. Difficulty: low. |
| **Date** | A date, optionally a **time**; optionally an **end date** (range); a **reminder** (on the date, or N minutes/hours/days before, at a time); per-property date format (relative / MM-DD-YYYY / DD-MM-YYYY / YYYY-MM-DD / full) and 12/24h; per-value timezone. Drives calendar and timeline views. | **P0** | Store `{start: timestamptz, end: timestamptz|null, has_time: bool, time_zone: text|null}` as jsonb. **Do not store naive dates** — the has_time flag matters for all-day rendering. Reminders need a scheduler (see §5). Difficulty: medium (the date picker is a real component; use `react-day-picker` and skin it). |
| **Checkbox** | Boolean. Renders as a checkbox in table, a badge elsewhere. Groupable (Checked/Unchecked). | **P0** | Trivial. |
| **Files & media** | Multiple file uploads or external URLs per cell. Images preview; others show a filename chip. Reorderable by drag. Can be the card-preview source for gallery view. Notion's per-file cap is 5 MB on Free, unlimited on paid. | **P1** | Supabase Storage bucket + a `files` table. Value = `[{id, name, url|storage_path, mime, size}]`. Local-disk storage is also fine and simpler for self-hosting. Difficulty: medium (upload UX, thumbnails). |
| **URL** | String validated loosely as a URL; click opens in new tab; per-view option to show as full URL vs favicon+title. | **P0** | Trivial. Add favicon fetching later. |
| **Email** | String; click opens `mailto:`. | **P2** | Trivial; low value solo. Text property covers it. |
| **Phone** | String; click opens `tel:`. | **P2** | Trivial; low value solo. |
| **Formula** | Notion Formulas 2.0 expression evaluated per row, returning any type incl. lists and rich text. See §4. | **P1** | The single most expensive optional feature in this document. See §4 for the honest cost. A **subset** (arithmetic, dates, if/and/or, string concat, prop refs) is ~2 days and covers 90% of real use. |
| **Relation** | Links rows to rows in another (or the same) database. Cell holds an ordered list of page references, added via a searchable picker. **One-way**: only the source database shows the property. **Two-way (synced)**: creating it adds a mirrored property on the target database, and edits propagate both directions instantly. You choose at creation and can convert later. Self-relations are allowed (this is how sub-items work). Limit-to-one-item toggle exists. | **P0** | A `page_relations (from_page, property_id, to_page, position)` table — do **not** bury relations in the jsonb, you need to query them backwards. Two-way = a second `property_id` on the target whose reads are just the reverse query. **Getting two-way right is the hard bit**: mutate one edge, invalidate both sides' caches. Difficulty: medium-high. Worth it — relations are what elevate a database above a spreadsheet. |
| **Rollup** | Given a relation property, pull a property from the related rows and aggregate. Aggregations: **Show original**, **Show unique values**, **Count all**, **Count values**, **Count unique values**, **Count empty**, **Count not empty**, **Percent empty**, **Percent not empty**, and for numbers **Sum / Average / Median / Min / Max / Range**, for dates **Earliest date / Latest date / Date range**, for checkboxes **Checked / Unchecked / Percent checked / Percent unchecked**, and **Percent per group** for status. "Show original" returns a *list*, which formulas can then operate on. | **P1** | Compute on read: `SELECT agg(...) FROM related pages`. Do **not** materialize; at single-user scale a lateral join is instant, and materialization creates a cache-invalidation nightmare. Difficulty: medium. Nested rollups (rollup of a rollup) — Notion allows one level; punt. |
| **Person** | Tags workspace members/groups. Filterable by "me". | **P3** | One user. Keep exactly one degenerate case: a `Created by`-style "me" so imported Notion exports don't lose data. If you ever want multi-person semantics for e.g. *meeting attendees*, model that as a **Contacts database + relation** — strictly better than Notion's people property, which can't hold non-members. |
| **Created time / Last edited time** | Auto timestamps, uneditable, filterable, sortable. | **P0** | You already have `created_at`/`updated_at`. Expose them as synthetic read-only properties any view can show, sort, filter, and group by. **Very cheap, disproportionately useful** — "edited this week" views are a killer solo feature. Difficulty: trivial. |
| **Created by / Last edited by** | Auto person stamps. | **P3** | Single user. Expose as constants if an import needs them. |
| **ID** | Auto-incrementing integer per database, optional text prefix (e.g. `TASK-42`), immutable, gaps allowed on delete. Used for ticket-style references. | **P2** | `bigint` sequence per database + prefix in config. Genuinely nice for a task DB, ~1 hour of work. |
| **Button** | A per-row button that runs a chain of actions on click: edit properties of this page / add a page to a database / open a page / show a confirmation / duplicate from template / (2025+) run an AI prompt or trigger an automation. Configured with a visual action builder. | **P2** | This is a *mini automation engine* (§5). If you build automations at all, the button property is the cheapest surface on top of it. Standalone value: a "Log today" or "Mark done + stamp date" button is genuinely great. Difficulty: medium (the action builder UI is most of it). [src](https://www.notion.com/help/guides/make-work-more-efficient-database-button-property) |
| **Place** | Location value from a search/geocode ("location services, a location name, or an address"). Powers **Map view**. Added 2025. | **P3** | Requires a geocoder (Nominatim self-hosted, or Mapbox key) + tiles. Cool, near-zero solo value unless the user keeps a travel/restaurant DB. Store as `{lat, lng, label}` text if you want the data captured cheaply. [src](https://www.notion.com/help/maps) |

**Conditional color** (2025): per-view rules that color a page's *background* based on Select/Multi-select/Status/Title/Text/Number/Date/Person/Checkbox/Formula/Relation/Rollup values. Available on Table/Calendar/Timeline/List/Board/Feed. In table view only, you can color just the matching cell instead of the row. — **P2**, low difficulty (it's a per-row CSS class from a rule evaluator you already need for filters), and it makes dense views readable. [src](https://www.notion.com/help/database-properties#conditional-color)

### 1.2 Views

| View | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Table** | Spreadsheet grid. Resizable + reorderable columns, frozen title column, per-column summary row, row-height setting, wrap-cells toggle, inline editing, `+ New` at the bottom, drag-to-reorder rows (only when unsorted). | **P0** | The workhorse. Build with a virtualized grid, not a `<table>` — column resize + 5k rows demands it. Inline cell editors are one component per property type. **Difficulty: high (2–4 days) but unavoidable.** |
| **Board (Kanban)** | Groups by a Select/Status/Person/Checkbox/Relation/formula property into columns; drag cards between columns *writes the property*; drag within a column reorders; per-column count; hide empty groups; "sub-group" into swimlanes (rows) by a second property; card size S/M/L; card preview source (page cover / page content / a files property / none); visible properties on card; per-column `+ New` prefills the group value. | **P0** | The second most-used view and much easier than table. Fractional indexing (which you already have in `lib/positions.ts`) makes drag-reorder trivial. **Column drag = a property write + a position write in one transaction.** Difficulty: medium. |
| **Calendar** | Month/week grids driven by a Date property; drag events to change dates; drag edges to change range; multi-day bars; `+` per day; show weekends toggle; "Show calendar as: Month / Week". | **P0** | Given the meeting/calendar focus of this project, this is P0. Build it once as a generic component and reuse it for the Calendar app in §3. Difficulty: medium-high (drag/resize math). |
| **List** | Minimal stacked rows: title + a few properties right-aligned, no grid lines. | **P0** | ~2 hours once the view engine exists. Highest value-per-line-of-code in the whole document. |
| **Gallery** | Card grid. Card preview from page cover / page content / a files property; card size S/M/L; fit-image toggle; visible properties under the image. | **P1** | ~half a day after board view (shares the card component). |
| **Timeline / Gantt** | Horizontal time axis from a Date range (or two date properties as start/end). Zoom: hours/days/weeks/months/quarters/years. Drag bars to move, drag edges to resize. Optional **table side-panel** split. Supports **grouping** into swimlanes, **sub-items** nesting, and **dependencies** (see below). | **P2** | Expensive (virtualized 2-D canvas, zoom levels, drag math) and, honestly, a solo user with <50 projects gets most of the value from a calendar. Build after everything else. Difficulty: high (3–5 days). |
| **Chart** | Bar / line / donut charts over a data source, with X axis = a property or date bucket, Y = count or an aggregation of a number property, optional series grouping, stacking, and a color scheme. Embeddable on any page as a linked chart view. Notion added these in 2024–25. | **P2** | Recharts/Visx over the same query pipeline as any view; ~1 day. Worth it if you want a dashboard page. |
| **Feed** | Scrollable social-style stacked cards showing page *content* previews plus optional properties. For "team updates". | **P3** | Solo: this is List view with a taller row. Skip; add a "show content preview" toggle to List instead. |
| **Map** | Plots the Place property on a map. | **P3** | See Place property. Skip. |
| **Form** | A database view that renders as a public/internal submission form; fields map to properties, with per-field required/description/prefill, custom title/logo/cover, confirmation message + redirect, response limits, and per-view submission tracking. Free plan capped at 1 form. | **P3 for a solo user — with one exception** | Public submission is meaningless alone. But a **local "quick capture" form** (a stripped modal that creates a row with 3 fields and closes) is a genuinely great P2 feature — build *that*, not Notion's form builder. |
| **Multiple views per database, tabbed** | Views appear as tabs above the database; unlimited; renamable with icons; duplicable; reorderable by drag; each independently configured. | **P0** | `database_views` table with `position` (fractional). Difficulty: low. This is the payoff for all the view-config work. |
| **Default view / view links** | Each view has a URL (`?v=…`) so you can link to a specific view. | **P1** | Route `/db/:id?v=:viewId`. Trivial and needed for tabs/history to work. |

### 1.3 Per-view configuration

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Filters** | Per-view rule set. Simple mode = flat AND list; advanced mode = arbitrarily nested **groups** with AND/OR per group (Notion allows 3 levels of nesting). Operators are per-type: **text** — is, is not, contains, does not contain, starts with, ends with, is empty, is not empty; **number** — =, ≠, >, <, ≥, ≤, is empty, is not empty; **select/status** — is, is not, is empty, is not empty (status also: is any of / none of via multi-pick); **multi-select** — contains, does not contain, is empty, is not empty; **date** — is, is before, is after, is on or before, is on or after, is between, is empty, is not empty, with *relative* values: today, tomorrow, yesterday, one week ago/from now, one month ago/from now, and "past/next N days/weeks/months"; **checkbox** — is checked / is unchecked; **person** — contains, does not contain, is empty/not empty, and **Me**; **files** — is empty / not empty; **relation** — contains, does not contain, is empty, is not empty; **rollup/formula** — operators of the *resulting* type. Filters can be marked *"Save for everyone"* vs temporary. | **P0** | Model as a recursive `{op: 'and'|'or', children: [Rule|Group]}` jsonb tree. **Compile to SQL, do not filter in JS** — it must stay fast and it's how sorting/pagination stay correct. Relative dates compile to `now()`-relative expressions. Difficulty: high (2–3 days) but this is the load-bearing feature of the whole database system. Ship the flat-AND version day one, nested groups later. |
| **Sorts** | Ordered list of (property, asc/desc). Multi-level. Sorting disables manual drag-reorder. Notion also has a hidden default sort by manual `position`. | **P0** | Compiles to `ORDER BY`. Careful with jsonb: cast per type (`(props->>'x')::numeric`). Difficulty: low-medium. |
| **Grouping** | Group rows by a property (select/status/checkbox/date-bucket/person/relation/formula). Per group: collapse, hide-if-empty, reorder groups manually, "show all options" vs "only options in use", and a per-group count + summary. Date grouping buckets by day/week/month/quarter/year, or relative. | **P0** | Board view *is* grouping; table/list grouping is the same engine with different chrome. Difficulty: medium. |
| **Sub-grouping** | A second grouping axis — board swimlanes, or nested groups in table. | **P2** | Nice on boards (e.g. group by Status, swimlane by Project). Difficulty: medium. Skip until board is solid. |
| **Property visibility + order** | Per view: show/hide each property, drag to reorder. Table has a "hidden properties" tray; board/gallery/list have "shown on card". | **P0** | `view.visible_properties: [{property_id, visible, width?}]`. Trivial and required — without it every view shows 20 columns and is useless. |
| **Column width** | Per-view pixel widths, drag to resize, persisted. | **P1** | Store in the same array. Easy, and its absence is instantly noticeable. |
| **Row height** | Short / Medium / Tall (affects how much wrapped text shows). | **P2** | CSS var. 20 minutes. |
| **Wrap cells** | Per-view (and per-column) toggle: truncate with ellipsis vs wrap to multiple lines. | **P2** | 20 minutes. |
| **Summary row / calculations** | Per-column footer aggregation in table view (and per-group, and per-board-column). Options: Count all, Count values, Count unique, Count empty, Count not empty, Percent empty, Percent not empty; numbers add Sum, Average, Median, Min, Max, Range; dates add Earliest, Latest, Date range; checkbox adds Checked, Unchecked, Percent checked/unchecked. | **P1** | Same aggregation library as rollups — build once, use in both. Difficulty: low once rollups exist. |
| **Sub-items** | Enable on a database → creates a self-relation (`Parent item` / `Sub-item`), and table/timeline/list render an expandable tree with indent guides. Up to 5 levels deep. Filters can "include sub-items". Board shows a sub-item count badge. | **P1** | Falls out of self-relations + a recursive CTE. **Very high value for a solo task database** — nested tasks are the #1 thing people leave Notion competitors over. Difficulty: medium. |
| **Dependencies** | On timeline view: mark relations as blocking/blocked-by; drawing an arrow between bars creates the link; moving a predecessor can auto-shift dependents ("shift dates" toggle) and there's an option to avoid weekends. | **P3** | Requires timeline first, then a scheduling engine. Solo project management rarely needs it. Skip. |
| **Open pages in: Side peek / Center peek / Full page** | Per-view default for what happens when you click a row. Side peek = right drawer, page stays visible; center peek = modal; full page = navigate. Peeks have an "open as full page" button and are `Esc`-dismissable. | **P0** | Side peek is a Notion signature and cheap: a right-anchored panel rendering the same `<Page>` component, plus a URL param (`?p=pageId`) so it's linkable and back-button-able. **Difficulty: low-medium; user-perceived value: very high.** |
| **Locked views / locked databases** | Lock a view so its config can't be changed accidentally; lock a database so the schema can't. Toggled from `•••`. | **P2** | A boolean + a confirm dialog. 30 minutes, prevents self-inflicted damage. |
| **Database templates** | Per-database page templates: a template defines the body content and default property values for new rows. Multiple templates per database, selectable from a dropdown on the `New ▾` button. One can be marked **default** (used when you hit plain `New` or `+`), and a default can be set *per view* and *per group* (e.g. "new card in Done column uses the Done template). Templates support **dynamic dates** (`@Today` resolves at creation time) and, in repeating templates, auto-creation on a schedule. | **P1** | A template is just a page with `is_template=true` and a `database_id`; "new from template" = deep-copy blocks + merge properties. **The `New ▾` split-button is the whole UX.** Difficulty: medium. Repeating/scheduled templates: P3 (needs a scheduler; a recurring-task DB is the real solution). |
| **Duplicate view / duplicate database** | `•••` → Duplicate. Database duplication offers "with content" or schema-only. | **P1** | Deep copy. Straightforward but fiddly with relations (Notion rewrites internal relations to the copies; do the same or accept dangling). Difficulty: medium. |
| **Copy link to view / to row** | Every row and view has a stable URL; rows get `?pvs=` peek params. | **P1** | Trivial with stable UUIDs; needed for `@`-mentions and backlinks anyway. |
| **Export view** | CSV / Markdown / PDF export of the current view honoring filters+sorts. | **P2** | CSV export of a filtered view is ~1 hour and is the escape hatch that makes self-hosting feel safe. Build it early for peace of mind. |
| **`Ctrl/Cmd+Shift+L` etc. in-database shortcuts** | Arrow-key cell navigation, `Enter` to edit, `Esc` to exit, `Cmd+Enter` to open the row, `Space` to peek, `Tab`/`Shift+Tab` between cells, `Cmd+C/V` on cell ranges, shift-click range selection, and **paste TSV from a spreadsheet to fill a range**. | **P1** | The spreadsheet muscle-memory layer. Notion's is incomplete and people complain; beating it is achievable. Paste-TSV-into-range is ~half a day and feels magical. Difficulty: medium overall, but incremental. |

**Sources for §1:** [Database properties](https://www.notion.com/help/database-properties) · [Views, filters & sorts](https://www.notion.com/help/views-filters-and-sorts) · [Board view](https://www.notion.com/help/boards) · [Relations & rollups](https://www.notion.com/help/relations-and-rollups) · [Database buttons](https://www.notion.com/help/database-buttons) · [Working with views (API)](https://developers.notion.com/guides/data-apis/working-with-views) · [Data sources 2025 explainer](https://www.notionapps.com/blog/notion-data-sources-update-2025) · [Property object reference](https://developers.notion.com/reference/property-object)

---

## 2. Editor / blocks

Notion's editor is a **flat list of top-level blocks, each of which may have children**. Rich text lives *inside* a block as an array of styled runs. Your existing schema (one `blocks` row per top-level node, ProseMirror JSON fragment in `content`) is the correct shape and matches Notion's own API model. Below, "difficulty" assumes Tiptap 2.27 as the substrate.

### 2.1 Block types

The official Block API lists ~30 types. Grouped by what they cost you.

| Block | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Text (paragraph)** | The default. Rich text: bold, italic, underline, strikethrough, inline code, link, 10 text colors + 10 background colors, inline equation, inline mention. | **P0** | Tiptap default. Underline and the color set need explicit marks/extensions. Difficulty: trivial. |
| **Heading 1 / 2 / 3** | Three levels only (no H4+). Each is independently **collapsible** into a toggle heading (a per-heading toggle that folds all following content until the next same-or-higher heading). Headings feed the Table of Contents block and the outline. | **P0** (headings) / **P1** (toggle headings) | Tiptap `Heading` with `levels: [1,2,3]`. Toggle-headings are a custom node attr + a client-side "fold the following siblings" behaviour — surprisingly fiddly because the folded content isn't a child in the document tree. Notion cheats by making it a rendering concern. Difficulty: heading trivial, toggle-heading medium. |
| **To-do (checkbox list)** | `[]` + space. Checking strikes through and dims the text. Nestable. `Cmd/Ctrl+Enter` toggles the checkbox of the block your cursor is in. Progress is *not* aggregated (a known Notion gap). | **P0** | Tiptap `TaskList`/`TaskItem`. Trivial. Consider adding what Notion lacks: a per-page todo count. |
| **Bulleted list** | `-`/`*`/`+` + space. Nests indefinitely; bullet glyph cycles •, ◦, ▪ by depth. | **P0** | Tiptap default. Trivial. |
| **Numbered list** | `1.` + space. Nesting restarts numbering and cycles 1., a., i. by depth. Numbering auto-recomputes on reorder. | **P0** | Tiptap default handles this; the a./i. depth cycling is CSS `list-style-type` per depth. Trivial. |
| **Toggle list** | `>` + space. Collapsible container with real children. Collapsed state is per-user session (not persisted in the doc), except toggle-headings which persist a default. | **P0** | Custom Tiptap node with a `details`-like NodeView. Difficulty: low-medium. High usage — build it. |
| **Quote** | `\|` + space or `"` + space. Left-bar styled. Can hold children. Has a large/small size option. | **P0** | Tiptap `Blockquote`. Trivial. |
| **Divider** | `---`. Horizontal rule. | **P0** | Tiptap `HorizontalRule`. Trivial. |
| **Callout** | Boxed block with an **icon** (emoji, uploaded image, or Notion icon) and a background color; holds arbitrary children. `/callout`. | **P0** | Custom node with `icon` + `color` attrs and content. Difficulty: low. Enormous perceived-polish return. |
| **Code** | Monospaced block with a **language dropdown** (~70 languages incl. Mermaid, ABAP…), syntax highlighting, a **caption**, word-wrap toggle, copy button, and (2024+) a Mermaid **diagram preview** toggle for `mermaid` blocks. | **P0** | Tiptap `CodeBlockLowlight` + a language select. Caption = an attr rendered below. Mermaid preview: P2, one `mermaid.render()` call. Difficulty: low-medium. |
| **Equation (block)** | KaTeX-rendered display math, `/math` or `$$`. Click to edit in a popover with live preview. | **P1** | `katex` + a custom node. ~2 hours. |
| **Inline equation** | `Cmd+Shift+E` or typing `$$…$$` inline. Renders inline KaTeX. | **P1** | A Tiptap inline node. ~2 hours. |
| **Image** | Upload / link / Unsplash search. Resizable by dragging side handles, alignment (left/center/right), **caption**, full-width option, click-to-lightbox with zoom, "original size" reset, replace, and comment-on-image. Alt text. | **P0** | Storage + a resizable NodeView. Unsplash: P3. Lightbox: P2 but cheap. Difficulty: medium (resize handles + persistence of width). |
| **Video** | Upload or embed (YouTube/Vimeo/Loom auto-embed by paste). Caption, resize. | **P1** | `<video>` for local files, iframe for known providers. Difficulty: low. |
| **Audio** | Upload; inline player with scrubber. Caption. | **P1** | `<audio>`. Trivial — and it's the substrate for meeting recordings (§3). |
| **File** | Any upload; renders as a filename chip with size and a download button. Caption. | **P0** | Trivial once storage exists. |
| **PDF** | Upload or link; renders an inline scrollable PDF viewer, resizable, with page controls. | **P2** | `pdf.js` or `<embed>`. `<embed>` is 10 minutes and good enough on macOS. |
| **Bookmark** | Paste a URL → "Create bookmark" → a card with favicon, OG title, description, and preview image. | **P1** | Server action that fetches the URL and parses OG tags (`open-graph-scraper`), cached in a `link_previews` table. Difficulty: low. Very satisfying. |
| **Embed** | Generic iframe embed; Notion special-cases ~30 providers (Figma, Miro, Google Drive/Docs/Maps, Tweet/X, GitHub Gist, CodePen, Typeform, Loom, Spotify, Framer, Replit, PDF URLs…) with sized, interactive frames. | **P2** | A generic `<iframe>` block + a provider table for aspect ratios. Difficulty: low. Note: many providers now block framing; expect breakage. |
| **Simple table** | A non-database table block: rows/cols, header row and/or header column toggles, cell background colors, resizable columns, row/column insert/delete/move, and "convert to database". Cells hold rich text but **not** other blocks. | **P1** | Tiptap `Table` extension does ~90% of this out of the box. **Do not confuse with database table view** — users need both, and this one is for quick ad-hoc grids. Difficulty: low (extension) / medium (polish). |
| **Columns** | Split the page into 2–5 columns by dragging a block to the side of another, or `/2 columns`. Column widths are draggable. Columns can nest. Each column holds arbitrary blocks. Mobile collapses to stacked. | **P1** | The single hardest layout feature in Notion. In ProseMirror: a `columnList` node containing `column` nodes, each holding block content, plus drop-zone logic on the sides of every block. Difficulty: **high (2–3 days)**. Very visible. Consider `/2 columns` (explicit insert) first and drag-to-create later. |
| **Synced block** | A block whose content is stored once and mirrored in N places; editing any instance edits all; each instance shows a red border and "Copy/Edit original"; you can unsync a copy. | **P2** | Store the content on the *original* block; copies are `{type:'synced', source_block_id}` and render the source's children. Editing a copy writes to the source. Difficulty: medium. Solo value: real (a "current focus" block on several dashboards) but not daily. |
| **Table of contents** | Auto-generated, indented, clickable list of the page's H1–H3. Live-updates. Color option. | **P1** | Derive from the block list at render time; no storage. ~1 hour. |
| **Breadcrumb** | Block that renders the page's ancestor chain. | **P2** | You already render breadcrumbs in chrome; this is the in-body version. ~30 min. |
| **Link to page** | A block that is a pointer to another page, rendered with its icon and title, live-updating on rename. Distinct from a sub-page. | **P0** | `{type:'page_link', page_id}`. Trivial and load-bearing for navigation. |
| **Sub-page (child page)** | `/page` or `Cmd+Shift+P`-style creation of a nested page inline; appears as an icon+title row in the body **and** as a child in the sidebar tree. Deleting the row trashes the page. | **P0** | The page tree and the body must agree — a child page is a row in `pages` with `parent_page_id` *and* a block in the parent's body holding its id. Keep them in sync in one transaction. Difficulty: medium (the sync). |
| **Mention — @page** | `@` + page name → inline chip with icon + live title; click navigates; hover shows a preview card with the page's first lines. Creates a **backlink** on the target. | **P0** | Inline node `{page_id}`. **Backlinks (the target page showing "N backlinks") are the highest-value 4 hours in this entire document.** You already have a `links` table. Difficulty: low-medium. |
| **Mention — @date** | `@today`, `@tomorrow`, `@Jan 5`, `@in 3 days` → an inline date chip; optionally with a **reminder**; renders relative ("Today at 3pm") and is clickable to edit. | **P1** | Inline node + `chrono-node` for natural-language parsing. Reminders need the notification layer (§5). Difficulty: low-medium. |
| **Mention — @person** | Inline person chip; notifies them. | **P3** | Single user. |
| **Mention — @reminder** | `@remind` sets a notification at a date/time, shown inline with a bell; fires a Notion notification. | **P2** | Requires a scheduler + OS notification bridge (Electron `Notification`). Difficulty: medium. Genuinely useful solo. |
| **Mention — @ external/AI** | 2025+: `@` can also pull in Slack/Drive/GitHub items and invoke an agent. | **P3** | Not applicable. |
| **Button (block)** | In-page button running the same action chain as the button *property* (add page to database, edit properties, open page, show confirm, run AI). Formerly "template button" (duplicate a block group under itself). | **P2** | Keep the **original template-button** semantics (duplicate these blocks below) — that's a 2-hour feature with real daily value (e.g. a daily-log entry stamp). The full action builder is §5. |
| **AI block** | `/ai` blocks: Summary, Action items, Custom AI block, Translate — they run on page content and *store their output as regular blocks*, with a refresh option. | **P1** | You already have the LLM plumbing. Wire `/summarize`, `/action-items`, `/translate` as slash commands whose output goes through the propose-then-accept diff overlay (per this repo's propose-only rule). Difficulty: low, given existing infra. |
| **Meeting notes / transcription block** | A composite block holding meeting title, lifecycle status, calendar event details, recording window, and pointers to child transcript blocks. Renamed from `transcription` to `meeting_notes` in API version `2026-03-11`. | **P0** *(for this project)* | See §3. Model as a block whose `content` holds `{recording_id, started_at, ended_at, status}` with child blocks = transcript segments. [src](https://developers.notion.com/reference/block) |
| **Template button / repeating templates** | See database templates. | **P2** | — |
| **Table of database ("linked view")** | Covered in §1. | **P1** | — |
| **Unsupported / legacy** | `unsupported` block type appears in the API for blocks the API can't express. | **—** | Ignore. |

### 2.2 Editing affordances — the part that makes it *feel* like Notion

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Slash menu (`/`)** | Typing `/` at the start of (or anywhere in) an empty-ish block opens a searchable, categorized command palette: Suggested, Basic blocks, Inline, Media, Database, Advanced blocks, Embeds, plus AI. Fuzzy-matches on aliases (`/h1`, `/todo`, `/img`). Arrow keys + Enter; Esc closes; continuing to type filters; typing a non-match silently gives up and leaves the `/` as text. | **P0** | Tiptap `Suggestion` plugin. **The "silently give up" behaviour matters** — a menu that eats your slash is infuriating. Fuzzy search over an alias table. Difficulty: medium (1 day), and it is the single most-used UI in the app. |
| **`@` menu** | Unified mention menu: pages (fuzzy, recency-ranked), people, dates (with natural-language parsing), reminders, and "create new page named X". Also `[[` opens the page-link variant, and `+` opens create-page. | **P0** | Same Suggestion machinery, different data source. **Recency-weighted ranking beats alphabetical by a mile.** Difficulty: medium. |
| **Markdown-as-you-type** | `#`/`##`/`###`+space → headings; `-`,`*`,`+`+space → bullet; `1.`+space → numbered; `[]`+space → todo; `>`+space → toggle; `"` or `\|`+space → quote; `---` → divider; `` ` `` `code` `` ` `` → inline code; `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``; ` ```lang ` → code block; `$$` → equation. Paste of markdown text is parsed into blocks. Paste of a URL over selected text creates a link. | **P0** | Tiptap `InputRules` cover most; write the rest. **Paste handling is where clones fall down**: pasting markdown, pasting HTML from a browser, and pasting a URL onto a selection must all do the right thing. Budget a day for paste alone. |
| **Drag handle (`⋮⋮`)** | Appears on hover to the left of every block. Drag to reorder anywhere in the page (with a blue insertion line), **or to the left/right edge of another block to create columns**. Click opens the block menu. Shift-click or drag over multiple to move a group. | **P0** | `@tiptap/extension-drag-handle` (v2-compatible community versions exist) or hand-rolled with `pointer` events + a positions helper. Fractional indexing you already have makes the write cheap. Difficulty: medium-high; the column-creating drop zones are the expensive half — defer them. |
| **`+` button next to the handle** | Inserts an empty block below and opens the slash menu (`Alt/Option+click` inserts above). | **P0** | 30 minutes. Constantly used. |
| **Block menu (`⋮⋮` click / right-click)** | Delete (`Del`), Duplicate (`Cmd+D`), **Turn into** (submenu of compatible types), **Turn into page**, **Copy link to block**, **Move to** (page picker, `Cmd+Shift+P`), **Comment** (`Cmd+Shift+M`), **Color** (10 text + 10 background), **Ask AI**, and per-type extras (caption, alignment, language…). | **P0** | Turn-into is a type-mapping table + content coercion (headings↔text↔lists is lossless; anything↔code loses marks). Difficulty: medium. |
| **Turn into page / turn page into block** | Converts a block (and children) into a sub-page, leaving a link in place; and back. | **P1** | Mechanical given the page/block duality. Half a day. |
| **Block color & background** | Per-block text color and background color from a fixed 10-color palette (gray, brown, orange, yellow, green, blue, purple, pink, red, default). Keyboard: `Cmd+Shift+H` reapplies last used. | **P1** | An attr + CSS classes. **Use a fixed palette, not a color picker** — it's why Notion pages look coherent. Difficulty: trivial. |
| **Block anchor links** | Every block has an id; "Copy link to block" yields `…/page#blockId`; opening it scrolls to and briefly highlights the block. | **P1** | You have block ids. `scrollIntoView` + a 2 s highlight class. ~1 hour, and it makes AI citations and backlinks land precisely. |
| **Block selection model** | `Esc` selects the current block (exits text editing). Then: `↑/↓` move selection, `Shift+↑/↓` extend, `Cmd+A` selects all blocks (pressing again selects the page), click-drag over blocks rubber-band selects, `Shift+click` extends. On a selection: `Backspace` deletes, `Cmd+D` duplicates, `Tab`/`Shift+Tab` indent/outdent, color/turn-into apply to all, drag moves the group. | **P0** | ProseMirror's `NodeSelection`/`CellSelection` don't quite cover multi-block; you need a custom "block selection" plugin with its own decoration layer. **Difficulty: high (1–2 days) and almost always underestimated — but it is a defining Notion behaviour.** |
| **Nesting / indent rules** | `Tab` indents a block under the previous sibling (making it a child); `Shift+Tab` outdents. Works for every block type, not just lists — you can nest a paragraph under a heading, an image under a toggle, etc. Children move with the parent. | **P0** | Your flat top-level-block table makes arbitrary nesting awkward. **Decide now:** either (a) allow a `parent_block_id` on `blocks` with fractional positions (recommended — keeps one row per block, matches Notion), or (b) keep nesting inside the ProseMirror fragment for lists/toggles only. (a) is more work but is what lets toggles/columns/callouts hold real content. Difficulty: medium-high. |
| **Duplicate / delete / move-to** | `Cmd+D`, `Backspace`, and a "Move to" page-search dialog that relocates blocks to another page. | **P0/P1** | Duplicate+delete P0 (trivial). Move-to P1 (half a day; needs the page picker you're building anyway). |
| **Comments on blocks** | Inline comment on a text selection (`Cmd+Shift+M`) creating a highlighted range + a threaded discussion in the right rail; block-level comments; resolve/unresolve; "Resolved" archive; @mentions in comments. | **P2 (as private annotations)** | Strip collaboration: keep a `comments` table keyed to `(block_id, anchor_range)` rendering as a margin note. **This is worth building solo** — it's the natural home for "why did I write this", review notes, and AI-suggestion threads. Difficulty: medium (the text-range anchoring that survives edits is the hard part; store ProseMirror marks, not offsets). |
| **Undo / redo** | `Cmd+Z` / `Cmd+Shift+Z`. Undo history is per-page, survives navigation within a session, groups typing into ~500 ms chunks, and **undoes structural operations (block moves, deletes, turn-into) as single steps**. Notably, undo does *not* cross into database property edits from the editor. | **P0** | Tiptap/ProseMirror history handles in-doc. **The trap:** your debounced server save must not fight undo — save the *result* of the local doc, never re-hydrate the doc from the server mid-session. Difficulty: low if you respect that rule, nightmarish if you don't. |
| **Hover affordances** | Handle + `+` fade in on row hover; link hover shows a preview card; image hover shows resize handles; database row hover shows `OPEN` + `⋮⋮`; every icon has a tooltip with its keyboard shortcut. | **P1** | Pure CSS + a shared `HoverCard`. Cheap, and their absence is the main reason clones feel "not quite right". |
| **Bubble menu (selection toolbar)** | Selecting text pops a floating toolbar: Ask AI, Turn into, Turn into page, link, comment, B/I/U/S, inline code, equation, color, and `•••`. | **P0** | Built into Tiptap 2.27 (do **not** add `@tiptap/extension-bubble-menu`, that's v3 — see CLAUDE.md). Difficulty: low. |
| **Empty-block placeholder** | An empty focused block shows "Type '/' for commands"; an empty unfocused page shows the title placeholder. | **P0** | `Placeholder` extension. 10 minutes, big onboarding effect. |
| **Auto-save + offline resilience** | Notion saves continuously; the desktop app queues edits offline (since 2024's offline mode) and syncs on reconnect. | **P0** | You're local-first by construction — this is a *structural advantage over Notion*, not a feature to copy. Debounced writes to Postgres on localhost are ~1 ms. |

**Sources for §2:** [Block reference (API)](https://developers.notion.com/reference/block) · [Writing & editing basics](https://www.notion.com/help/guides/writing-and-editing-basics) · [Block basics](https://www.notion.com/help/guides/block-basics-build-the-foundation-for-your-teams-pages) · [Keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts) · [Notion shortcuts compendium](https://vida.io/blog/notion-shortcuts)

---

## 3. Calendar & meetings

Two separate products live under this heading. **Notion Calendar** is a standalone Electron/native app (formerly Cron, acquired 2022, rebranded Jan 2024) that is *not* part of the Notion editor — it connects Google/iCloud/Exchange accounts, renders Notion databases with a date property as calendars, and pushes "join meeting" affordances into the macOS menu bar. **Notion AI Meeting Notes** (launched 13 May 2025 in Notion 2.51, still labeled beta as of July 2026) is a block type inside the editor that records device audio, transcribes it, and generates a summary. The two touch at exactly one point: Notion Calendar surfaces `Join and transcribe` / `Add meeting note` buttons on connected events.

For this project, meeting capture is the must-have and calendar is supporting infrastructure. The rest of this section is weighted accordingly — 3.1 is a scoping exercise, 3.2 is the spec to match, 3.3 is the build.

---

### 3.1 Notion Calendar (the app) — feature table

| Feature | What Notion does | Priority | Implementation notes & difficulty |
|---|---|---|---|
| **Event ↔ Notion-page linking** | An event's detail pane has a "Documents" slot: attach an existing Notion page, create a new one inline, or attach an AI Meeting Note. The link is bidirectional — the page shows the event, the event shows the page. | **P1** | The single highest-value calendar feature for this repo, because it's the join between a meeting recording and a page. Just an `event_id uuid null` FK on `pages` (or a join table if you want many-to-many). ~0.5 day. Do this even if you never build a calendar UI. |
| **Multi-account calendar connection (Google / iCloud / Outlook / Exchange)** | Connects multiple Google accounts, iCloud, Exchange, and anything synced to macOS Calendar; per-calendar colour, visibility toggle, default conferencing provider, and a "default calendar" for new events. | **P1 (read-only), P3 (write/two-way)** | **Opinionated recommendation: read-only sync into a local `events` table, and do not build two-way write.** Google Calendar API + OAuth for a single user is ~1 day (device-code or loopback OAuth in Electron, incremental sync via `syncToken`, refresh every 5 min). CalDAV (iCloud, Fastmail, Nextcloud) via `tsdav` is another ~1–2 days and covers the non-Google case without OAuth app registration. Write-back means conflict resolution, ETag handling, recurrence-exception (`RECURRENCE-ID`) editing, and invite semantics — a week of work for a feature you can get by opening Google Calendar in a browser tab. Punt it. |
| **Availability sharing / "share availability" links** | Press `S`, drag time slots on the week view, and Notion Calendar composes both a pasteable text block of your availability *and* a public booking URL where an invitee picks a slot. Recurring scheduling links supported. Team version: press `P`, search a colleague by email, overlay their calendar. | **P3 (skip)** | Requires a publicly reachable web surface, a booking page, and email — all explicitly out of scope for a self-hosted single-user app behind a local Supabase. The text-block half (select slots → copy formatted availability to clipboard) is a legitimately cheap P2 if you ever want it: ~0.5 day, no server. The colleague-overlay feature is a teamspace feature; skip entirely. |
| **Join-meeting button + auto-detected conference links** | A `Join` button appears on events with a conferencing link. If an event has links in *both* the conferencing field and the description, Notion Calendar uses the **description** link. Conferencing providers connected under Settings → Conferencing; per-calendar default provider. Global system-wide "join meeting" hotkey configurable in Settings → Menu bar. | **P1** | Cheap and disproportionately useful. Regex the event `location` / `description` / `conferenceData` for Zoom (`zoom.us/j/`), Meet (`meet.google.com/`), Teams (`teams.microsoft.com/l/meetup-join`), Whereby, Slack Huddle; `shell.openExternal()` from Electron. ~0.5 day. Extend it to `Join and record` — one click that opens the conference *and* starts the local recorder — which is the flow Notion charges for. |
| **Meeting auto-blocking / focus blocks** | "Blocking" copies an event from one calendar onto another as a busy block, optionally hiding details (🔒 open = details shared, closed = hidden). Single-event blocking or auto-block a whole calendar going forward. | **P3 (skip)** | Exists solely to reconcile a personal and a work calendar so *other people* see correct busy time. Single user, no shared free/busy → no reason to build. |
| **Day / week / month views** | Week is the default and the design centre of the app; day, month, and arbitrary N-day views via number keys `1`–`9`. Toggle weekends. | **P1 (week + day), P2 (month)** | Week view is the only one that matters for a meeting-centric workflow. Don't hand-roll the grid: `@fullcalendar/react` (MIT for the core + timeGrid/dayGrid) or `react-big-calendar` gets you week/day/month in ~1 day. A custom Tiptap-adjacent grid is a 3–5 day trap. |
| **Mini-month + multi-timezone display** | Persistent mini-month in the left rail for jumping dates. Time zones are "first-class citizens": add multiple zones as extra gutter columns, give them custom labels, and temporarily "travel" to a zone so everything re-renders in it. | **P2** | Mini-month is ~2 hours with `date-fns`. Multi-timezone gutters are a genuine differentiator and cheap if you store everything as `timestamptz` and render through `Intl.DateTimeFormat` with an explicit `timeZone` — ~0.5 day. Storing local wall-clock times without a zone is the classic mistake; don't. |
| **Keyboard-first navigation & shortcut list** | `?` opens a searchable list of every shortcut. `⌘K` command menu. `T` = today. `J` = next week/month, `B`/`shift+N` = previous event, `N` = next event. `1`–`9` = number of days shown. `.` = jump to a date by natural language ("three months from now", "November 7th"). `S` = share availability. `P` = peek at a teammate's calendar. Global system-wide shortcuts (show/hide menu bar, join meeting) configurable in Settings → Menu bar → System-wide keyboard shortcuts. | **P2** | The command-palette + shortcut-overlay pattern is already the app's identity; this repo has a tabs store and a page-actions menu that a `⌘K` palette would slot into. `.`-to-jump uses `chrono-node` (MIT) for the natural-language date parse — 15 minutes of work, high perceived polish. Full shortcut parity is a long tail; ship `T`/`J`/`N`/`B`/`1-9`/`.`/`?` and stop. ~1 day. |
| **Menu-bar app + upcoming-event widget** | macOS menu bar shows the next event with a live countdown; click for the next N days of events and one-click join/email-participants. Configurable: how many days, include/exclude all-day events, events without participants, events without conferencing or location. | **P1** | **The best value-per-line-of-code item in 3.1.** Electron already ships `Tray` + `Menu`; the countdown is a `setInterval` re-rendering the tray title. ~1 day including the settings toggles. For a meeting recorder this is also the natural home for the **record button** — one click from "meeting starting" to "recording" without opening the app. |
| **Event creation from natural language** | ⚠️ Well-attested for *navigation* (`.` → "three months from now"); a full natural-language **event composer** ("lunch with Sam Thursday 1pm") is widely claimed in third-party blogs but I could not confirm it in Notion's own help docs. Confirmed event creation is: drag on the grid, or the `⌘K` command menu, then fill title/participants/conferencing. | **P2** | `chrono-node` parses "Thursday 1pm for 45 min" into a range in a few lines; the hard part is nothing more than a good input affordance. ~0.5 day. Treat the "Notion does this" claim as unverified. |
| **"Notion Calendar in the sidebar" integration** | Inside the Notion app, connected calendars appear as an upcoming-events strip, and Meeting Notes get a dedicated sidebar "Meetings" tab (rolling out through 2026). Contextual per-event buttons: `AI Meeting note`, `Add meeting note`, `Open meeting note`, **`Join and transcribe`** (auto-appears ~15 min before the meeting for organizers, note-creators, or previously-transcribed recurring events), `Transcribe meeting`, `View summary`. | **P1** | This is the integration that makes calendar worth building at all here. `components/sidebar/` already renders spaces/Favorites/Recents — an "Upcoming" section with today's events plus a `Join and record` button is ~1 day on top of the events table. The ~15-min pre-meeting affordance is a trivial time comparison and is exactly the moment the user needs the record button. |
| **Database-date-property calendars surfaced as calendars** | Any Notion database with a Date property can be connected to Notion Calendar and rendered as a colour-coded calendar alongside real calendars; you can drag to change dates and even update Status properties from the calendar. A "list panel" (Aug 2025) shows database items and calendar events side by side. | **P2** | Depends on the databases feature (see the database section of this matrix) actually existing. Once it does, this is a query, not a feature: `select * from db_rows where date_prop between ? and ?` unioned into the same event stream. ~1 day *after* databases land. Not a reason to prioritise databases. |
| **Notifications / reminders** | Desktop notification N minutes before an event (configurable lead time and sound), plus the menu-bar countdown. Inside Notion proper, date properties carry separate `Remind` options: on the day, 1 day before, 2 days before, 1 week before. | **P1** | `new Notification()` from the Electron main process against a `setTimeout` scheduled off the events table. ~0.5 day. Pair it with "start recording" as a notification action button. |

**Opinionated scope for a single user.** Build a local `events` table (`id`, `source`, `external_id`, `calendar_id`, `title`, `starts_at timestamptz`, `ends_at`, `all_day`, `location`, `description`, `conference_url`, `attendees jsonb`, `rrule`, `page_id`), populate it with **read-only** sync from Google Calendar (OAuth + `syncToken` incremental) and/or CalDAV via `tsdav`, and expose it through three surfaces: a sidebar "Upcoming" strip, an Electron menu-bar tray with a countdown and a record button, and a week-view page. That is roughly 4–6 days of work and delivers ~80% of what Notion Calendar is actually used for. Everything involving *other people* — availability links, colleague overlays, blocking, invite RSVP — is out of scope by the same reasoning that puts sharing/permissions at P3. Two-way write sync is the one seductive item to resist: it is the difference between a weekend and a fortnight.

Sources for 3.1: [Notion Calendar keyboard shortcuts](https://www.notion.com/help/notion-calendar-keyboard-shortcuts) · [Getting started with Notion Calendar](https://www.notion.com/help/guides/getting-started-with-notion-calendar) · [Notion Calendar settings](https://www.notion.com/help/notion-calendar-settings) · [Notion Calendar connections & API](https://www.notion.com/help/notion-calendar-connections) · [Use Notion Calendar with Notion](https://www.notion.com/help/use-notion-calendar-with-notion) · [Availability, blocking & time zones](https://www.notion.com/help/availability-blocking-and-time-zones) · [Notion Calendar help category](https://www.notion.com/help/category/notion-calendar) · [Calendar view databases](https://www.notion.com/help/calendars)

---

### 3.2 Notion AI Meeting Notes — feature table

| Feature | What Notion does | Priority | Implementation notes & difficulty |
|---|---|---|---|
| **How recording starts — device audio, not a bot** | **No bot joins the call.** Notion markets it as "no bot needed." The desktop app (Mac/Windows, **v4.7.0+**, **macOS 13+**) captures **both system audio and microphone**, so remote participants are transcribed even when you're wearing headphones. In the **browser it is microphone-only** — with headphones the far end is not captured at all. Requires system-audio access **and** screen-recording permission. Started via the `/meet` slash command or the "Meet" pill; a `Join and transcribe` button appears on calendar events. | **P0** | The whole feature. Device-audio capture is the correct architecture and is now cheap on macOS — see 3.3.1. `electron-audio-loopback` + `getUserMedia` gets two `MediaStream`s with zero native code on Electron 31–38; Electron 39+ has it built in. **Two channels, not one: mic = you, system = them.** This is the single most consequential decision in the whole build. 2–4 days including code-signing. |
| **Live transcription while recording** | Line-by-line in real time inside the Meeting Notes block; a new line starts on each detected speaker change. Pause/resume supported. **Offline is not supported at all** — audio is streamed live to Notion's sub-processors. | **P0** | Local ASR beats Notion here on privacy and offline. Sub-second partials on CPU with a cache-aware streaming model (Nemotron Speech Streaming 0.6B INT8, 632 MB, via sherpa-onnx), or ~1.5 s chunks with whisper.cpp `small` + LocalAgreement-2. See 3.3.2 and 3.3.4. 3–5 days. |
| **Speaker identification / labelling — and its real limits** | Heuristic **speaker-change detection** plus names pulled from **calendar event attendees** — explicitly *not* voiceprint diarization. Notion's own docs say it "works best for virtual 1:1s where it can isolate mic vs system audio separately" and is **unreliable in group calls, in-person meetings sharing one mic, in the browser, and on mobile**. **English-only.** | **P1** | Notion's honesty here is the strategic gift: their labels come from channel separation + the calendar, which you get for free. Two-channel capture gives perfect "me vs them" at zero compute. Real diarization (splitting "them" into named people) is a P2 add-on — sherpa-onnx pyannote-segmentation-3.0 + TitaNet, RTF 0.11, ~30 s to diarize a 45-min meeting on an M1. See 3.3.3. |
| **AI summary + action items** | Auto-generated on stop. Requires **≥300 characters / ~1 minute** of speech. Presets: **Auto / Sales / Stand-up / Team Meeting**, plus user-defined custom instructions with a personal default. Factors in **both** the transcript *and* manual notes typed alongside it. **In-line citations link back to transcript timestamps** (hover previews, click jumps). | **P0** | A 1-hour meeting is ~8,000–10,000 words ≈ **11,000–14,000 tokens** — single-pass "stuffing" for any 32K-window local model; map-reduce only past ~2 hours. Structured JSON out → the existing `taskList()` / `bulletList()` builders in `app/actions/meetings.ts`. **Must render as a propose-only diff overlay** per the hard rule in `app/api/ai/edit/route.ts`. The ≥300-char guard and the four instruction presets are near-free to copy and high perceived value. 2–3 days. |
| **How the transcript block attaches to a page** | A native **block type**, not an attachment. Works inside database templates. Optional default "Meetings" database that new notes land in. Dedicated sidebar "Meetings" tab (rolling out). Transcript is collapsible and timestamped; summary text is a sibling block above it. | **P0 (page attachment), P1 (Meetings DB)** | **Do not model transcript segments as `blocks` rows.** A 1-hour meeting is ~600–1,200 segments; that many rows would swamp the block table and make the page unloadable, and segments need none of what `blocks` provides (fractional positions, drag-and-drop, per-block AI edits). Use a dedicated `transcript_segments` table rendered by a custom collapsible node view; **summary and action items *are* blocks** because they're user-editable prose the AI panel and RAG must see. Schema in 3.3.4. |
| **Post-hoc "ask AI about this meeting"** | Notion AI and Agents can query a meeting note like any other page; "generate meeting notes" is listed among Notion 3.0 Agent capabilities (Sept 18, 2025), but Meeting Notes remains its own feature line. Custom Agents bill separately at $10 per 1,000 credits. | **P1** | Falls out of RAG for free once transcripts are ingested. Feed the final merged transcript through the existing heading-aware chunker in `lib/rag/` with meeting title + date as the breadcrumb prefix; `hybrid_search` and the Cmd-J panel then cover meetings with zero new code. ~0.5 day. |
| **Language support** | **16 languages**: English, Chinese, Spanish, French, German, Japanese, Korean, Portuguese, Russian, Thai, Vietnamese, Danish, Finnish, Norwegian, Dutch, Swedish. Speaker labelling is English-only regardless. | **P2** | Whisper is 99-language out of the box, so you *exceed* Notion trivially with large-v3-turbo. Streaming models are narrower: Nemotron Speech Streaming EN is English-only; Nemotron 3.5 ASR Streaming 0.6B covers 15 with auto-detect; Parakeet-TDT-0.6B-v3 covers 25 European languages with auto-LID. Apple `SpeechAnalyzer` does automatic **mid-stream** language switching, which nobody else offers. |
| **Duration / plan limits** | **10 hours per user per day.** ⚠️ **No per-recording cap appears in any official Notion doc** — the "90 minutes" figure circulating in third-party blogs has no primary source. Uploads accepted: AAC/M4A/MP3/WAV; **not** MOV/MP4/Loom. Plans: Free ❌ ("Limited Trial" only), Plus $10/user/mo ❌ (Limited Trial only), **Business $20/user/mo annual ✅ unlimited**, Enterprise ✅ + zero LLM-provider retention and admin auto-delete. **No standalone add-on** — the old Notion AI add-on for Free/Plus was retired May 2025; the free Plus-for-students plan does *not* include it. | **P0 (no limits at all)** | Self-hosted means unlimited by construction, and this is the concrete dollar case for building it: $20/user/mo · 12 = $240/yr avoided. Accept every container `ffmpeg` can decode, including MOV/MP4 — a strict superset of Notion. |
| **Storage & privacy** | Audio is **streamed live to named sub-processors: OpenAI, Anthropic, Fireworks, Baseten Labs, X.AI**. Desktop/browser: temp local copy during the session; on real-time failure the local copy is uploaded to Notion and retained up to **3 days**; local copy deleted on success or within **24 h**. Mobile: audio uploaded; on success deleted server-side immediately and locally within 1 day; on failure server retains 3 days, local up to **1 week**. **Local audio storage is opt-in, off by default, and keeps only the 10 most recent recordings.** No training absent opt-in. HIPAA BAA is Enterprise-only (100+ members) and explicitly **excludes Notion Calendar**. ⚠️ EU in-region processing unverified given US-based sub-processors. | **P0** | This is the strongest single argument for building locally: nothing leaves the machine. Store WAVs on disk with the path in `meeting_recordings.audio_path`, **never as bytea in Postgres**. Notion's 10-most-recent retention default is a sensible thing to copy as a configurable cap. |
| **Search / RAG over transcripts** | Meeting notes are ordinary pages, so workspace search and Enterprise Search cover them. | **P1** | Already solved by `lib/rag/`. The only real design choice is chunking: **never split mid-utterance — use speaker-turn boundaries**, with overlap between chunks so action items discussed across turns land in at least one chunk's context. |
| **Linking a meeting to a Projects/Tasks database entry** | Meeting Notes work inside database templates and can live in a default Meetings database; extracted action items are prose, not native task rows. | **P1** | Extract action items as structured JSON (owner, due date if stated, dependencies, status) and render into a `taskList` node — `app/actions/meetings.ts` already has the `taskList(blockId)` builder, so the output shape is defined. Relating them to a real Tasks database depends on the databases feature. |
| **Mobile capture** | Available on eligible subscriptions; **microphone-only**, uploads audio rather than streaming it, and has **no reliable speaker labels**. | **P3 (skip)** | No mobile client is in scope for an Electron-on-macOS app. Notion's own mobile story is the weakest part of the feature; skipping it costs almost nothing. |
| **Consent handling** | "Start transcribing" is framed as a consent confirmation; an optional TTS consent message can be played through the speakers, and workspace owners can force auto-play. | **P2** | Worth copying the TTS consent announcement as a toggle — one `say(1)` call or a pre-rendered WAV played to the output device. ~1 hour, and it's the ethically load-bearing part of recording other people. |

#### Competitive landscape — who records device audio locally vs. joins as a bot

| Product | Bot joins the call? | Local device capture? | **Where transcription runs** | Notes |
|---|---|---|---|---|
| **Notion AI Meeting Notes** | No | Yes (desktop: mic + system) | **Cloud** — OpenAI / Anthropic / Fireworks / Baseten / X.AI | Native page block; browser mode is mic-only |
| **Granola** | No | Yes (Mac; Windows in 2026) | **Cloud** — Deepgram/AssemblyAI + GPT-4o/Claude. Audio not retained, but processing is cloud-side | The product Notion explicitly targeted; iOS + Apple Watch added |
| **Otter.ai** | **Yes** (OtterPilot) | Also a native Mac app (late 2025) with a bot-free option | Cloud | Strongest mobile in-person capture |
| **Fireflies.ai** | **Yes** (Notetaker bot) | Also a desktop "system audio, no bot" mode | Cloud | Bot + Chrome extension + desktop + dialers + API |
| **Fathom** | Traditionally a bot | **Bot-free/local capture on Mac** — ⚠️ still described as beta | Cloud | Free core plan |
| **Limitless** (ex-Rewind) | N/A (wearable + app) | Rewind was local-first; Limitless pivoted to cloud | Cloud | ⚠️ **Discontinued** — Meta acquired Dec 2025, killed Pendant sales, Rewind stopped recording **Dec 19, 2025** |
| **Recall.ai** | **Both** — Meeting Bot API *and* Desktop/Mobile Recording SDKs | Yes (SDK, runs in your app) | Customer's choice | ~$0.50/hr in 2026; SOC2/ISO27001/GDPR/HIPAA; powers many of the above |
| Zoom AI Companion / Teams Copilot / Google Meet "Take notes for me" | Built into the platform | N/A | Cloud (Zoom / Microsoft / Google) | Platform-locked; Meet needs Google AI Pro/Ultra ($20+/mo) |
| tl;dv · Circleback · Read.ai | **Yes** (bots) | — | Cloud | $18–$25/mo tier |
| **Cluely** | No (invisible overlay) | Yes | Cloud | $19.99/mo; ⚠️ 83k-user data breach mid-2025 |

**The pattern: nobody in the commercial tier transcribes locally.** Granola, Notion, Fathom and Otter's bot-free modes all capture device audio locally and then ship it to the cloud — the local part is about avoiding a bot in the participant list, not about privacy. Fully-local transcription is exclusively the open-source cohort:

| Project | Stars | License | Stack | Notes |
|---|---|---|---|---|
| **[Meetily](https://github.com/Zackriya-Solutions/meetily)** | **27.3k** | MIT | Tauri + Next.js + Rust; whisper.cpp / Parakeet + **Ollama** (or Claude/Groq/OpenRouter); SQLite; Metal/CoreML | Most-starred. 100% local, no cloud required. macOS/Win/Linux. Free CE + paid PRO |
| **[anarlog](https://github.com/fastrepl/anarlog)** (formerly Hyprnote) | **8.9k** | MIT | Rust/Tauri/React; mic + system audio; Whisper on-device; HyprLLM local or BYO-LLM (Ollama/LM Studio) | ⚠️ Renamed — original team pivoted to "char"; anarlog remains the MIT notetaker. YC S25 |
| **[OpenWhispr](https://github.com/OpenWhispr/openwhispr)** | — | open source | **Electron** + sherpa-onnx sidecar (pinned 1.13.4) over local WebSocket; Nemotron streaming 0.6B INT8; pyannote-seg-3.0 + CAM++ diarization | **Closest architectural match to this repo, and the best engineering writeups found.** Read both the streaming and diarization posts in full |
| [Amurex](https://github.com/thepersonalaicompany/amurex) | 2.8k | AGPL-3.0 | Chrome extension + self-hosted backend | ⚠️ Stale — latest release v1.0.27, March 2025. Not purely local |
| [Vibe](https://thewh1teagle.github.io/vibe/) | — | open | Offline Whisper, Mac/Win/Linux | General transcription, not meeting-specific (no live capture UI) |
| MacWhisper | — | commercial, **$49 one-time** | Mac-only, local Whisper/Parakeet, system audio + meeting auto-detect (Zoom/Teams) | Diarization in beta. The "buy instead of build" benchmark |
| Superwhisper | — | commercial | Whisper Tiny–Standard or Parakeet, 100% offline; **Parakeet Realtime streaming added Jan 2026** | Meeting mode doesn't diarize by default (togglable) |
| Obsidian plugins | — | various | "Local Dictation" (mic + system, speaker labels, timestamps, no API key), "AI Meeting Notes" (Whisper + Ollama), "Obsidian Voice Notes" | All local-Whisper-based; proof the niche is well-trodden |

Sources for 3.2: [AI Meeting Notes help](https://www.notion.com/help/ai-meeting-notes) · [Preserve perfect meeting memory guide](https://www.notion.com/help/guides/preserve-perfect-meeting-memory-with-ai-meeting-notes) · [Notion 2.51 release notes, 13 May 2025](https://www.notion.com/releases/2025-05-13) · [Notion 3.0 / Agents](https://www.notion.com/releases/2025-09-18) · [Notion pricing](https://www.notion.com/pricing)

---

### 3.3 Technical appendix — replicating meeting capture locally on macOS

**Verdict up front: this is a shipping option, not a research project.** Three things changed between 2024 and 2026 that make a local replacement for AI Meeting Notes achievable on Apple Silicon in roughly two weeks of focused work.

1. **macOS gained first-class system-audio APIs.** Core Audio process taps (`AudioHardwareCreateProcessTap`, macOS 14.2, usable ~14.4) and ScreenCaptureKit's `captureMicrophone` (macOS 15) mean BlackHole and Rogue Amoeba drivers are no longer required.
2. **Electron itself can do loopback audio on macOS.** Chromium's `MacLoopbackAudioForScreenShare` / `MacSckSystemAudioLoopbackOverride` flags surfaced mid-2025 and landed upstream by Electron 39, collapsing the hardest part of the problem into a `getDisplayMedia` call.
3. **Local ASR is fast and streaming-capable.** whisper large-v3-turbo runs at **17–80× realtime** on Apple Silicon; cache-aware streaming models give sub-second partials on CPU; Apple's `SpeechAnalyzer` on macOS 26 is free, bundled, and benchmarked **~2.2× faster than MacWhisper's large-v3-turbo**.

The architectural insight the entire local-first category converged on: **capture mic and system audio as two separate streams and you get perfect "me vs. them" separation for free — no diarization needed for the hardest split.** Notion does essentially this and admits its speaker labelling only works reliably for 1:1 virtual calls for exactly that reason.

The biggest non-obvious cost is **code signing** (see 3.3.1). Budget a day for it.

#### 3.3.1 System audio capture

| Mechanism | Min macOS | Mic + system separately? | Per-app targeting | Extra install? | TCC permission |
|---|---|---|---|---|---|
| **ScreenCaptureKit** (`SCStreamConfiguration.capturesAudio`) | 13.0 Ventura | System only | Per-app / per-window via `SCContentFilter` | No | Screen Recording |
| **ScreenCaptureKit** (`captureMicrophone` + `.microphone` output) | **15.0 Sequoia** | **Yes — two `SCStreamOutputType`s** | Yes | No | Screen Recording + Microphone |
| **Core Audio process taps** (`AudioHardwareCreateProcessTap`) | 14.2 (usable ~14.4) | System only (pair with `getUserMedia` for mic) | **Yes — include/exclude PID lists** | No | `NSAudioCaptureUsageDescription` (own TCC bucket) |
| **Electron/Chromium loopback** (`getDisplayMedia({audio:'loopback'})`) | 12.3+ (13+ for the SCK path) | Yes — two `MediaStream`s | No (system-wide) | No | Screen Recording |
| **BlackHole / Loopback / aggregate device** | any | Only via routing gymnastics | No | **Yes** | none (but admin install) |

**ScreenCaptureKit.** Audio arrived in macOS 13 via `SCStreamConfiguration.capturesAudio` plus `excludesCurrentProcessAudio` (so you don't record your own app's output). Mic capture is macOS 15.0: `captureMicrophone` (Bool) and `microphoneCaptureDeviceID` (an `AVCaptureDevice.uniqueID`, falling back to the system default). macOS 15 added `SCStreamOutputType.microphone` alongside `.screen` and `.audio` — **mic and system audio arrive as genuinely separate `CMSampleBuffer` streams on separate output queues**, which is exactly the split you want with no demuxing. Target sample rate and channel count are configurable on the config (16 kHz mono, which is what Whisper wants anyway).

⚠️ There is an **open, unresolved Apple Developer Forums bug**: "ScreenCaptureKit recording output is corrupted when `captureMicrophone` is true" ([thread 805892](https://developer.apple.com/forums/thread/805892)). Test with real audio before committing. Also note SCK forces the Screen Recording permission *and* the menu-bar recording indicator even for audio-only use — several practitioners call this out as bad UX for a note-taker.

**Core Audio process taps** are the audio-native alternative and the path most 2025/2026 writeups converged on:

1. PID → `AudioObjectID` via `kAudioHardwarePropertyTranslatePIDToProcessObject`
2. Build a `CATapDescription` — either "mixdown of these PIDs" or "global tap minus these PIDs"
3. `AudioHardwareCreateProcessTap` ← **this call is what triggers the TCC prompt**
4. `AudioHardwareCreateAggregateDevice` combining the tap with a real output device, marked private via `kAudioAggregateDeviceIsPrivateKey: true` so it doesn't pollute the user's device list
5. Read `kAudioTapPropertyFormat`, register an IOProc with `AudioDeviceCreateIOProcIDWithBlock`, then `AudioDeviceStart`

This is the only mechanism that can cleanly tap **just Zoom** rather than everything the machine is playing. Foot-guns, from an unusually good [April 2026 writeup](https://dgrlabs.co/blog/2026-04-25-capturing-system-audio-on-macos-in-2026.html):

- `CATapDescription.exclusive` is a **direction flag, not a lock toggle** — setting `isExclusive` *after* using the "exclude" initializer silently inverts the semantics to "include only," producing a tap that runs perfectly and delivers permanent silence.
- **`AVAudioEngine` cannot be retargeted to a tap-backed aggregate device.** Use `AudioDeviceCreateIOProcIDWithBlock` directly.
- An empty sub-device list with the tap as main sub-device silently yields zero samples.
- Deployment target must be ≥ 14.4 or you land in a different TCC category.

Reference implementations: [Apple's Core Audio taps guide](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps) · [**insidegui/AudioCap**](https://github.com/insidegui/AudioCap) (Guilherme Rambo — the canonical Swift sample, includes a private-API TCC probe) · [**makeusabrew/audiotee**](https://github.com/makeusabrew/audiotee) (Swift CLI, PCM to stdout).

**Virtual audio devices — now the fallback, not the primary path:**

| | BlackHole | Loopback / Audio Hijack |
|---|---|---|
| Type | Core Audio **HAL plugin** (not a kext), `.driver` bundle in `/Library/Audio/Plug-Ins/HAL` | Rogue Amoeba signed driver framework |
| Version (Jul 2026) | 0.7.1, universal binary, 2/16/64/128/256ch, 8 kHz–768 kHz | Audio Hijack 4.5.3, macOS 14.4+, works on macOS 26 Tahoe |
| Cost / licence | Free, GPLv3 | ~$99+ commercial |
| Install friction | Admin installer + `coreaudiod` restart; no kext dialog | Own installer |
| Per-app isolation | No — system-wide loopback | Yes (Audio Hijack) |
| Downside | Needs a Multi-Output Device in Audio MIDI Setup to hear yourself; silently breaks default output routing if misconfigured | Licensing makes bundling inappropriate |

**Permissions / TCC:**

| Permission | Info.plist key | Triggered by | Notes |
|---|---|---|---|
| Screen Recording (`kTCCServiceScreenCapture`) | — (no usage string) | First SCK / `getDisplayMedia` call | Re-prompts **monthly** on macOS 15+ (Apple walked back the beta's weekly nag); no longer prompts on every reboot |
| Microphone | `NSMicrophoneUsageDescription` | `getUserMedia({audio:true})` / AVFoundation | Electron's `systemPreferences.askForMediaAccess('microphone')` works |
| **System audio capture** | **`NSAudioCaptureUsageDescription`** | First `AudioHardwareCreateProcessTap` | **Its own TCC bucket, separate from microphone.** No public check/request API. Reset via `tccutil reset SystemAudioCaptureRequests <bundle-id>` |

**Electron's API does not cover this.** `systemPreferences.askForMediaAccess(mediaType)` accepts only `'microphone'` and `'camera'`. `getMediaAccessStatus` additionally accepts `'screen'` but is read-only — there is no "ask" for screen recording, it's implicitly triggered by first use. Neither has any concept of the process-tap permission; you handle it yourself, either by letting the native helper trigger it or via an AudioCap-style private-API probe.

> ⚠️ **The code-signing / TCC gotcha — read this before writing any capture code.**
> **Code signing is effectively mandatory even without notarization.** TCC keys grants to the binary's **code identity / CDHash**. Ad-hoc signatures regenerate that identity on every rebuild, so every rebuild forgets prior grants. Worse: in the DGR Labs case an **unsigned `xcodebuild` build never fired the permission prompt at all** — a silent failure that looks exactly like a code bug ([Apple Developer Forums thread 795739](https://developer.apple.com/forums/thread/795739)). A **free Apple Development certificate is enough**; you never need to notarize. Set up a stable signing identity *first*.
>
> Required entitlements for an Electron app bundling a native helper:
> ```
> com.apple.security.cs.allow-jit                      # V8/Chromium
> com.apple.security.device.audio-input                # mic
> com.apple.security.cs.disable-library-validation     # REQUIRED to exec a differently-signed helper
> ```
> Without the last one you get `Operation not permitted` when spawning the Swift helper ([packaging guide](https://stronglytyped.uk/articles/packaging-shipping-electron-apps-audiotee)).
>
> Bundle helper binaries via **`extraResources`, not `asarUnpack`** — ASAR-packed binaries cannot be executed; resolve the path via `process.resourcesPath`.
>
> Finally: **test from a packaged, signed `.app`.** Dev runs launched from a terminal behave differently, and some terminals never surface the audio prompt at all.

**Node/Electron integration — what ships vs. what's research:**

| Option | Status | Repo / npm | Last release | Verdict |
|---|---|---|---|---|
| **`electron-audio-loopback`** | **Production-ready** | [alectrocute/electron-audio-loopback](https://github.com/alectrocute/electron-audio-loopback), 118★, MIT | **v1.0.6, 2025-08-03** | **Easiest path.** Requires Electron ≥31.0.1 and <39.0.0. Returns a `MediaStream` with audio tracks only (video auto-stripped). **Electron 39+ doesn't need it — the fix landed upstream.** |
| **`audiotee` + `audioteejs`** | **Production-ready** | [makeusabrew/audiotee](https://github.com/makeusabrew/audiotee) (83★) + [audioteejs](https://github.com/makeusabrew/audioteejs) | **v0.0.7, 2025-10-17** | Swift CLI, prebuilt universal binary <600 KB in the tarball, ad-hoc signed (inherits your app's signature when nested in a signed bundle). Events `data`/`start`/`stop`/`error`/`log`. Flags `--include-processes`, `--exclude-processes`, `--sample-rate` (8k–48k), `--stereo`, `--mute`, `--chunk-duration`. API explicitly marked unstable. |
| **`screencapturekit` (Rust)** | Maintained | [svtlabs/screencapturekit-rs](https://github.com/svtlabs/screencapturekit-rs) | **v8.0.1, July 2026** | Safe 1:1 Rust bindings. Only if you'd rather write the helper in Rust than Swift. |
| **`sherpa-onnx-node`** | Maintained, Electron caveat | npm `sherpa-onnx` | ~1.13.4 | Native addon for ASR/VAD/diarization. Open Electron issue [#1945](https://github.com/k2-fsa/sherpa-onnx/issues/1945) ("could not find module"). A WASM npm variant exists as a rebuild-free fallback. |
| `mac-screen-capture-permissions` | Stale but probably works | [karaggeorge/mac-screen-capture-permissions](https://github.com/karaggeorge/mac-screen-capture-permissions) | **v2.1.0, 2023-09-11** | Permission helper only, not a capture library. |
| `naudiodon` (PortAudio) | Alive but wrong tool | [Streampunk/naudiodon](https://github.com/Streampunk/naudiodon) | issues active Feb 2026 | Device I/O, **not** macOS loopback. Still needs BlackHole. README self-describes as prototype-grade. |
| `sparticleinc/mac-audio-capture` | **Experimental** | [repo](https://github.com/sparticleinc/mac-audio-capture), 4★ | — | Swift + N-API in-process addon. Architecturally interesting (no subprocess) but "implement accurate permission checking" is still an open TODO. |
| `divyanshunegi/ElectronCaptureKit` (npm `capturekit`) | Niche | [repo](https://github.com/divyanshunegi/ElectronCaptureKit), 33★ | — | Screen **video**; does not demonstrate separate mic/system audio. |
| `cpal` ScreenCaptureKit host | **Not shippable** | [cpal issue #876](https://github.com/RustAudio/cpal/issues/876), PR #894 | unmerged | Watch, don't depend. |
| `swift-audio-tap`, `node-mac-audio`, `node-audio-capture`, `sc-audio`, `@wavemaker` | ⚠️ **Could not verify these exist** | — | — | Treat as non-existent. |
| `node-core-audio` | ⚠️ Unverified, likely abandoned | [mmende/node-core-audio](https://github.com/mmende/node-core-audio) | — | — |

**The Electron loopback story inverts conventional wisdom.** Historically `getUserMedia({audio:{mandatory:{chromeMediaSource:'desktop'}}})` did *not* capture system audio on macOS — loopback was Windows-only. In mid-2025 Alec Armbruster found undocumented Chromium flags by reading source: `MacLoopbackAudioForScreenShare`, `MacSckSystemAudioLoopbackOverride` (SCK-backed), and `MacCatapSystemAudioLoopbackCapture` (Core-Audio-tap-backed). Enable the first two, call `getDisplayMedia({video:true, audio:'loopback'})`, discard the video tracks, and you get clean system-audio-only capture with **zero drivers and zero extra binaries**. ([Writeup](https://alec.is/posts/bringing-system-audio-loopback-to-electron/) · [Electron tracking issue #47490](https://github.com/electron/electron/issues/47490), confirmed working on macOS 15 + Electron 36.4.0 · [docs PR #47493](https://github.com/electron/electron/pull/47493) · [Electron 39 dependency-free demo](https://github.com/chrhartm/electron-mic-speaker-loop).) The risk is that it rides private Chromium flags which already changed once, at Electron 39 — acceptable for a single-user self-hosted app.

**The "buy" benchmark: [Recall.ai Desktop Recording SDK](https://www.recall.ai/product/desktop-recording-sdk)** is a local on-device recorder, not a bot — it runs inside your own Electron/Tauri/native app, auto-detects meeting start across Zoom/Meet/Teams/Slack Huddles/in-person, and captures audio, video, transcripts (with real speaker names via calendar matching), and screen shares. But it is a **commercial hosted API** (~$0.50/hr as of 2026), not self-hostable — the opposite of this project's goals. Their own comparison claims 99%+ reliability vs ~98% for a hand-rolled native-API implementation; that's marketing, but a fair signal that the edge cases are real.

**Recommendation.** Start with **`electron-audio-loopback` (system) + `getUserMedia({audio:true})` (mic)** on Electron 31–38, or plain `getDisplayMedia({audio:'loopback'})` on Electron 39+. Zero native code, two `MediaStream`s, one afternoon. Keep **`audiotee` bundled via `extraResources`** as the escape hatch if the Chromium flags break again — it's a <600 KB universal binary and swapping it in is a contained change because both paths produce the same 16 kHz PCM. Write both channels straight to disk as separate WAVs the moment capture starts; never lose the audio. Only reach for a hand-written ScreenCaptureKit or Core-Audio-tap helper if you need **per-app targeting** (record just Zoom) — and if you're writing a Swift helper anyway, see 3.3.2 for why you should put `SpeechTranscriber` in it too.

#### 3.3.2 Local ASR

**Engines on Apple Silicon:**

| Engine | Backend on Apple Silicon | ANE? | Friction | Licence |
|---|---|---|---|---|
| **whisper.cpp** | Metal by default, no flags | Optional via Core ML encoder conversion (`WHISPER_COREML=1`, needs `coremltools` + `ane_transformers`; slow first-run graph recompile, then cached) | Low (CPU/Metal), medium (Core ML) | MIT |
| **WhisperKit** (Argmax) | Swift/Core ML, splits work across ANE + GPU | **Yes, first-class** | Low with prebuilt HF model repos; SPM | MIT |
| **MLX Whisper** | Metal via MLX unified memory | No (GPU only) | Low, `pip install mlx-whisper` | MIT |
| **faster-whisper** (CTranslate2) | **CPU only on Mac** — no Metal/MPS backend exists | No | Very low | MIT |
| **Apple `SpeechAnalyzer` / `SpeechTranscriber`** | Native Apple model, macOS 26+ | Yes | Swift only; **free, bundled with the OS** | OS framework |
| OpenAI Whisper (PyTorch) | MPS (partial) or CPU | No | Low install, poor perf | MIT |

**faster-whisper is the wrong default on a Mac** despite being the NVIDIA go-to: CTranslate2 has no Metal backend ([issue #515](https://github.com/SYSTRAN/faster-whisper/issues/515)) — community consensus is ~3× realtime for large-v3 on CPU vs whisper.cpp+Metal's 10×+.

**Models:**

| Model | Params | Disk (fp16) | Disk (q5) | Working RAM | WER notes | Langs |
|---|---|---|---|---|---|---|
| whisper tiny | 39M | 75 MB | ~40 MB | ~1.0 GB | ~9% clean / ~22% noisy | 99 |
| whisper base | 74M | 142 MB | ~80 MB | ~1.5 GB | ~6.5% / ~17% | 99 |
| whisper small | 244M | 466 MB | ~250 MB | ~2.5 GB | ~4.5% / ~12% | 99 |
| whisper medium | 769M | 1.5 GB | ~800 MB | ~5.0 GB | ~3.8% / ~9% | 99 |
| whisper large-v2 | 1.55B | ~2.9 GB | ~1.6 GB | ~10 GB | ~3–4% clean | 99 |
| whisper large-v3 | 1.55B | 2.9 GB | ~1.6 GB | ~10 GB | 2.7% test-clean / 5.2% test-other; **7.44% Open-ASR mean** | 99 |
| **whisper large-v3-turbo** | **809M** | ~1.5 GB | — | ~6 GB | **7.75% Open-ASR mean** (~0.3 pt worse than large-v3) | 99 |
| distil-large-v3 | 756M | ~1.5 GB | — | ~5 GB | within 1% of large-v3 long-form | **EN only** |
| distil-large-v3.5 | ~0.8B | — | CT2/ONNX | — | ~1.5× faster than turbo, ~2× faster than large-v3, drop-in quality | **EN only** |
| **Parakeet-TDT-0.6B-v2** | 0.6B | small | — | low | very competitive with Whisper | **EN only** |
| **Parakeet-TDT-0.6B-v3** | 0.6B | — | — | low | **6.32% WER**, RTFx 3332 (A100) | **25 EU langs**, auto-LID, 24 min/pass |
| Parakeet CTC 1.1B | 1.1B | — | — | — | 6.68% WER, RTFx 2794 (vs large-v3's RTFx 68.6 at 6.43%) — **40× throughput for ~0.25 pt WER** | EN |
| **Nemotron Speech Streaming EN 0.6B** | 0.6B | **632 MB INT8 ONNX** | — | low | **6.93% WER @ 1.12 s chunks (streaming)** | EN |
| Nemotron 3.5 ASR Streaming 0.6B | 0.6B | **650 MB INT8 ONNX** | — | low | — | 15 langs, auto-detect |
| Moonshine tiny | 27M | 34 MB | — | <1 GB | beats Whisper tiny/base at same size (vendor) | EN |
| Moonshine v2 streaming tiny | 26M | 34 MB | — | <1 GB | **~50 ms latency**, 5.8× faster than Whisper tiny (vendor) | EN |
| Kyutai STT 1B | ~1B | — | — | — | **0.5 s delay**, built-in semantic VAD | en + fr |
| Kyutai STT 2.6B | 2.6B | — | — | — | 6.40% WER, **2.5 s delay** | EN |
| Voxtral Mini 4B Realtime | 3.4B LM + 970M enc | — | — | — | 7.68% streaming; **~4.90% FLEURS-en @ 480 ms** | 13 |
| Qwen3-ASR-1.7B | 1.7B | — | — | — | 5.76% WER | 52 |
| IBM Granite Speech 4.1 2B | 2B | — | — | — | 5.33% WER (leaderboard-leading, contested methodology) | 6 |
| Canary-Qwen-2.5B | 2.5B | — | — | 16 GB+ VRAM | 5.63% WER, RTFx 418 | EN — **CUDA/NeMo only, no Mac port** |
| ElevenLabs Scribe | closed | — | — | — | — | **Cloud only** |

⚠️ **Leaderboard WER caveat**: as of a July 2026 analysis the top of the field sits within ~1 WER point and **averages are not computed over identical dataset subsets** — some model cards drop TED-LIUM (an easy set), inflating rank. Treat sub-1-point deltas as noise. Architecture trend worth knowing: **Conformer-encoder + LLM-decoder** (Canary-Qwen, Granite Speech, Phi-4-Multimodal) wins accuracy; **CTC/TDT decoders** (Parakeet family) win throughput by 10–100× at a cost of ~0.3–0.5 WER points.

**Measured speed — whisper.cpp v1.8.4 full pipeline, Mac Studio M3 Ultra (80-core GPU), Metal + Accelerate, 11 s JFK clip, median of 3.** Best-quality benchmark found (published methodology + raw data, CC BY 4.0):

| Model | Size (MB) | Inference (ms) | **RTF (× realtime)** |
|---|---|---|---|
| tiny | 74 | 136.1 | **80.9×** |
| base | 141 | 161.5 | **68.1×** |
| small | 465 | 309.5 | **35.5×** |
| medium | 1,463 | 713.9 | **15.4×** |
| **large-v3-turbo** | 1,549 | 622.9 | **17.7×** ← faster than medium despite a bigger file (4-layer decoder) |

Cross-chip anchors for `tiny` on the same clip: M1 Air ~800 ms, M2 Max ~250 ms, M3 Ultra ~130 ms.

**Per-chip RTF estimates** (⚠️ the source explicitly calls these "illustrative ranges," not controlled benchmarks — weaker evidence than the table above):

| Model | M1 (8c GPU) | M2 Pro (16c) | M3 (10c) | M4 (10c) |
|---|---|---|---|---|
| tiny (q5) | ~24× | ~38× | ~30× | ~38× |
| base (q5) | ~14× | ~22× | ~18× | ~24× |
| small (q5) | ~6× | ~11× | ~9× | ~12× |
| medium (fp16) | ~2.5× | ~5× | ~3.5× | ~5× |
| large-v3 (fp16) | ~1.0× | ~2.5× | ~1.8× | ~2.6× |

Metal-vs-CPU speedup on M2 Pro: 1.36× (tiny) → 1.92× (large-v3) — the benefit grows with model size. **WhisperKit on M2 Ultra**: large-v3-turbo at **42× realtime** on the recommended ANE-only config (best thermals/battery), up to **72× realtime** GPU+ANE hybrid; Argmax's "stateful" Core ML decoder cuts per-token decode from **8.4 ms → 4.6 ms** and **1.5 W → 0.3 W** on M3's ANE. **MLX**: `parakeet-mlx` reports **RTF 0.042 (~24× realtime) on M4** for Parakeet-TDT-0.6B-v2 (M1/M2/M3 untested). ⚠️ **Lightning Whisper MLX's "10× over whisper.cpp" is a vendor self-report with no independent corroboration.** Historical whisper.cpp encoder-only bench (M1 Pro, NEON+BLAS, 8 threads): tiny 102 ms, base 220 ms, small 685 ms, medium 1,928 ms, large 3,350 ms encode.

**Streaming / partial transcripts:**

| Approach | Mechanism | Latency | Trade-off |
|---|---|---|---|
| whisper.cpp `stream` example | Sliding window + periodic tail re-transcription | Window/step dependent | Boundary word errors, duplicated text at chunk edges |
| **ufal/whisper_streaming** | **LocalAgreement-2**: longest common prefix of two consecutive hypotheses is confirmed; unconfirmed tail speculative | **3.3 s** avg computationally-aware (⚠️ measured on an **NVIDIA A40**, not Apple Silicon) | Too-aggressive confirmation → premature wrong commits |
| collabora/WhisperLive | faster-whisper + VAD gating | ~500–800 ms (informal) | VAD adds its own detection delay |
| WhisperLiveKit / QuentinFuxa | LocalAgreement backend, `HypothesisBuffer` of three token lists | — | Cleanest reference implementation of the reconciliation data structure |
| WhisperKit streaming | Native Swift chunked streaming, stateful Core ML decoder | −45% decode step (8.4→4.6 ms/token, M3 ANE) | Inherits Whisper's hallucination-on-silence risk |
| **Nemotron cache-aware streaming (sherpa-onnx)** | **Encoder keeps state between chunks (KV-cache for speech)**; compute stops scaling with recording length | **80 ms – 1.12 s configurable**; "well under a second behind your voice" in a shipping product | 6.93% streaming vs 5.91% best batch — ~1 WER point |
| Moonshine v2 streaming tiny | Sliding-window encoder, no positional embeddings, 80 ms lookahead | **~50 ms** (vendor) | Tiny-model accuracy ceiling |
| Kyutai STT | Delayed streams modeling (Moshi-derived) | 0.5 s (1B) / 2.5 s (2.6B) | Larger = more delay, more accuracy |
| Voxtral Mini Realtime | Sliding-window attention in both halves | 80–2400 ms in 80 ms steps; **Mistral recommends 480 ms** | Degrades toward 80 ms; 480–960 ms is the knee |

The key distinction is **pseudo-streaming** (chunk a batch model) vs **true streaming** (a model trained on streams). OpenWhispr articulates the former's failure modes better than any academic source: *"Buffer ~1.5s, run a full transcription on that chunk, append, repeat. Three problems, every one structural. **Latency**: words can't appear faster than the buffer fills. **Boundaries**: a word straddling two chunks gets cut in half and neither chunk can fix it. **Context**: chunk five doesn't know what you said in chunk four — so 'their' vs 'there' is a coin flip the model re-tosses every 1.5 seconds."*

**Word-level timestamps:**

| Method | How | Accuracy | Cost |
|---|---|---|---|
| whisper.cpp `--max-len 1` | Token-boundary heuristic, one word per line | Coarse | Free |
| whisper.cpp `--dtw` / `-ojf` | DTW over cross-attention weights from empirically-selected alignment heads; per-token start/end + confidence | **±500 ms** | Modest |
| faster-whisper `word_timestamps=True` | Same DTW, one flag | ±hundreds of ms | Low |
| **WhisperX forced alignment (wav2vec2)** | Second pass: phoneme-level forced aligner over audio + text | **±50 ms** — 10× tighter. Switchboard P/R 93.2%/65.4% (vs Whisper 85.4%/62.8%); AMI 84.1%/60.3% (vs 78.9%/52.1%) | Extra model + pass; **fails on non-dictionary tokens** (numbers, currency, symbols) |
| whisper-timestamped (linto-ai) | Community DTW impl with confidence scores | ~same as whisper.cpp DTW | Low |

For click-to-seek and citation-back-into-transcript, **`--dtw` is good enough at zero extra cost.** Reserve WhisperX-style alignment for word-level captioning.

**VAD** — don't hand-roll it. **Silero VAD** is ~1 MB, <1 ms per >30 ms chunk on a single CPU thread (ONNX 4–5× faster still), prefers 150–250 ms chunks, and is much better than WebRTC VAD in noise. whisper.cpp now **ships Silero natively** (`ggml-silero-v6.2.0.bin`; `whisper-cli -vm /path/ggml-silero-v6.2.0.bin --vad`), iterated through v1.8.4 (Mar 2026) and v1.8.5 (May 2026, streaming VAD improvements). pyannote's VAD is only worth it if you already need pyannote.

**Apple `SpeechAnalyzer` is the important 2025/2026 development, and neither Notion nor most competitors use it.** Introduced at WWDC25, it's an on-device Apple-model transcriber trained specifically for **sustained transcription over minutes or hours** (not short Siri queries), with automatic mid-stream language switching. MacStories benchmarked a CLI using it against MacWhisper's large-v3-turbo on a 7 GB video file: **2.2× faster with no noticeable quality difference**. Argmax's assessment: it "matches the speed and accuracy of mid-tier Whisper models on long-form conversational speech." Zero model download, zero disk cost, zero RAM management. Trade-off: macOS 26 and a Swift helper. Working ScreenCaptureKit + SpeechAnalyzer sample at [Apple forums thread 819555](https://developer.apple.com/forums/thread/819555); complete open-source app at [FluidInference/swift-scribe](https://github.com/FluidInference/swift-scribe).

**Recommendation.** Two models, two jobs.
- **Live partials**: sherpa-onnx online server with **Nemotron Speech Streaming EN 0.6B INT8 (632 MB)** — true streaming, cache-aware, sub-second, CPU-only, and it gives you diarization from the same toolchain later. If you want to ship something in a day instead, whisper.cpp `small` + `--vad` at 1.5 s chunks with LocalAgreement-2 is acceptable and 35× realtime.
- **Final transcript**: **whisper large-v3-turbo** (809M, ~1.5 GB, 7.75% Open-ASR) with `--dtw` and `--vad`. At 15–18× realtime a 1-hour meeting re-decodes in **~3–4 minutes** — free relative to the value of the meeting, and it lets you run offline diarization in the same pass. large-v3 buys you ~0.3 WER points for 2× the RAM and half the speed; not worth it.
- **Evaluate the shortcut first if you're on macOS 26**: one small Swift helper doing ScreenCaptureKit capture *and* `SpeechTranscriber` transcription collapses 3.3.1 and 3.3.2 into a single ~400-line file with no model downloads at all. It's Swift-only and macOS-26-only, but for a single-user self-hosted app that constraint may simply not matter.
- Avoid **faster-whisper** (CPU-only on Mac) and anything CUDA/NeMo-native (Canary-Qwen has no Mac port).

#### 3.3.3 Speaker diarization

**Start with the argument that you probably don't need it.** If mic = you and system output = everyone else, you get perfect 2-way separation at **zero compute**. Diarization is then only needed to split "them" into multiple named remote speakers — which for 1:1s, the most common meeting shape, is nothing at all. OpenWhispr states the rationale explicitly: *"Audio capture is dual-stream from day one. The microphone is definitionally 'you,' so we never spend compute trying to diarize your own voice — every mic segment gets labeled `you` by source, not by voice matching. System audio (everyone else on the call) is the only thing that actually needs speaker-splitting, which immediately halves the work."* This is confirmed in use by **Hyprnote/anarlog**, **Granola**, **Superwhisper** (meeting mode), and implicitly by **Notion**, whose docs admit speaker labelling "works best for virtual 1:1s where it can isolate mic vs system audio separately."

Known failure modes of the channel-split approach (widely asserted; ⚠️ **no rigorous published quantification found** — a real gap you'd discover empirically):
- **Crosstalk/bleed** — without headphones, your mic picks up the far end, so "them" leaks into "you."
- **AEC artifacts** — OS-level echo cancellation can suppress or distort the far-end signal in ways that hurt ASR.
- **Overlapping speech** — transcribing two channels independently and merging by timestamp garbles or duplicates text at overlaps, since neither pass knows about the other channel.

whisper.cpp's `--diarize` flag is **exactly this trick, naively implemented**: for a 2-channel WAV it compares per-segment L/R energy. It is not a model and breaks entirely on mono or multi-speaker-per-channel. Separately, `-tdrz` ([**tinydiarize**](https://github.com/akashmjn/tinydiarize)) is a fine-tuned Whisper checkpoint emitting a `[SPEAKER_TURN]` token — it detects *when* speakers change but does **not** cluster or re-identify the same speaker across the file.

**If you do need real diarization — pyannote.audio, three generations:**

| | `speaker-diarization-3.1` (2023) | **`speaker-diarization-community-1`** (Sept 2025, pyannote.audio 4.0) | `precision-2` (commercial) |
|---|---|---|---|
| Licence | MIT code + weights, **gated HF repo** (accept conditions + HF token) | **CC-BY-4.0**, also gated + HF token | Proprietary, pyannoteAI API key |
| Local? | Yes, offline after download | Yes — 4.0 adds explicit offline use via `git lfs clone` | **No — audio leaves the device** |

**DER** (full DER — no forgiveness collar, overlap scored, the strictest convention; table last updated 2025-09):

| Benchmark | 3.1 | **community-1** | precision-2 |
|---|---|---|---|
| AISHELL-4 | 12.2 | 11.7 | 11.4 |
| AliMeeting (ch.1) | 24.5 | 20.3 | 15.2 |
| **AMI (IHM)** | 18.8 | **17.0** | 12.9 |
| AMI (SDM) | 22.7 | 19.9 | 15.6 |
| AVA-AVD | 49.7 | 44.6 | 37.1 |
| CALLHOME (part 2) | 28.5 | 26.7 | 16.6 |
| **DIHARD 3 (full)** | 21.4 | **20.2** | 14.7 |
| Ego4D (dev) | 51.2 | 46.8 | 39.0 |
| MSDWild | 25.4 | 22.8 | 17.3 |
| RAMC | 22.2 | 20.8 | 10.5 |
| REPERE (phase2) | 7.9 | 8.9 | 7.4 |
| **VoxConverse v0.3** | **11.2** | **11.2** | 8.5 |

**Practical expectation for meeting audio: 17–27% DER** with an open model. Earnings21 is ⚠️ not published in pyannote's table.

**Mac reality check on pyannote**: it runs on CPU by default; `pipeline.to(torch.device("mps"))` is reachable but has **known correctness bugs** — garbled/wrong timestamps on M1 (issue #1337), silent CPU fallback (#1091), and the 3.0-era `onnxruntime-gpu` dependency broke Mac installs entirely (#1505, fixed in 3.1 by moving to pure PyTorch). **Treat pyannote on Mac as CPU-only.** No official Apple Silicon RTF numbers exist; only H100 figures are published (community-1: 31 s per audio-hour; precision-2: 14 s). The HF gate is a real friction point for a self-hosted app: both 3.1 and community-1 require accepting conditions and supplying a token before download, so you cannot bundle a one-click install without either vendoring the weights (check the licence — CC-BY-4.0 for community-1 permits it with attribution; 3.1's MIT weights likewise) or making the user paste a token.

**sherpa-onnx is the right answer for an Electron app.** `pyannote-segmentation-3.0` exported to ONNX (**5.7 MB fp32 / 1.5 MB int8**) plus a swappable embedding extractor, no Python, no PyTorch, no HF token at runtime. **Measured single-thread CPU RTF on macOS**, from the official docs, on a 4-speaker Mandarin file:

| Segmentation | Embedding | RTF |
|---|---|---|
| pyannote-3.0 fp32 | 3D-Speaker ERes2Net | 0.297 |
| pyannote-3.0 int8 | 3D-Speaker ERes2Net | 0.241 |
| pyannote-3.0 fp32 | **NeMo TitaNet-small** | **0.119** |
| pyannote-3.0 int8 | **NeMo TitaNet-small** | **0.110** |
| reverb-diarization-v1 fp32 | 3D-Speaker | 0.452 |
| reverb-diarization-v1 fp32 | NeMo TitaNet | 0.202 |

These are single-threaded; multi-core Apple Silicon is faster still. **Shipping precedent**: OpenWhispr built exactly this (pyannote-segmentation-3.0 + CAM++ embeddings) and reports **~45 MB total model footprint, ~100 ms per embedding, and ~30 seconds to batch-diarize a 45-minute meeting on an M1** — CPU-only via `onnxruntime-node` spawned from the Electron main process. They explicitly evaluated and rejected pyannote-Python (PyTorch too heavy to bundle), NeMo MSDD (no ONNX export, GPU-centric), Picovoice Falcon (commercial per-seat), and Apple CoreML Speech. ⚠️ Vendor blog, but consistent with sherpa-onnx's own benchmarks.

**Everything else:**

| Option | Mac verdict |
|---|---|
| **WhisperX** | Alive (PRs merged Jan 2026, issues Apr 2026) but **CUDA-first**; on Mac it's float32-CPU-only (CTranslate2 has no MPS; wav2vec2 alignment has fp16/MPS issues). large-v3 fp32 CPU ≈ 10 GB RAM. Fine as a batch tool, wrong foundation for a snappy Mac app. |
| **NVIDIA NeMo** (MSDD / Sortformer / streaming Sortformer) | **Non-starter — CUDA is not available on macOS at all.** Streaming Sortformer (2025) is architecturally impressive (17-layer NEST/FastConformer encoder + 18-layer Transformer, Arrival-Order Speaker Cache, real-time frame-level tagging) but ⚠️ head-to-head DER numbers not located. |
| **diart** (streaming) | 500 ms rolling buffer; **165 ms/step on a 20-core Intel CPU**, 50 ms on a V100; latency tunable **500 ms – 5 s**, and the paper explicitly shows larger latency window → lower DER. |
| **Reverb diarization** (Rev.ai) | v1 (pyannote-3.0 arch): **16.5% relative WDER improvement** over baseline pyannote-3.0; v2 (WavLM features): **22.25%**. Trained on 26,000 hrs expert-labelled. **Non-commercial licence** — fine for personal self-hosted use, not for anything you distribute. ONNX port exists in sherpa-onnx. |
| **Picovoice Falcon** (commercial, on-device) | Vendor-reported **10.3% DER / 19.9% JER** on VoxConverse vs pyannote's 9.0%/27.4% *in their own harness*; but **2 core-hours vs 442 core-hours per 100 audio-hours (221×)** and **0.1 GiB vs 1.5 GiB**. ⚠️ Their pyannote figure (9.0%) doesn't match pyannote's published 11.2% — different eval config. |
| 3D-Speaker / WeSpeaker / SpeechBrain | Embedding toolkits; WeSpeaker underlies pyannote community-1/precision-2 |
| `simple_diarizer` | ⚠️ No 2025/2026 activity — likely inactive |
| Cloud STT diarization add-ons | **11.1% (Amazon) to 50.2% (Google)** per Picovoice's survey — wide spread, often much worse than specialists |

⚠️ **Critical DER caveat**: pyannote publishes full DER (no collar, overlap scored — strictest). Vendor blogs often apply a 250 ms forgiveness collar and/or skip overlap, which shifts numbers by several points. **Cross-source DER comparisons are directional only.**

**Universal finding**: online/streaming diarization is *architecturally* worse than offline — offline sees the whole conversation before clustering, streaming must commit labels with only past context. Expect a several-point absolute DER gap. Run the hybrid that OpenWhispr runs: live labels for feedback during the meeting, full batch re-diarization when the call ends.

**Putting real names on speakers** — diarization gives you "Speaker 1/2/3"; naming them needs something else. Every shipping product converges on the same four mechanisms:
1. **Local voice profiles** — store a centroid embedding per named speaker (512-dim float32 from CAM++ ≈ **2 KB each**), cosine-match new segments, three-tier confidence: **≥0.70 auto-confirm, 0.55–0.70 suggest-and-confirm in the UI, <0.55 stays "Speaker N."** Running-mean centroid updates handle voice drift. In this repo those centroids go straight into a `speaker_profiles` table with a `vector(512)` column — pgvector is already installed.
2. **Calendar attendees** — if the meeting is linked to a calendar event and attendee count ≈ cluster count, offer one-click "Speaker 2 → alice@example.com." **This is exactly what Notion does** — it says it "uses context from non-audio sources (e.g. calendar event information) to label speakers," i.e. it is *not* doing voiceprint diarization at all. This is also why 3.1's event↔page link is a P1.
3. **LLM inference from transcript content** — people address each other by name ("Alice, can you send that over"). One academic use reported **87% agreement on member/role status and 74% exact last-name match** against 1,300 hand-labelled speakers. A complement, not a replacement — and cheap with the local Ollama model you already run.
4. **Always let the user correct and lock** an assignment so no later automated pass overwrites it.

**Recommendation.** Ship channel separation only, at P0. Add sherpa-onnx (pyannote-segmentation-3.0 int8 + NeMo TitaNet-small, RTF 0.110) as an **offline pass over the system channel only** at P2 — ~30 s for a 45-minute meeting, ~45 MB of models, no Python. Voice profiles are P2 on top of that. Skip streaming diarization entirely; the live label from the channel ("you" / "them") is already correct for the common case, and streaming clustering is measurably worse than the batch pass you're going to run anyway.

#### 3.3.4 Streaming partials into the editor

**The sidecar architecture.** This is the consensus pattern across every local-first product examined:

```
[mic]  ──AudioWorklet 16kHz PCM──┐
                                 ├──► local WebSocket (127.0.0.1) ──► ASR sidecar (native binary)
[system audio tap] ──PCM stdout──┘                                    │
                                                        JSON partials/finals
                                          Electron main ◄─────────────┘
                                                │
                                    IPC / SSE / WS to the Next.js renderer
                                                │
                              Tiptap transcript panel (replace-in-place)
                                                │
                              debounced writes ──► Supabase (segments table)
```

**Why a separate process rather than in-process inference?** OpenWhispr: *"Isolation. Native inference runtimes can crash — a bad allocation in an ONNX kernel shouldn't take the whole desktop app down. A sidecar means a crashed runtime is a reconnect, not a lost dictation. It also keeps native code out of Electron's main process entirely: the app talks protocol, the sidecar does math."* **This is the same pattern this repo already uses for Ollama on `http://127.0.0.1:11434`** — the sidecar is a second local service registered the same way, and `lib/llm/registry.ts` is the obvious precedent for how to resolve and configure it.

Concrete numbers from that shipping implementation: AudioWorklet captures 16 kHz PCM → float32 wire format → WebSocket to a locally-spawned sherpa-onnx **online** server binary → INT8 Nemotron 0.6B → JSON partials → preview renders by **replacing text in place**. One persistent connection per recording so the encoder cache carries context across chunks. Sub-second partial latency on laptop CPU.

**Next.js note.** Next.js 15 App Router still has no native WebSocket support (options are a custom `server.js`, a separate `ws` server, or Socket.IO) — **but you don't need any of them.** The transcript stream never has to traverse Next.js: sidecar → Electron main → IPC → renderer. Server actions only get involved at persistence time. If you want the browser-at-`:3000` dev flow to work too, an SSE route at `app/api/meetings/[id]/stream/route.ts` reading from the sidecar is the low-friction option and matches the existing `POST /api/ai/chat` pattern exactly.

**Chunking + VAD strategy.** Gate the stream with **Silero VAD** (whisper.cpp ships it; sherpa-onnx bundles it) at 150–250 ms chunks so you don't burn CPU on silence and don't feed Whisper silence, which is where it hallucinates. With a cache-aware streaming model, chunk size is the latency dial: Nemotron is configurable **80 ms – 1.12 s**; Voxtral's authors recommend **480 ms** and note 480–960 ms is the accuracy knee. With a pseudo-streaming whisper.cpp setup, use ~1.5 s windows and accept the boundary problems.

**Reconciling partial vs finalized hypotheses — LocalAgreement.** This is the one piece of real algorithmic subtlety. WhisperLiveKit's `HypothesisBuffer` is the cleanest reference — three token lists:

| List | Meaning |
|---|---|
| `committed_in_buffer` | Tokens validated through local agreement — **immutable, safe to persist** |
| `buffer` | Previous hypothesis |
| `new` | Current hypothesis |

**LocalAgreement-*n***: if *n* consecutive updates (each with a newly available audio chunk) agree on a prefix, that prefix is confirmed and the audio cursor moves to the end of the last token in the common prefix. `n=2` is standard. Two rendering rules that are easy to get wrong:

1. **Never append a revising hypothesis — replace it.** OpenWhispr: *"The chunked path appends text; a streaming hypothesis revises itself, so the UI replaces the whole preview per partial. Append a revising hypothesis and you get stuttering duplicates."* Practically: render committed text at normal weight, uncommitted tail in `--text-secondary`, and swap the tail wholesale on each partial.
2. **Text visibly settling is a feature, not a bug.** A cache-aware model resolves "their/there" using later audio and revises earlier words. Communicate that with the muted tail rather than hiding it.

**Flush-on-stop.** When recording stops, flush the model's tail and commit. Make the flush **truncation-aware**: extend the deadline while results are still arriving, and on a dropped connection or truncated result, discard the stream and re-decode the full recording with the batch model. OpenWhispr moved from always-two-passes to stream-as-source-of-truth with re-decode as fallback, halving per-recording CPU. **For a meeting note-taker the opposite default is correct**: keep the WAV, use the stream for live display only, and *always* run a high-quality batch pass (large-v3-turbo, `--dtw`, `--vad`) after the meeting. A 2-minute re-decode is free relative to hours of value, and it's the same pass in which you run offline diarization.

**Data model for transcript segments.** Flatten to the shape everyone uses — `{ speaker, start_ms, end_ms, text }`; Recall.ai's normalized format flattens participant + word arrays to exactly this before any grouping or summarizing.

**How this maps onto this project's `blocks` table.** `CLAUDE.md` is emphatic that `blocks` is the source of truth for editor content, one row per top-level ProseMirror node. **Transcript segments should nonetheless not be `blocks` rows**, and the reasoning is consistent with why that rule exists rather than an exception to it:

- A 1-hour meeting is **~600–1,200 segments**. That many block rows per meeting would swamp the block table and make the page unloadable.
- Segments are **append-only machine output**, not user-editable prose. They need none of what `blocks` buys you: fractional positions (`lib/positions.ts`), drag-and-drop reordering, or per-block AI edits.
- The **summary and action items absolutely should be blocks** — they *are* user-editable prose that the AI panel and RAG must see. That's the line: machine record in its own table, human-editable output in `blocks`.

Render the transcript as a single collapsible Tiptap node view (one `blocks` row of type `transcript`, holding just `recording_id`) that reads segments from the API. That preserves "one row per top-level node" while keeping the row count at one.

```sql
create table meeting_recordings (
  id uuid primary key,
  page_id uuid references pages(id) on delete cascade,
  started_at timestamptz, ended_at timestamptz,
  audio_path text,              -- local file, not in Postgres
  status text,                  -- recording|transcribing|diarizing|done|failed
  model text, language text
);

create table transcript_segments (
  id uuid primary key,
  recording_id uuid references meeting_recordings(id) on delete cascade,
  start_ms int not null, end_ms int not null,
  channel text not null,        -- 'mic' | 'system'  ← the free diarization
  speaker_label text,           -- 'you' | 'Speaker 2' | resolved name
  speaker_id uuid null,         -- FK to a voice-profile table once named
  text text not null,
  words jsonb null,             -- word-level timestamps from --dtw
  confidence real null,
  is_final boolean default true
);
create index on transcript_segments (recording_id, start_ms);
```

The `on delete cascade` chain matches the existing `blocks`/`chunks`/`links` pattern, so deleting the page cleans up the recording and its segments — consistent with "ingestion has no manual delete path." Remember the local-image `GRANT`s. **Store audio on disk, not in Postgres**; Notion's own answer is instructive — local audio storage opt-in, off by default, keeping only the **10 most recent** recordings.

Transcripts are ideal RAG material: feed the final merged transcript through the existing heading-aware chunker in `lib/rag/` with meeting title + date as the breadcrumb prefix, so meetings become searchable through `hybrid_search` alongside pages with no new retrieval code.

**Generating summary + action items with the local Ollama model.** Existing constraints apply verbatim: `lib/llm/registry.ts` resolves the chat provider, and **AI edits are propose-only** — the diff-overlay rule from `app/api/ai/edit/route.ts` extends to meeting summaries. Generate into a proposal, let the user Accept, then write blocks through the normal debounced save. Do not special-case this.

Chunking strategy for long transcripts:
- **Never split mid-utterance.** Use speaker-turn boundaries — a single speaker's contribution is the semantic unit.
- **Add overlap between chunks** so action items discussed across turns land in at least one chunk's context.
- Prefer semantic/topic-boundary chunking over fixed token counts where you can detect topic shifts.
- The common concrete recipe: **~15-minute segments**, summarize each, then a reduce pass over the per-chunk summaries.

| Strategy | When | Cost |
|---|---|---|
| **Stuffing** | Whole transcript fits the context window | 1 call |
| **Map-reduce** | Doesn't fit; chunks are independent | N + 1 calls, parallelizable |
| **Refine** | Doesn't fit; later context should revise earlier conclusions | N sequential calls, best quality, slowest |

**Context math**: a 1-hour meeting is ~8,000–10,000 words ≈ **11,000–14,000 tokens**, which fits a single pass for any modern local model with a 32K+ window. Stuffing is fine for typical meetings; map-reduce only past ~2 hours. Qwen 2.5 14B on 16 GB is cited as the local sweet spot for summarization (strong instruction-following, respects length constraints, 128K context). The default 8B model works but is exactly where `CLAUDE.md`'s hallucination-on-sparse-sources caveat applies; the mitigation is the same as the always-visible RAG sources list — **cite back into the transcript with timestamps**, which is precisely what Notion does (summary text links to transcript timestamps; hover previews, click jumps).

**Action item extraction** should be structured: owner, due date if specified, dependencies/prerequisites, current status. Force JSON output and render into a `taskList` node — `app/actions/meetings.ts` already has the `taskList(blockId)` builder, so the output shape is defined. Also worth copying from Notion: instruction presets (Auto / Sales / Stand-up / Team Meeting) plus user-defined custom instructions with a personal default. Cheap to build, high perceived value.

#### 3.3.5 Recommended build & phasing

Existing scaffolding in this repo: `app/actions/meetings.ts` (currently a **template generator** — builds a meeting-note page with headings, bullet lists, and task lists as ProseMirror nodes) and `components/sidebar/NewMeetingNoteButton.tsx`. There is no capture or transcription code. `desktop/electron/src/main.js` is the natural host for capture.

| Phase | Scope | Priority | Rough effort | Risk |
|---|---|---|---|---|
| **0. Code signing + entitlements** | Stable Apple Development signing identity (free cert, no notarization). Add `NSMicrophoneUsageDescription`, `NSAudioCaptureUsageDescription`, and the three entitlements. Verify prompts fire from a **packaged, signed `.app`**. | **P0** | **1 day** (budget 2) | **Highest.** Skipping this produces silent failures that look like code bugs. Do it before any capture code. |
| **1. Capture** | `electron-audio-loopback` (system) + `getUserMedia({audio:true})` (mic) → two `MediaStream`s. Pin Electron 31–38 or move to 39+ where it's built in. Write both channels to disk as separate 16 kHz mono WAVs immediately. Record/stop UI + menu-bar tray button. | **P0** | **2–3 days** | Medium — rides private Chromium flags that changed once at Electron 39. Keep `audiotee` bundled via `extraResources` as the escape hatch (<600 KB, same PCM output). |
| **2. Batch transcription + persistence** | On stop, decode both WAVs with whisper.cpp **large-v3-turbo** + `--dtw` + `--vad`. Merge channels by timestamp; mic = "you", system = "them". Write `meeting_recordings` + `transcript_segments`. Run in `after()` like the existing `ingestPage` call. Collapsible transcript node view with click-to-seek. | **P0** | **3–4 days** | Low. ~3–4 min per meeting-hour at 15–18× realtime. **Ship this before live transcription** — it's the whole product minus the flourish, and it de-risks everything downstream. |
| **3. Summary + action items** | Single-pass stuffing (~14K tokens fits any 32K model); chunk on speaker-turn boundaries with overlap only past ~2 hours. Structured JSON → existing `taskList()` / `bulletList()` builders. **Render as a propose-only diff overlay.** Cite back into transcript timestamps. ≥300-char guard + four instruction presets. | **P0** | **2–3 days** | Low. Reuses `lib/llm/registry.ts` and the existing diff-overlay machinery. |
| **4. RAG over transcripts** | Feed merged transcript through `lib/rag/` heading-aware chunker with meeting title + date as breadcrumb. | **P0** | **0.5 day** | Very low — existing pipeline, no new retrieval code. |
| **5. Live partials** | sherpa-onnx sidecar over local WebSocket (mirrors Ollama on `:11434`), Nemotron streaming 0.6B INT8, LocalAgreement-2 reconciliation, replace-in-place rendering with a muted uncommitted tail. Truncation-aware flush-on-stop; batch pass in Phase 2 remains source of truth. | **P1** | **3–5 days** | Medium — sherpa-onnx has an open Electron packaging issue (#1945); the WASM npm variant is the rebuild-free fallback. Cheaper alternative: whisper.cpp `small` + `--vad` at 1.5 s chunks, ~1 day, worse boundaries. |
| **6. Calendar integration** | Read-only Google Calendar (OAuth + `syncToken`) and/or CalDAV via `tsdav` into a local `events` table. Sidebar "Upcoming" strip, menu-bar tray with countdown, `Join and record` button ~15 min before the meeting, event↔page FK. | **P1** | **4–6 days** | Low, but the biggest scope-creep magnet in this section. **Read-only. No write-back.** |
| **7. Diarization** | sherpa-onnx pyannote-segmentation-3.0 int8 + NeMo TitaNet-small (RTF 0.110, ~45 MB models), **offline pass over the system channel only**, batch after the meeting. | **P2** | **2–3 days** | Low compute risk (~30 s per 45 min on M1); moderate integration risk. Expect 17–27% DER on real meeting audio. |
| **8. Speaker naming** | Voice-profile centroids in a `vector(512)` pgvector column, three-tier confidence (≥0.70 / 0.55–0.70 / <0.55), calendar-attendee one-click assignment, LLM name inference from transcript content, user correct-and-lock. | **P2** | **2–3 days** | Low. Only worth it once Phase 7 exists and you actually attend group calls. |
| **9. macOS 26 Swift shortcut (evaluate, don't schedule)** | One Swift helper doing ScreenCaptureKit capture *and* `SpeechAnalyzer`/`SpeechTranscriber`. Zero model downloads, zero RAM management, ~2.2× faster than large-v3-turbo, native streaming and mid-stream language switching. [swift-scribe](https://github.com/FluidInference/swift-scribe) is a complete working example. | **P1 spike** | **1–2 days to prototype** | Collapses Phases 1, 2 and 5 into a single file *if* macOS 26 is acceptable. Spike it in week one; if it works, it changes the plan. |

**Total for a usable product (Phases 0–4): ~9–13 days.** That gets you recording, a high-quality timestamped two-channel transcript on the page, an AI summary with action items and timestamp citations, and meetings searchable through the existing RAG — i.e. everything Notion charges $20/user/mo for, minus live partials, running entirely offline.

**What to punt, explicitly:**
- **Two-way calendar write sync** — recurrence exceptions, ETags, invite RSVP. A fortnight of work you can replace with a browser tab.
- **Availability links, colleague free/busy overlay, meeting blocking** — all multi-user features, out of scope by the same logic as sharing/permissions.
- **Mobile capture** — Notion's own mobile mode is mic-only with unreliable labels; there's no mobile client here.
- **Streaming diarization** — architecturally worse than the batch pass you already run.
- **WhisperX / faster-whisper / anything CUDA-native** — wrong foundation on a Mac.
- **BlackHole or a bundled virtual audio driver** — obsolete since macOS 14.4; admin install friction for no benefit.
- **Per-app audio targeting** (record just Zoom) — only Core Audio process taps can do it, it requires a hand-written Swift helper, and system-wide capture with `excludesCurrentProcessAudio` is fine in practice.

**Honest risk register.** Phase 0 (code signing) is the most likely thing to burn a day and the least likely thing to be budgeted for. Phase 1's Chromium flags are private API that already broke once. The ScreenCaptureKit `captureMicrophone` corruption bug ([thread 805892](https://developer.apple.com/forums/thread/805892)) is open and unresolved, so test that path with real audio before depending on it. And the one genuinely unmeasured thing in this entire section is **how badly crosstalk and AEC degrade the two-channel split when the user isn't wearing headphones** — every practitioner asserts it's a problem, nobody has published numbers, and you will find out empirically.

**Sources:**

*System audio capture*
- https://developer.apple.com/documentation/ScreenCaptureKit/capturing-screen-content-in-macos
- https://developer.apple.com/documentation/screencapturekit/scstreamoutputtype/microphone
- https://developer.apple.com/documentation/screencapturekit/scstreamconfiguration/excludescurrentprocessaudio
- https://developer.apple.com/videos/play/wwdc2022/10156/ (Meet ScreenCaptureKit)
- https://developer.apple.com/forums/thread/805892 (⚠️ open bug: corrupted output with `captureMicrophone`)
- https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps
- https://github.com/insidegui/AudioCap
- https://github.com/makeusabrew/audiotee · https://github.com/makeusabrew/audioteejs
- https://dgrlabs.co/blog/2026-04-25-capturing-system-audio-on-macos-in-2026.html
- https://existential.audio/blackhole/ · https://github.com/ExistentialAudio/BlackHole
- https://weblog.rogueamoeba.com/2026/01/15/rogue-amoebas-2026-status-report/
- https://alec.is/posts/bringing-system-audio-loopback-to-electron/
- https://github.com/alectrocute/electron-audio-loopback
- https://github.com/electron/electron/issues/47490 · https://github.com/electron/electron/pull/47493
- https://github.com/chrhartm/electron-mic-speaker-loop
- https://github.com/svtlabs/screencapturekit-rs · https://github.com/RustAudio/cpal/issues/876
- https://github.com/karaggeorge/mac-screen-capture-permissions · https://github.com/Streampunk/naudiodon
- https://github.com/sparticleinc/mac-audio-capture · https://github.com/divyanshunegi/ElectronCaptureKit
- https://www.recall.ai/product/desktop-recording-sdk · https://docs.recall.ai/docs/desktop-sdk

*Permissions / code signing*
- https://developer.apple.com/documentation/bundleresources/information-property-list/nsaudiocaptureusagedescription
- https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/
- https://www.electronjs.org/docs/latest/api/system-preferences
- https://developer.apple.com/forums/thread/795739
- https://stronglytyped.uk/articles/packaging-shipping-electron-apps-audiotee

*ASR*
- https://github.com/SYSTRAN/faster-whisper/issues/515
- https://developer.apple.com/videos/play/wwdc2025/277/
- https://www.macstories.net/stories/hands-on-how-apples-new-speech-apis-outpace-whisper-for-lightning-fast-transcription/
- https://daringfireball.net/linked/2025/06/19/apples-new-foundation-model-speech-apis-outpace-whisper-for-transcription
- https://www.argmaxinc.com/blog/apple-and-argmax · https://developer.apple.com/forums/thread/819555
- https://github.com/FluidInference/swift-scribe
- https://mundwerkapp.de/en/blog/whisper-benchmark-m3-ultra/ (raw data: `mundwerk-app/whisper-metal-benchmark`, CC BY 4.0)
- https://justvoice.ai/blog/whisper-benchmark-apple-silicon-m3-m4 (⚠️ "illustrative ranges")
- https://huggingface.co/spaces/argmaxinc/whisperkit-benchmarks · https://github.com/argmaxinc/argmax-oss-swift/blob/main/BENCHMARKS.md
- https://github.com/senstella/parakeet-mlx · https://github.com/mustafaaljadery/lightning-whisper-mlx (⚠️ vendor self-report)
- https://github.com/ggml-org/whisper.cpp/issues/89 · https://github.com/ggml-org/whisper.cpp/issues/3003
- https://www.marktechpost.com/2026/07/23/best-open-speech-recognition-asr-models-in-2026-wer-languages-latency-and-license-compared/
- https://huggingface.co/blog/open-asr-leaderboard · https://arxiv.org/abs/2510.06961
- https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b · https://arxiv.org/html/2509.02523v1
- https://kyutai.org/stt/ · https://mistral.ai/news/voxtral/
- https://github.com/ufal/whisper_streaming · https://arxiv.org/html/2307.14743
- https://deepwiki.com/QuentinFuxa/WhisperLiveKit/3.2-localagreement-backend · https://github.com/collabora/WhisperLive
- https://openwhispr.com/blog/local-streaming-speech-to-text
- https://gist.github.com/hollance/42e32852f24243b748ae6bc1f985b13a (alignment heads)
- https://picovoice.ai/blog/best-voice-activity-detection-vad/

*Diarization*
- https://openwhispr.com/blog/local-speaker-diarization
- https://github.com/pyannote/pyannote-audio · https://huggingface.co/pyannote/speaker-diarization-community-1 · https://www.pyannote.ai/blog/community-1
- https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html
- https://github.com/k2-fsa/sherpa-onnx/issues/1945
- https://github.com/akashmjn/tinydiarize · https://github.com/ggml-org/whisper.cpp/pull/1058 · https://github.com/ggml-org/whisper.cpp/issues/1395
- https://github.com/m-bain/whisperx · https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2
- https://github.com/juanmc2005/diart · https://arxiv.org/pdf/2109.06483
- https://github.com/revdotcom/reverb · https://arxiv.org/pdf/2410.03930
- https://picovoice.ai/blog/state-of-speaker-diarization/ · https://picovoice.ai/cookbook/speaker-identification-across-meetings/
- https://github.com/modelscope/3D-Speaker · https://arxiv.org/pdf/2604.21202

*Pipeline, summarization, prior art*
- https://www.recall.ai/blog/how-to-build-a-meeting-notetaker
- https://galileo.ai/blog/llm-summarization-strategies · https://www.gladia.io/blog/transcript-to-actionable-notes-llm
- https://medium.com/@sonimegha1602/scaling-document-summarization-with-llms-stuffing-map-reduce-and-refine-a8a468d479c3
- https://insiderllm.com/guides/best-local-llms-summarization/
- https://github.com/Zackriya-Solutions/meetily · https://github.com/fastrepl/anarlog · https://github.com/OpenWhispr/openwhispr
- https://github.com/thepersonalaicompany/amurex · https://thewh1teagle.github.io/vibe/

*Notion*
- https://www.notion.com/help/ai-meeting-notes · https://www.notion.com/help/guides/preserve-perfect-meeting-memory-with-ai-meeting-notes
- https://www.notion.com/releases/2025-05-13 · https://www.notion.com/releases/2025-09-18 · https://www.notion.com/blog/introducing-notion-3-0
- https://www.notion.com/pricing
- https://www.notion.com/help/category/notion-calendar · https://www.notion.com/help/notion-calendar-keyboard-shortcuts
- https://www.notion.com/help/notion-calendar-settings · https://www.notion.com/help/notion-calendar-connections
- https://www.notion.com/help/use-notion-calendar-with-notion · https://www.notion.com/help/availability-blocking-and-time-zones
- https://www.notion.com/help/guides/getting-started-with-notion-calendar · https://www.notion.com/help/calendars

---


## 4. Formulas 2.0

Notion rewrote its formula language in late 2023. Formulas 2.0 is a small, statically-ish typed functional expression language with first-class **lists**, local **variables** (`let`/`lets`), **lambdas** passed to list functions, and **rich-text output** via `style()`. It is genuinely well-designed and it is also the most disproportionate build cost in this document.

**Honest verdict up front:** implementing Formulas 2.0 properly is a **parser + type checker + evaluator + autocomplete-with-inline-docs editor**, i.e. 1–2 weeks. A solo user's real formula usage is overwhelmingly: `prop("A") + prop("B")`, `if(x, y, z)`, `dateBetween(now(), prop("Due"), "days")`, `format()`, string concatenation, and `prop("Rollup")` arithmetic. **Recommendation: build a deliberately small language (≈40 functions, no lambdas, no rich text) in ~2 days, with a clear "not supported" error, and revisit only if you actually hit the ceiling.** Alternatively, embed an existing sandboxed expression evaluator (`expr-eval`, `jsonata`, or a locked-down QuickJS via `quickjs-emscripten`) and expose Notion-ish helper functions — that gets you 90% for ~1 day, at the cost of syntax that doesn't match Notion's (which matters only if you import Notion formulas verbatim).

### 4.1 Type system

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Types** | `String`, `Number`, `Boolean`, `Date`, `Date range` (2024+), `Person`, `Page` (a database row reference), `List` (of any type, incl. lists of pages), and `empty`/null. Every expression has a type; the editor shows the result type live and refuses type errors before you save. | **P1** | A tagged union in TS. Type-check at parse time so the property can store a validated AST plus its result type (needed so *other* views can filter/sort/group by the formula with the right operators). Difficulty: medium. |
| **Property access** | `prop("Name")` — and 2.0 added the ability to type `Name` directly after selecting from autocomplete, which inserts a **stable property-id reference** so renames don't break formulas. | **P1** | Store the AST with property **ids**, render names at display time. This is the same rename-safety trick as §1.0. Do it. |
| **Automatic type coercion + errors** | Numbers coerce to strings in `+` only when one side is a string; otherwise type mismatch is a hard error with an inline red message and a doc link. | **P1** | Good errors matter more than function count. Return `{error, position}` and render a squiggle. |
| **`empty` handling** | Distinguishes empty from 0/""/false; `empty()` tests it; most functions propagate empty rather than throwing. | **P1** | Decide the null-propagation rule once and apply it uniformly. |
| **Dot notation / method chaining** | `prop("Tags").length()`, `x.format()`, `list.map(current * 2).sum()` — every function is callable as a method on its first argument. | **P2** | Sugar over the same AST; ~2 hours in the parser, and it's what makes 2.0 readable. |

### 4.2 Functions by category

| Category | Functions | Priority | Notes |
| --- | --- | --- | --- |
| **Logic / control** | `if`, `ifs` (multi-branch), `and`, `or`, `not`, `equal`/`==`, `unequal`/`!=`, `>`,`<`,`>=`,`<=`, `empty`, `match` (regex test) | **P0** | The 20% that does 80%. `ifs()` alone removes most nested-`if` pain. |
| **Arithmetic** | `add`,`subtract`,`multiply`,`divide`,`pow`,`mod`,`unaryMinus`, `abs`, `ceil`, `floor`, `round`, `sqrt`, `cbrt`, `exp`, `ln`, `log10`, `log2`, `sign`, `max`, `min`, `mean`, `median`, `sum`, `product`, `toNumber` | **P0** | Trivial to implement. |
| **String** | `concat`, `join`, `length`, `substring` (replaced 1.0's `slice`), `contains`, `test`/`match`, `replace`, `replaceAll`, `lower`, `upper`, `repeat`, `padStart`, `padEnd`, `split`, `format`, `toNumber`, `parseNumber` | **P0** | `format()` (any → string) and `split()`/`join()` are the workhorses. |
| **Date** | `now`, `today`, `date`, `dateAdd(date, n, unit)`, `dateSubtract`, `dateBetween(a, b, unit)` (units: `"years","quarters","months","weeks","days","hours","minutes","seconds","milliseconds"`), `dateRange(start,end)`, `dateStart`, `dateEnd`, `formatDate` (Moment-style tokens), `parseDate`, `timestamp`, `fromTimestamp`, `year`,`month`,`date`,`day`,`hour`,`minute`,`week`, `minDate`, `maxDate` | **P0** | `dateBetween(now(), prop("Due"), "days")` is *the* most-used real formula. Use `date-fns` + Temporal-ish semantics; be careful with timezones and all-day dates. |
| **List** | `length`, `at`, `first`, `last`, `slice`, `concat`, `includes`, `find`, `findIndex`, `filter`, `map`, `some`, `every`, `sort`, `reverse`, `unique`, `flat`, `join`, `split`, `sum`,`product`,`mean`,`median`,`min`,`max`, `let`-scoped `current`/`index` | **P1** | This is what makes rollups powerful (`prop("Tasks").filter(current.Status == "Done").length()`). Real but advanced. |
| **Bindings / lambdas** | `let(name, value, expr)`, `lets(n1, v1, n2, v2, …, expr)` for multiple bindings; list functions take an expression with implicit `current` and `index` variables (Notion's lambda-lite — you don't write `x =>`, you just use `current`). | **P2** | Elegant but only power users touch it. Implement `let` (easy, big readability win); implement `current`/`index` when you implement list functions. |
| **Page / relation** | Rollups returning "Show original" give a **list of pages**; you can then do `prop("Tasks").map(current.Name)` or `current.prop("Due")`. Also `id()`, `link()`. | **P2** | Requires the evaluator to be able to lazily fetch related pages — a resolver callback, not a data structure. Difficulty: medium. |
| **Styling / rich text** | `style(value, ...styles)` where styles are `"b","i","u","c"` (code), `"s"` (strike), colors `"gray","brown","orange","yellow","green","blue","purple","pink","red"` and backgrounds `"gray_background"`… ; `unstyle()`; `link(label, url)`. Output renders as rich text in the cell. | **P2** | Very Notion. Needed if you want progress bars made of emoji, colored status pills, etc. Requires formula output to be a rich-text fragment, not a string — a real design decision. Difficulty: medium. |
| **Misc** | `toNumber`, `format`, `id`, `me`, `email`, `name`, `ifs`, `emptyList` | **P2/P3** | `me`/`email`/`name` are P3 (single user). |

### 4.3 Editor experience

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Formula editor modal** | Multi-line, monospaced, syntax-highlighted; **live result preview** on the current row; a searchable function list with descriptions + examples in the right pane; property list at the top; inline error with position. Resizable. `Cmd+Enter` to save. | **P1** | CodeMirror 6 with a tiny custom language + autocomplete source. **The live preview on a sample row is what makes formulas learnable** — build it, it's ~1 hour once the evaluator exists. Difficulty: medium. |
| **Formula results usable everywhere** | Formula output can be filtered, sorted, grouped by, rolled up, used in conditional color, and shown on cards — typed according to its result type. | **P1** | Consequence of type-checking at save time. If you skip typing, formulas become second-class and half their value evaporates. |
| **Performance** | Notion evaluates formulas client-side per visible row. | **P1** | Do the same — evaluate in the browser over the rows you fetched. **Do not try to compile formulas to SQL**; you'll spend a week and still need the JS evaluator. For *sorting/filtering by* a formula, either compute-then-sort in JS (fine at solo scale) or maintain a materialized `formula_cache` column updated on write. |

**Sources for §4:** [Formulas 2.0 — what changed](https://www.notion.com/help/guides/new-formulas-whats-changed) · [Notion formula function docs (T. Frank)](https://thomasjfrank.com/formulas/functions/) · [Formula cheat sheet 2026](https://thomasjfrank.com/notion-formula-cheat-sheet/) · [Notion VIP: Formulas 2.0 definitive intro](https://www.notion.vip/insights/notion-formulas-2-0-the-definitive-introduction) · [Notion Mastery: everything new in 2.0](https://notionmastery.com/everything-new-in-notion-formulas-2-0/)

---

## 5. Workspace & navigation

This is where "it's a notes app" becomes "it's my second brain". Most items here are cheap; a few (search, history) are the difference between trusting the app and not.

### 5.1 Sidebar & page tree

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Sidebar sections** | Fixed order: search/home/inbox at top, then **Favorites**, **Teamspaces**, **Shared**, **Private**, then **Templates / Trash / Help / Settings / New page** pinned at the bottom. Sections collapse; the sidebar resizes by drag and can be pinned or set to hover-reveal (`Cmd+\` toggles). | **P0** (structure) / **P3** (Teamspaces, Shared) | You already have Spaces + Favorites + Recents. Map: Teamspaces → your Spaces, Private → everything, Shared → delete. `Cmd+\` and drag-resize: ~1 hour each, constantly used. |
| **Page tree** | Infinitely nested; expand/collapse arrows on hover (the arrow replaces the page icon); **drag to reparent or reorder** with insertion-line feedback and auto-expand-on-hover during a drag; right-click/`•••` gives the full page menu; lazy-loads children. | **P0** | Fractional indexing + `parent_page_id`. **Drag-to-reparent with auto-expand is the fiddliest 1–2 days in the shell but it's the primary organizing gesture.** Use `dnd-kit`. |
| **Favorites** | Star a page → it appears in a Favorites section (independently reorderable, and a page can be favorited without moving). | **P0** | Already present in this repo. A `favorites(page_id, position)` table. Trivial. |
| **Recents** | A "Recently visited" list (Notion shows it in search and in the sidebar on mobile/desktop). | **P0** | `page_visits(page_id, visited_at)`, `SELECT DISTINCT ON`. Trivial, high value. |
| **Trash** | Deleted pages go to Trash, recoverable indefinitely (Notion: forever on paid, and permanently deletable). Trash is searchable, shows the original parent, supports Restore and Delete permanently, and "Delete all". Deleting a parent trashes children. | **P0** | `pages.deleted_at` soft delete + a filtered view. **Do this before you delete anything for real.** Restore must restore the subtree and re-link the parent (or drop to root if the parent is gone). Difficulty: low-medium. |
| **New page button / `Cmd+N`** | Creates an untitled page in Private (or the current context); `Cmd+Shift+N` opens a new window. | **P0** | Trivial. |
| **Sidebar search entry + `Cmd+P`/`Cmd+K`** | See below. | **P0** | — |

### 5.2 Search & navigation

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Quick Find (`Cmd+P` / `Cmd+K`)** | Instant modal. Shows recent pages when empty; as you type, fuzzy-matches page **titles** first, then full-text body matches with a highlighted snippet. Results are ranked by title match > recency > frequency. `↑/↓` + `Enter`; `Cmd+Enter` opens in a new tab; `Shift+Enter` in a split. Also offers "Create page 'X'". | **P0** | **This is the single highest-value navigation feature.** Postgres: a `tsvector` GIN index on title+body plus a trigram index on title, blended with a recency decay. Target <50 ms. Difficulty: medium; payoff enormous. |
| **Full search page / filters** | A dedicated search view with filters: in a specific teamspace/page, created-by, date-edited, "only search titles", sort by relevance/last-edited, and (2025) AI-powered semantic search across the workspace + connected apps. | **P1** | Your `hybrid_search` RPC already does FTS+vector RRF — surface it as the "search everything" page. Filters are a day. |
| **Search ranking specifics** | Notion boosts: exact title match, pages you edited recently, pages you visit often, and pages higher in the tree. Deprioritizes trashed and template pages. | **P1** | Encode as a weighted score: `0.5*title_sim + 0.2*recency + 0.2*visit_count + 0.1*fts_rank`. Tune once, then leave it. Cheap, and it's what makes search *feel* smart. |
| **Tabs** | Desktop app has browser-style tabs: `Cmd+T` new, `Cmd+W` close, `Cmd+Shift+T` reopen closed, `Cmd+1..9` jump, `Ctrl+Tab` cycle, drag to reorder, drag out to a new window, middle-click to close, pinned tabs, tab history (`Cmd+[` / `Cmd+]` back/forward). | **P0** | Already built in this repo (`components/tabs/`). Verify the full shortcut set is wired — the missing ones are each ~10 minutes and each is a daily annoyance. |
| **Split view** | Drag a tab to the side, or `Cmd+Shift+\`-ish, to show two pages side by side; each pane has its own tab strip and history. | **P2** | Real work. A two-pane layout with independent tab stores. Worth it if you regularly write against a reference doc. Difficulty: medium-high. |
| **Peek modal (side/center)** | Clicking a database row or a page link with a modifier opens a peek instead of navigating; `Esc` closes; "Open as full page" promotes it. Peeks are URL-addressable. | **P0** | Covered in §1.3. |
| **Breadcrumbs** | Top-of-page ancestor chain, each segment clickable, collapsing to `…` when deep, with the current page's icon+title as the last segment (also editable inline). | **P0** | Recursive CTE up the tree. ~2 hours. |
| **Back / forward** | `Cmd+[` / `Cmd+]`, plus mouse buttons and swipe. | **P0** | Per-tab history stack. Trivial; badly missed when absent. |
| **`Cmd+Shift+K` / `Cmd+Shift+J` page switcher, `Ctrl+Shift+U` go to parent** | Jump between recent pages and up the hierarchy. | **P2** | 30 minutes each. |

### 5.3 Page-level features

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Page icon** | Emoji picker (searchable, skin-tone, recents), Notion's own icon library (~5000 line/solid icons in 10 colors), custom image upload, or image URL. Icons appear in the sidebar, breadcrumbs, mentions, tabs, and database rows. "Random" button. | **P0** | `emoji-mart` + an upload path. **Icons are the cheapest way to make the app feel finished.** Difficulty: low. |
| **Page cover** | Full-width header image: upload, URL, Unsplash search, or Notion gallery; **repositionable** by drag; removable; randomizable. | **P1** | Upload + a `object-position` drag. ~half a day. |
| **Full width toggle** | Page content stretches to the window width instead of the ~900 px column. Per page, persisted. | **P1** | A boolean + CSS. 15 minutes. Heavily used for database pages. |
| **Small text toggle** | Shrinks body font ~1 step. Per page. | **P2** | 15 minutes. |
| **Font family** | Default (Inter-ish), Serif (Lyon), Mono. Per page. | **P2** | 30 minutes. Serif for long-form writing is a genuinely nice touch. |
| **Lock page** | Prevents accidental edits; `•••` → Lock page; shows a lock badge; unlock is one click. | **P1** | A boolean that makes the editor read-only. 30 minutes, prevents real damage. |
| **Page history / version restore** | Every page keeps snapshots (Free: 7 days; Plus: 30; Business: 90; Enterprise: unlimited). The history panel lists timestamped versions with authors, previews the version, and restores it. There's also a separate **block-level** "Restore" of deleted blocks via undo. | **P0** | **Non-negotiable for trust.** Cheapest correct design: on every debounced save, if >N minutes since the last snapshot, write the full page's block JSON to `page_versions(page_id, created_at, snapshot jsonb)`; prune with a tiered policy (all versions for 24 h, hourly for a week, daily forever). Compressed JSON of a typical page is a few KB — keep them forever, disk is free. Difficulty: low-medium. Diff view: P2. |
| **Duplicate page** | Deep-copies the page and subtree; "Duplicate with content" for databases. | **P0** | Recursive insert. Half a day (relation rewriting is the fiddly part). |
| **Move to** | `Cmd+Shift+P` opens a page picker to reparent. | **P0** | Reuses the quick-find component. ~1 hour. |
| **Comments / discussions** | Page-level comment thread at the top, inline comments anchored to text, `Cmd+Shift+M`, resolve, "show resolved comments", suggestion-mode edits (2025). | **P2 as annotations** | See §2.2. Suggestion mode is P3 (it's a review workflow). |
| **Reminders & notifications** | `@remind`, date-property reminders, and an **Inbox** aggregating mentions, comment replies, reminders, invites, and automation results, with unread badges, per-page "Follow/Unfollow", and desktop/mobile push + email digests. | **P1** (reminders) / **P3** (the social half) | Reminders solo = a `reminders(page_id, block_id, fire_at, fired)` table + a poller in the Electron main process + `new Notification()`. **This is ~half a day and turns the app into something you can trust with a deadline.** The mention/comment inbox is P3. |
| **Templates** | Workspace template picker, the public Template Gallery, "Duplicate to workspace", and per-database templates (§1.3). | **P1** (your own) / **P3** (gallery) | "Save this page as a template" + a template picker on new-page = half a day. |
| **Export** | Per page or whole workspace: **Markdown & CSV**, **HTML**, **PDF** (paid, with page-size/scale options), with "include subpages" and "create folders for subpages". Workspace export is a zip; Notion also offers an "Export all workspace content" admin action. | **P1** | Markdown+CSV export with subfolders is the **self-hosting insurance policy**. ~1 day. PDF via headless Chromium print. **Build the exporter early** — it also gives you a free backup story, which this repo badly needs (see the CLAUDE.md incident). |
| **Import** | Importers for Evernote, Word/Google Docs, Confluence, Trello, Asana, Monday, Quip, Dropbox Paper, HTML, Text & Markdown, CSV, and **Notion's own Markdown/CSV zip**. | **P1 for the Notion zip only** | If the user is migrating off Notion, a Markdown+CSV zip importer that recreates the page tree and databases is the *entry ticket*. ~1–2 days and worth every hour. Everything else: P3. |
| **Offline mode** | Since 2024 the desktop/mobile apps cache recently-viewed pages, allow editing offline, and sync on reconnect (with conflict resolution). Still imperfect; a top Reddit complaint. | **P0 by construction** | Your data is on localhost. You are *always* offline-capable. This is a genuine differentiator — lean into it (see §7's performance bar). |
| **Web clipper** | Browser extension that saves a page (readable content + URL + optional highlights) into a chosen database, with property prefill. | **P2** | A small Chrome/Safari extension POSTing to a local endpoint + `@mozilla/readability` for article extraction. ~1 day. High value if the user does research. |
| **Public sharing / Notion Sites / permissions / guests** | Publish to web with custom domains, SEO, analytics; granular page permissions; guests; groups. | **P3** | Skip entirely. This is a huge fraction of Notion's codebase and zero of a solo user's value. |

### 5.4 Automations, forms, dashboards

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Database automations** | Per-database rules: **triggers** = page added, property edited (any or a specific property/value), and (2024+) a **scheduled/recurring** trigger (every day/week/month at a time). Multiple triggers with "when any" or "when all". **Actions** = add page to a database, edit properties of the triggering page or a related page, send a Slack/Teams message, send an email, and (2025) *run an AI prompt* / *invoke an agent*. Paid plans only. | **P2** | For one user the killer cases are narrow but real: "when Status → Done, set Completed date = now", "every Monday create this week's log page". Implement as `automations(database_id, trigger jsonb, actions jsonb)` evaluated in the server action that writes properties (synchronous, in-transaction) plus a cron for scheduled ones. **Difficulty: medium for the engine (1 day), high for the visual builder (2+ days).** Ship with a JSON/one-line config or 3 hardcoded recipes before building a builder. [src](https://www.notion.com/help/database-automations) |
| **Button actions** | The action vocabulary shared by button blocks and button properties: Insert blocks, Add page to database (with property prefill and template), Edit pages in a database, Open a page (side peek/center/full), Show confirmation dialog, Duplicate a page, and Run AI. | **P2** | Same engine as automations. The confirmation-dialog action is a nice touch. |
| **Forms** | Database view that renders a form; per-question type mapping, required, description, prefilled values from URL params, multi-page forms, logo/cover/theme, confirmation message or redirect, close-after-N-responses, response count in a view. | **P3 (public) / P2 (quick-capture)** | Build a **local quick-capture modal** instead (global hotkey → 3 fields → new row → close). That's the actual solo use case and it's a few hours. |
| **Charts / dashboards** | Chart views (bar/line/donut) plus the ability to compose a dashboard page from linked views, charts, and callouts; "Notion Dashboards" as a view type. | **P2** | Recharts + linked views. A "Today" dashboard (today's calendar, overdue tasks, recent pages, a chart) is one of the highest-satisfaction pages a solo user can have. ~1 day once views + charts exist. |
| **Connections / integrations** | Slack, GitHub, Google Drive, Jira, Figma, Zapier/Make, and the public API + MCP server. | **P3** | Skip. If you want automation, you already have a shell and a database — write a script. |
| **Notion Mail** | A separate Gmail-backed email client (2025) with AI labels, snippets, and scheduling. | **P3** | Out of scope. |
| **Notion Calendar** | See §3. | — | — |
| **Mobile app / widgets** | iOS/Android apps with home-screen widgets, share-sheet capture, and offline. | **P3, with one caveat** | A mobile app is out of scope. But **quick capture from the phone** is the one thing you'll miss. Cheapest answer: a responsive `/capture` route on the local server reachable over Tailscale — an afternoon, not a project. |

**Sources for §5:** [Database automations](https://www.notion.com/help/database-automations) · [Automations category](https://www.notion.com/help/category/automations) · [Sidebar navigation](https://www.notion.com/help/category/sidebar-navigation) · [Import & export](https://www.notion.com/help/category/import-export-and-integrate) · [Notion apps (desktop/web/mobile)](https://www.notion.com/help/category/notion-apps) · [Automations reference (T. Frank)](https://thomasjfrank.com/notion-database-automations-the-complete-guide/)

---

## 6. AI features

Notion's 2026 AI story has five pillars: **AI writing**, **Research Mode**, **AI Meeting Notes**, **Enterprise Search**, and **Agents** (Notion 3.0, Sept 2025; Custom Agents GA 2026). This repo already has the hard parts — a provider registry, a RAG pipeline over a `chunks` table, `hybrid_search`, and a propose-only edit path — so this section is mostly about *surfacing* rather than *building*.

**The rule this project already got right, restated because it's the most important AI decision:** AI never writes to the database without an explicit user Accept. Notion violates this in places (autofill, agents) and users complain loudly about surprise edits. Keep the diff overlay.

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **AI writing in-editor (`Space` on empty block / `Cmd+J`)** | Continue writing, summarize, improve writing, fix spelling & grammar, make longer/shorter, change tone (professional/casual/straightforward/confident/friendly), simplify language, explain, translate (~15 languages), and "Ask AI anything" with the page as context. Output appears as a preview with **Accept / Try again / Discard / Replace selection / Insert below**. | **P0** | Already largely built here (`app/api/ai/edit`, the AI panel). What's missing from most clones is the **command set** — 12 named commands beat one free-text box because they remove the "what do I even ask" tax. Difficulty: low, given existing infra. |
| **Workspace Q&A / AI search** | Ask a natural-language question; Notion retrieves across the workspace (and connected apps) and answers with **inline citations** linking to the source pages, plus a persistent sources list. | **P0** | This is the repo's existing `POST /api/ai/chat` + `hybrid_search`. Keep the always-visible sources list — it's the correct mitigation for an 8B local model, as CLAUDE.md notes. |
| **AI blocks (`/ai`)** | Persistent blocks that generate and *store* output: Summary, Action items, Custom AI block (your own prompt), Translate. Each has a manual "Update"/refresh; they don't auto-rerun. | **P1** | A block whose `content` holds `{prompt, model, output_blocks, generated_at}`. Render output as normal blocks so it's editable and searchable. Difficulty: low. |
| **AI autofill of database properties** | Define an AI-filled property (text/select/multi-select/number/date/checkbox) with a prompt; Notion fills it for every row from the row's page content and other properties, and (April 2026) auto-fills future rows via Custom Agents. Has a "fill all"/"fill empty" control and per-row refresh. | **P1** | **The single most useful AI database feature for one person** — auto-tagging, auto-summarizing meeting rows, extracting a due date from body text. Implement as a property type `ai_text`/`ai_select` with `{prompt, source_properties, auto_update: manual|on_create}`. Run through the propose-only path for bulk fills (show the table of proposed values, Accept all / per-row). Difficulty: medium (1–2 days). |
| **Summarize / action items / translate** | One-click over a page or selection; action items can be inserted as a to-do list. | **P0** | Three prompts + the existing edit route. Half a day. Wire "action items" to *create database rows* in a Tasks DB and it becomes a daily habit. |
| **AI Meeting Notes** | See §3. | **P0** | — |
| **Research Mode** | A deep-research toggle in AI search: reads Notion + connected apps + the web over several minutes, then produces a structured, cited report as a new page. Limited trial on Business, full on Enterprise. | **P2** | Locally this is "multi-step RAG + web fetch + a longer generation", which is achievable with a small agent loop over your existing retrieval + a fetch tool. Value depends on whether the user does research; the local 8B model will underperform badly here, so gate it behind a bigger model / API provider (the registry already supports swapping). Difficulty: medium. |
| **Agents (Notion 3.0) / Custom Agents** | Autonomous multi-step agents that can create docs, build databases, edit pages, search connected tools, and run for up to ~20 minutes; memory via an "instructions page" that teaches style and context; Custom Agents are trigger-based (schedule, email, Slack, database change, button) and metered in Notion Credits (~$10/1,000 credits, from May 2026). | **P2 (a narrow version)** / **P3 (the full platform)** | Do **not** build an agent platform. Do build **one** thing: a scheduled/triggered prompt that produces a *proposed* page or set of property edits for review — e.g. "every Friday, draft a weekly review from this week's edited pages". That's a cron + a prompt + the existing diff overlay, ~1 day, and it captures most of the practical value. The instructions-page idea is excellent and free: a `AI Instructions` page whose content is prepended to every system prompt. |
| **Enterprise Search** | Cross-tool search over Notion, Slack, GitHub, Drive, Jira, Salesforce, Box, OneDrive, Asana, Teams. | **P3** | Not applicable — with one honorable mention: indexing a **local folder** (e.g. `~/Documents`, or this repo's own `docs/`) into your `chunks` table is the solo analogue and is ~half a day given the existing ingestion pipeline. |
| **AI connectors / MCP** | Notion exposes an MCP server and consumes external MCP servers so agents can reach other tools. | **P3** | Skip. (Amusingly, exposing *your* clone over MCP so Claude Code can read/write your notes is a ~1-day P2 that might be more useful than anything Notion ships here.) |
| **AI model choice** | Notion routes to GPT/Claude models; Business+ users can pick. | **P1** | Already solved by `lib/llm/registry.ts`. Expose the picker in settings, separately for chat and embeddings, and warn on embedding-model change (forces re-embed + a `vector(N)` migration). |
| **Notion credits / usage limits** | Free plan gets limited AI trial; paid plans meter agent runs in credits. | **P3** | Local models are free. This is the whole point of the project — say it out loud in the README. |

**The honest assessment of AI here:** for a single user, the AI features that repay their build cost, in order, are (1) meeting transcription + summary, (2) ask-my-notes with citations, (3) AI autofill of database properties, (4) summarize/action-items on a page. Everything past that is demo material. Local 8B models will hallucinate on sparse retrieval — the always-visible source list, propose-only edits, and the ability to swap in a hosted model for hard tasks are the three mitigations that matter.

**Sources for §6:** [Introducing Notion 3.0](https://www.notion.com/blog/introducing-notion-3-0) · [Release notes 2025-09-18](https://www.notion.com/releases/2025-09-18) · [Notion AI product page](https://www.notion.com/product/ai) · [Agents](https://www.notion.com/product/agents) · [AI Meeting Notes](https://www.notion.com/product/ai-meeting-notes) · [Enterprise Search](https://www.notion.com/product/enterprise-search) · [Creating & editing with AI (autofill)](https://www.notion.com/help/creating-and-editing-with-ai) · [Notion AI review 2026 (eesel)](https://www.eesel.ai/blog/notion-ai-review)

---

## 7. UX details that make Notion feel like Notion

Notion's moat is not its feature list — competitors match it on paper. The moat is that **every gesture has an obvious, immediate, reversible response.** This section is the one most likely to be skipped and most likely to determine whether the clone gets used.

### 7.1 Keyboard shortcuts

Notion documents 120+. Grouped by priority; unlisted ones are P2/P3.

| Group | Shortcuts | Priority | Notes |
| --- | --- | --- | --- |
| **Essentials** | `Cmd+N` new page · `Cmd+Shift+N` new window · `Cmd+P`/`Cmd+K` quick find · `Cmd+[` / `Cmd+]` back/forward · `Cmd+\` toggle sidebar · `Cmd+Shift+L` toggle dark mode · `Cmd+,` settings · `Cmd+F` find on page · `Cmd+/` shortcut cheat-sheet | **P0** | ~1 line each with a central hotkey registry. Build the registry (a `useHotkeys` map with scopes) rather than scattering `keydown` handlers — retrofitting is miserable. |
| **Formatting** | `Cmd+B` bold · `Cmd+I` italic · `Cmd+U` underline · `Cmd+Shift+S` strikethrough · `Cmd+E` inline code · `Cmd+K` link (with text selected) · `Cmd+Shift+H` last-used highlight/color · `Cmd+Shift+E` inline equation · `Cmd+Shift+M` comment · `Cmd+Opt+0..9` turn into text/H1/H2/H3/todo/bulleted/numbered/toggle/code/page | **P0** | `Cmd+Opt+N` block-type switching is a power move most clones omit; it's a lookup table. |
| **Block / structure** | `Esc` select block · `Cmd+A` select block → all blocks → page · `Tab` / `Shift+Tab` indent/outdent · `Cmd+D` duplicate · `Cmd+Shift+↑/↓` move block up/down · `Cmd+Opt+T` expand/collapse all toggles · `Cmd+Enter` toggle checkbox / open page / toggle toggle (context-dependent) · `Backspace` delete selection · `Cmd+Shift+P` move to · `Opt+drag` duplicate by dragging | **P0** | `Cmd+Shift+↑/↓` to move a block is the single most-missed shortcut in clones. Trivial with fractional positions. |
| **Text editing** | `Cmd+Z`/`Cmd+Shift+Z` undo/redo · `Shift+Enter` soft line break inside a block · `Cmd+Shift+V` paste without formatting · `Opt+←/→` word-wise · `Cmd+←/→` line start/end | **P0** | Mostly free from the browser/ProseMirror; `Shift+Enter` needs explicit handling. |
| **Content creation** | `/` slash menu · `@` mention · `[[` page link · `+` create page inline · ````` ``` ```` code block · `$$` equation · markdown input rules (§2.2) | **P0** | — |
| **Tabs & windows** | `Cmd+T` new tab · `Cmd+W` close · `Cmd+Shift+T` reopen · `Cmd+1..9` jump · `Ctrl+Tab` cycle · `Cmd+Shift+\` split (approx.) | **P0** | Already in this repo — audit for gaps. |
| **Database** | `↑↓←→` cell nav · `Enter` edit cell · `Esc` exit · `Space` peek row · `Cmd+Enter` open row full page · `Shift+click` range select · `Cmd+C/V` on ranges · `Cmd+Opt+T` collapse groups | **P1** | The spreadsheet layer; see §1.3. |
| **Emoji / icons** | `Ctrl+Cmd+Space` (macOS system picker) · `:name:` inline emoji autocomplete | **P1** | `:shortcode:` autocomplete is ~2 hours and is used constantly. |

### 7.2 Interaction feel

| Feature | What Notion does | Priority | Implementation notes & difficulty |
| --- | --- | --- | --- |
| **Local-first instant feel** | Every mutation renders optimistically in <16 ms; the network call is invisible. Typing never blocks. Navigation between cached pages is instant; uncached pages show a skeleton, never a spinner-on-white. | **P0 — the single most important row in this document** | You have a structural advantage: Postgres on localhost. **The bar to hold yourself to: no user action may wait on a round-trip.** Concretely — optimistic local state for every write, `router.prefetch` on sidebar/search hover, a client-side page cache keyed by id, skeletons that match the final layout, and a hard rule that no interactive element shows a loading spinner for a local operation. If typing ever stutters, stop and fix it before adding features. |
| **Drag & drop** | Blocks, sidebar pages, database rows, board cards, columns, tabs, files-from-Finder, images-into-blocks, and text-selection dragging. Every drag shows a semi-transparent ghost of the dragged thing and a blue insertion line at the drop target; targets highlight; auto-scroll near edges; `Esc` cancels mid-drag. | **P0** | Use one library (`dnd-kit`) everywhere so the feel is uniform. Budget 2–3 days total across surfaces. **The blue insertion line and the ghost are not polish — they're the feedback that makes drop targets legible.** |
| **Hover affordances** | Handles and `+` buttons fade in (~100 ms) on row hover; database rows reveal `OPEN`; links show a preview card after ~500 ms; everything has a tooltip carrying its shortcut. | **P1** | CSS + one shared tooltip/hovercard. Cheap, and their absence reads as "unfinished". |
| **Block selection model** | `Esc` from text → block selected (blue overlay). Arrow keys move; `Shift+arrows` extend; drag over blocks rubber-bands; `Shift+click` extends; `Cmd+A` escalates text → block → all blocks. Selected blocks accept every block-menu operation at once. | **P0** | The hardest UX item (§2.2). 1–2 days. |
| **Undo semantics** | Typing coalesces into ~500 ms chunks; structural ops (move, delete, turn-into, indent) are single undo steps; undo works on multi-block operations; database property edits are undoable within the row's session. Undo does **not** cross page boundaries. | **P0** | ProseMirror history + explicit `chain().setMeta('addToHistory')` discipline on structural commands. **Test: type a paragraph, indent it, drag it, delete it — four `Cmd+Z` should walk back cleanly.** |
| **Peek modal** | Side peek slides in from the right with a spring; the underlying page stays interactive; `Esc` or click-outside closes; the URL updates so back works; "open as full page" arrow in the corner. | **P0** | ~half a day. Disproportionate perceived quality. |
| **Breadcrumbs** | Always present, always clickable, collapse with `…` when deep, show icons. | **P0** | ~2 hours. |
| **Icon / cover pickers** | Emoji tab (search, skin tone, frequently-used), Icons tab (~5000 Notion icons, searchable, 10 colors), Upload tab, Link tab, plus a `Random` button and `Remove`. Same picker used for pages, callouts, and database rows. | **P1** | One component, four places. `emoji-mart` + Lucide/Phosphor as the "icon library" tab. ~1 day; makes everything feel designed. |
| **Dark mode** | `Cmd+Shift+L`, or follow system. A genuinely designed dark palette (not inverted): dark gray `#191919` background, not black; the 10 block colors have separate dark variants. | **P0** | CSS variables from the start. **Define both palettes before you build components**, not after. |
| **Animation feel** | ~150–200 ms ease-out for menus/peeks; near-zero for block insertion (instant, no fade); toggles animate their arrow but reveal content instantly; hover states ~100 ms; drag ghost follows the cursor 1:1 with no lag. Notion deliberately does *not* animate content appearing — animation is for chrome only. | **P1** | **Copy this rule exactly: animate chrome, never content.** Animated content insertion feels slow and is the most common clone mistake. |
| **Typography & spacing** | ~16 px body, 1.5 line-height, ~900 px content column (or full-width), generous but not airy block spacing (~1 px gaps, ~3 px vertical padding), headings with tight top margins, and a consistent 24 px left gutter reserved for handles. | **P1** | Steal the metrics. Getting the left gutter right is what makes the drag handle feel like it belongs. |
| **Empty states** | Every empty surface says what to do: empty page ("Type '/' for commands"), empty database ("New page"), empty search ("Recently visited"), empty trash, empty favorites. | **P1** | A day total, and it's the difference between "broken" and "ready". |
| **Toasts & confirmations** | Destructive actions show an undo toast ("Page moved to trash · Undo") rather than a confirm dialog. Bulk/irreversible actions do get a dialog. | **P1** | Undo-toast-over-confirm-dialog is the right default and is ~2 hours with a toast library. |
| **Command palette discoverability** | `Cmd+/` opens a searchable shortcut reference; menus show their shortcuts inline; the slash menu shows aliases. | **P2** | Cheap; makes the app learnable without docs. |
| **Right-click everywhere** | Right-clicking a block, a sidebar page, a database row, a tab, or a card opens the relevant context menu. | **P1** | One `ContextMenu` primitive (Radix) wired to the same action definitions as the `•••` menus. Keeps behaviour identical across call sites — same discipline as this repo's `PageActionsMenu`. |

**Sources for §7:** [Keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts) · [120+ Notion shortcuts](https://vida.io/blog/notion-shortcuts) · [Writing & editing basics](https://www.notion.com/help/guides/writing-and-editing-basics) · [Notion review 2026 (eesel)](https://www.eesel.ai/blog/notion-review)

---

## 8. Verdict — what to build, in order

**Tier 0 — the app doesn't exist without these.** Block editor with slash menu, markdown input rules, drag handles, block selection, and undo · page tree with drag-reparent · `Cmd+P` quick find · tabs · trash + restore · page history snapshots · icons + dark mode · the instant-feel performance bar.

**Tier 1 — the reason to use it over a folder of Markdown files.** Databases: properties (title/text/number/select/multi-select/status/date/checkbox/url/relation/rollup/created-edited) · table + board + calendar + list views · filters, sorts, grouping, property visibility · side peek · database templates · `@`-mentions with backlinks.

**Tier 2 — the reason to use it over Notion.** Meeting recording → local ASR → transcript block → AI summary (§3) · ask-my-notes with citations · AI autofill · local-only, no cloud, no credits, no rate limits.

**Tier 3 — polish that compounds.** Gallery view, sub-items, summary rows, conditional color, formulas (small subset), reminders, export/import, web clipper, dashboards/charts, quick capture.

**Explicitly skipped, permanently:** sharing, permissions, guests, teamspaces, groups, member management, public sites/publishing, real-time collaboration and presence, comment threads as a social feature, @person mentions, Notion Mail, connectors/MCP-to-SaaS, Enterprise Search, the agent platform, forms-for-others, billing/credits, mobile apps, Place/Map, Feed view, dependencies, multi-data-source databases.

