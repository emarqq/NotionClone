# Supabase Pro — what it unlocks, and what this project should actually use

**Audit date:** 2026-07-29
**Scope:** NotionClone (Next.js 15 + local Supabase CLI stack, Postgres 17, pgvector)
**Method:** Supabase Management API (read-only, via MCP) + supabase.com docs / pricing, fetched 2026-07-29.
**Safety:** Nothing was created, modified, paused, restored or deleted. No `execute_sql`, no `apply_migration`,
no branches, no projects. Every account fact below came from read-only endpoints.

---

## Part 0 — TL;DR

1. **Do not move NotionClone to hosted primary.** It is a single-user, offline-capable desktop notes app;
   the local stack wins on latency and offline. Move the *durability* problem off the machine instead.
2. **The single highest-value action has nothing to do with Pro:** an automated, versioned, restore-drilled
   `pg_dump` of the local stack (§5). Today there is **zero** backup of the real data. Pro does not fix
   this, because Pro's daily backups only protect *hosted* projects, and this project's data is local.
3. **Pro features worth adopting, in order:** off-site dump storage in Supabase Storage → hosted mirror
   project (optional) → branching for migration verification (only if/when hosted) → image transformations
   → pg_cron/pgmq. **PITR is not worth $100/mo here.**
4. **Cost reality:** the org is already paying more than $25/mo because Pro bills compute *per project*
   and two projects are active. See §3.

---

## Part 1 — Your actual Supabase account (read-only inspection, 2026-07-29)

### Organization

| Field | Value |
| --- | --- |
| Name | `emarqq's Org` |
| ID / slug | `sfmzwzuhdwxgqottslgc` |
| **Plan** | **`pro`** — confirmed via `get_organization` |
| Allowed release channels | `ga`, `preview` |
| Opt-in tags | none |

There is exactly **one** organization. Everything below lives in it.

### Projects

| Project | Ref | Region | Status | Postgres | Created |
| --- | --- | --- | --- | --- | --- |
| `finance-hub` | `zgjvrwopermjgqykjsde` | us-west-2 | **ACTIVE_HEALTHY** | 17.6.1.141 | 2026-07-01 |
| `coverage` | `shhhxmiefxairzvcgkej` | us-east-1 | **ACTIVE_HEALTHY** | 17.6.1.147 | 2026-07-27 |
| `market-visualizer` | `acahcqyjpivpqwuulael` | us-east-2 | INACTIVE (paused) | 17.6.1.127 | 2026-06-17 |
| `rankIt` | `wtlyyrsrlllxibqopxqg` | us-west-2 | INACTIVE (paused) | 17.6.1.127 | 2026-06-16 |

### Does any hosted project hold NotionClone's data? **No.**

I listed `public` tables on both active projects. Neither contains anything resembling this app's schema
(`spaces`, `pages`, `blocks`, `chunks`, `links`, `favorites`, `ai_messages`, `app_settings`,
`db_property_options`, …):

- **finance-hub** — 25 tables, a markets/trading app: `securities`, `price_bars_daily` (118,111 rows),
  `screener_metrics` (4,261), `response_cache` (137), `backtest_results` (435), `portfolios`, `holdings`,
  `trading_orders`, `filings`, `financial_facts`, …
- **coverage** — 24 tables, an equity-research app: `workspaces`, `companies` (14), `models` (14),
  `line_items` (104), `coverage` (14), `transcripts`, `xbrl_mappings`, `earnings_events`, …

> **Conclusion: NotionClone's real notes exist in exactly one place on Earth — the Docker volume behind
> your local `supabase start` stack.** There is no hosted copy, no daily backup, no PITR, and (per
> `CLAUDE.md`) no Time Machine. This is the finding that drives every recommendation in this document.

### Extensions

`list_extensions` on `coverage` returns the standard Supabase Postgres 17 catalogue. **Installed** on that
project: `plpgsql`, `pg_stat_statements` (1.11), `supabase_vault` (0.3.1), `uuid-ossp` (1.1). Everything
else is *available but not installed*. The available list confirms every extension this project might want
is present on the hosted platform at these versions:

| Extension | Version available | Relevance to NotionClone |
| --- | --- | --- |
| `vector` (pgvector) | **0.8.2** — ivfflat **and hnsw** | RAG embeddings; HNSW is available (better recall/latency than IVFFlat for a small corpus) |
| `pg_trgm` | 1.6 | fuzzy page-title search / typo-tolerant quick-switcher |
| `pgroonga` + `pgroonga_database` | 3.2.5 | all-language full-text search — an alternative to `to_tsvector` in `hybrid_search` |
| `rum` | 1.3 | FTS index with positional ranking; often better than GIN for ranked text search |
| `pg_cron` | 1.6.4 | scheduled re-embedding, nightly vault reconcile, dump verification |
| `pg_net` | 0.20.4 | async HTTP from SQL — fire ingestion/transcription webhooks without a worker |
| `pgmq` | 1.5.1 | durable queue (powers Supabase Queues) for embedding/transcription jobs |
| `http` | 1.6 | synchronous HTTP client in SQL (blocking — prefer `pg_net`) |
| `pg_jsonschema` | 0.3.3 | validate `blocks.content` ProseMirror JSON / `db_property_options` shapes at the DB layer |
| `postgres_fdw`, `dblink`, `wrappers` | 1.1 / 1.2 / 0.6.2 | cross-database reads — relevant to a local↔hosted mirror |
| `pgsodium` / `supabase_vault` | 3.1.8 / 0.3.1 | encrypted secrets in the DB (LLM API keys, if you ever leave Ollama) |
| `pgaudit` | 17.1 | statement auditing |
| `index_advisor` / `hypopg` | 0.2.0 / 1.4.1 | hypothetical-index testing; powers the dashboard's index advisor |
| `pg_repack` | 1.5.2 | online table/index rebuild without long locks |
| `pgtap` | 1.3.3 | **SQL unit tests — this repo has no test framework for SQL; pgtap + `supabase test db` would fill that gap** |
| `pg_partman` | 5.3.1 | not needed at this scale |
| `pg_graphql` | 1.6.1 | not needed (server actions, not GraphQL) |
| `postgis` family, `pgrouting` | 3.3.7 / 3.4.1 | not relevant |

Source: `mcp__supabase__list_extensions` against `shhhxmiefxairzvcgkej`, 2026-07-29.

### Advisors

**`coverage` — security (3 findings)**

| Level | Lint | Detail |
| --- | --- | --- |
| INFO | `rls_enabled_no_policy` | `public.rate_limit_buckets` has RLS on but no policies (effectively deny-all — fine if only the service role touches it) |
| WARN | `authenticated_security_definer_function_executable` | `public.fn_set_model_value(...)` is `SECURITY DEFINER` and callable by `authenticated` via `/rest/v1/rpc/…` |
| WARN | `authenticated_security_definer_function_executable` | `public.is_workspace_member(uuid)` — same |

**`finance-hub` — security (17 findings)**

- 13 × INFO `rls_enabled_no_policy`: `api_usage`, `backtest_results`, `backtest_run_requests`,
  `backtest_runs`, `calendar_cache`, `filings`, `financial_facts`, `news_cache`, `price_bars_daily`,
  `response_cache`, `screener_metrics`, `securities`, `trading_settings`.
- WARN `function_search_path_mutable`: `public.increment_api_usage` has a role-mutable `search_path`.
- WARN `anon_security_definer_function_executable` **and** WARN
  `authenticated_security_definer_function_executable`: **`public.rls_auto_enable()` is a `SECURITY DEFINER`
  function callable by the `anon` role over the public REST API.** This is the single most serious item in
  the account — an unauthenticated caller can invoke a definer-rights function. Worth revoking
  `EXECUTE ... FROM anon, authenticated` on that project.
- WARN `auth_leaked_password_protection`: HaveIBeenPwned checking is disabled.

Remediation reference: <https://supabase.com/docs/guides/database/database-linter>

**None of these are NotionClone issues** — they belong to the two finance projects. They are reported here
because the audit was account-wide, and the `rls_auto_enable()` one is genuinely worth fixing.

> **Relevance to NotionClone:** the advisors (`get_advisors`, and the dashboard's Query Performance /
> Index Advisor views) are Pro-grade observability you currently get *nothing equivalent to* on the local
> stack. That is a real, if modest, argument for a hosted mirror.

---

## Part 2 — Pro vs Free, feature by feature (as of 2026-07-29)

Primary source: <https://supabase.com/pricing> and <https://supabase.com/pricing.md> (fetched 2026-07-29).

### 2.1 Compute, connections, pooler

Pro/Team include **$10/mo of compute credits, which covers exactly one Micro instance**. Every additional
project bills its own compute at full price.

| Size | $/mo | CPU | Dedicated | RAM | Direct conns | Pooler conns |
| --- | --- | --- | --- | --- | --- | --- |
| Micro | $10 | 2-core ARM | No | 1 GB | 60 | 200 |
| Small | $15 | 2-core ARM | No | 2 GB | 90 | 400 |
| Medium | $60 | 2-core ARM | No | 4 GB | 120 | 600 |
| Large | $110 | 2-core ARM | **Yes** | 8 GB | 160 | 800 |
| XL | $210 | 4-core ARM | Yes | 16 GB | 240 | 1,000 |
| … up to 16XL | $3,730 | 64-core ARM | Yes | 256 GB | 500 | 12,000 |

Free = shared CPU / 500 MB RAM, no size choice. Pooling is Supavisor (transaction + session modes);
the local stack has it too but it's **disabled** in `supabase/config.toml` (`[db.pooler] enabled = false`),
which is correct for a single-user app.

**Verdict for NotionClone:** Micro is comically oversized for one user. Connection limits are irrelevant —
a single Next.js server with a service-role client uses a handful of connections. **No compute add-on needed.**

### 2.2 Backups & Point-in-Time Recovery — the section that matters

Source: <https://supabase.com/docs/guides/platform/backups> (fetched 2026-07-29).

| | Free | **Pro** | Team |
| --- | --- | --- | --- |
| Automatic daily backups | **none** | **7 days retained** | 14 days |
| Backup type | — | physical (Postgres ≥ 15.8.1.079) | physical |
| PITR | not available | **$100/mo per 7 days of retention** (add-on) | same |
| PITR RPO | — | ~2 minutes worst case (WAL archived every 2 min via WAL-G) | same |

PITR pricing ladder: 7 days ≈ $100/mo, 14 days ≈ $200/mo, 28 days ≈ $400/mo. **PITR additionally requires
at least a Small compute add-on** (+$15/mo), so real PITR cost ≈ **$115–125/mo on top of the $25 plan.**

Three caveats that matter enormously for this project:

1. **Backups cover hosted projects only.** They do nothing for a `supabase db reset` against your local
   Docker stack. The 2026-07-07 data loss described in `CLAUDE.md` would happen identically today on Pro.
2. **Backups do not include Storage objects.** "Database backups do not include objects you store via the
   Storage API, as the database only includes metadata about these objects." Page attachments/images in the
   `attachments` bucket need their own backup path.
3. **Deleting a project permanently deletes its backups**, including the S3 copies. Irreversible.

Also: enabling PITR *replaces* daily backups (finer granularity makes both redundant), and after disabling
PITR you can no longer download physical backups — you'd need a manual `supabase db dump` / `pg_dump`.

**Verdict:** Pro's daily backups are genuinely valuable — *if the data lives on a hosted project*. PITR is
overkill for a personal notes app: at $100+/mo it costs more per year than a 4 TB external SSD, to protect
against a 24-hour data window that a nightly `pg_dump` plus the Obsidian vault mirror already largely covers.

### 2.3 Branching — can it verify migrations safely?

Source: <https://supabase.com/docs/guides/deployment/branching> (fetched 2026-07-29). Price: **$0.01344 per
branch per hour** (≈ $0.32/day, ≈ $9.80/mo if left running).

- **Preview branches** are ephemeral — auto-paused after inactivity, deleted when the PR merges/closes.
- **Persistent branches** are long-lived (staging/QA), never auto-deleted.
- Each branch is a **full separate Supabase instance** with its own API credentials.
- Deployment DAG: Clone → Pull → Health → **Migrate** → Seed → Deploy (Edge Functions).
- **Branches start with no data** ("data-less" by design, to protect production data). You can seed them
  via `supabase/seed.sql` through the GitHub integration.

**Does this solve "verify a migration without touching the real DB"?** Partially, and only for a hosted
project:

- ✅ It *does* prove that `supabase/migrations/*.sql` replays cleanly from zero, plus `seed.sql`, plus that
  Auth/Storage/Realtime/PostgREST all come up healthy against the new schema. Cost for a 1-hour
  verification: **~1.3 cents.**
- ❌ It does **not** test the migration against your *real* 100s-of-pages dataset, because branches are
  data-less. Data-shape bugs (a `NOT NULL` added to a column with existing nulls, a fractional-index
  collation change against real `position` values) would pass on a branch and fail on the real DB.
- ❌ It requires a hosted project. It cannot help the local-only setup at all today.

**Verdict:** branching is a nice-to-have, not the answer. The approach `STATE.md` already records —
*"clean migration replay (7 migrations + seed) on a disposable `supabase/postgres` scratch container"* — is
free, works locally, and is strictly better because you can `pg_restore` a real dump into the scratch
container and test the migration against real data. **Keep doing that; branching only becomes interesting
if you go hosted.** See §5.5 for the "restore-a-real-dump-into-scratch" upgrade to that workflow.

### 2.4 Storage

| | Free | **Pro** |
| --- | --- | --- |
| Included storage | 1 GB | **100 GB**, then $0.021/GB |
| **Max file upload size** | **50 MB** | **500 GB** (global setting; per-bucket limits below it) |
| CDN | Basic | **Smart CDN** (cache invalidated on object change) |
| **Image transformations** | ❌ not available | **✅ 100 origin images/mo included, then $5 per 1,000** |
| Cached egress | 5 GB | 250 GB, then $0.03/GB |
| Resumable (TUS) uploads | ✅ both | ✅ |
| S3-compatible API | ✅ both | ✅ |

Sources: <https://supabase.com/docs/guides/storage/uploads/file-limits>,
<https://supabase.com/docs/guides/storage/serving/image-transformations>,
<https://supabase.com/docs/guides/storage/uploads/resumable-uploads> (all fetched 2026-07-29).

Relevant details:

- **Image transformations are Pro-only** and are the most directly useful Storage feature here. Page covers
  and pasted screenshots can be served resized/WebP-optimised via
  `getPublicUrl(path, { transform: { width, height, quality } })` or `createSignedUrl(..., { transform })`.
  Automatic WebP negotiation happens with no code change. Limits: width/height 1–2500, source image
  ≤ 25 MB / ≤ 50 MP. Billing is per **origin** image per cycle (100/mo included), not per rendered
  variant — so a few hundred covers is a couple of dollars at most. There's an official Next.js custom
  `loader` recipe.
- **Resumable uploads (TUS)** are recommended above ~6 MB and give progress events — exactly right for
  meeting audio if/when you add it. Use the direct host
  `https://<ref>.storage.supabase.co/storage/v1/upload/resumable`, 6 MB chunk size, upload URLs valid 24 h.
  `@uppy/tus` or `tus-js-client`.
- **Free's 50 MB cap** would block any real audio recording; **Pro's 500 GB cap** removes that entirely.
- Your local `supabase/config.toml` already has `[storage] file_size_limit = "50MiB"` and
  `[storage.s3_protocol] enabled = true`, with `[storage.image_transformation]` **commented out** and
  labelled *"available to Supabase Pro plan"*. Note the self-hosted stack ships an `imgproxy` service and
  can do transformations locally if you enable it.
- **2025–26 additions visible in your config.toml:** `[storage.analytics]` (Analytics Buckets — Apache
  Iceberg on S3 Tables, "only available on the hosted platform") and `[storage.vector]` (**Vector Buckets**,
  public alpha — S3-backed embedding storage with cosine/Euclidean/L2 search, tens of millions of vectors
  per index, batch of 500/request). Both are Pro features. **Neither is right for this app** — the docs
  themselves say to use pgvector for "lowest latency, core relational model vectors, transactional
  guarantees, and small-to-medium datasets," which is exactly your `chunks` table with a few thousand rows.
  Sources: <https://supabase.com/features/vector-buckets>, <https://supabase.com/blog/analytics-buckets>.

**Current app usage:** one private bucket `attachments`, created in
`supabase/migrations/20260703000000_initial_schema.sql` with four `authenticated`-scoped RLS policies.
Touched from `app/api/files/route.ts`, `lib/db/files.ts`, `lib/rag/ingest.ts`, `lib/import/importDoc.ts`.
Meetings (`app/actions/meetings.ts`) are currently **page templates only — no audio files yet**, so audio
storage is a future concern, not a present one.

### 2.5 Realtime

| | Free | **Pro** |
| --- | --- | --- |
| Concurrent peak connections | 200 | **500**, then $10 per 1,000 |
| Messages / month | 2 M | **5 M**, then $2.50/M |
| **Max message size** | 256 KB | **3 MB** |
| Postgres Changes / Broadcast / Presence | ✅ | ✅ |

Source: <https://supabase.com/docs/guides/realtime/architecture> (fetched 2026-07-29).

The three mechanisms, and which one a live editor should use:

- **Postgres Changes** — Realtime acquires a **logical replication slot**, polls the WAL, appends channel
  subscription IDs to each record, and fans out. Simple, but it's the heaviest option: every subscriber
  costs database work, and it's the classic scaling wall.
- **Broadcast** — client→channel→clients, routed through the nearest Elixir node globally; lowest latency,
  no DB involvement. **Broadcast from Postgres** writes to a `realtime.messages` table (partitioned daily,
  3-day retention) and streams inserts from its WAL — this is the modern, recommended path for
  DB-triggered fan-out because you control exactly which events are published.
- **Presence** — in-memory CRDT-backed key/value of who's connected; this is what "Erik is editing" avatars
  and cursor positions use.

**Verdict for NotionClone:** multi-device sync of a live editor is a *real* future feature and Realtime is
the right tool — but the correct design is **Broadcast (from Postgres, via a trigger on `blocks`) +
Presence for cursors**, not naive Postgres Changes on the `blocks` table. Pro's 3 MB message ceiling
matters: a big ProseMirror block fragment could plausibly exceed 256 KB, so Free would truncate what Pro
carries. However — this only works if the database is *hosted*. Two desktop machines cannot both reach a
`localhost:54322` Postgres. **Realtime is the strongest argument for eventually going hosted, and it should
be the trigger condition for that migration (§4).**

### 2.6 Edge Functions

| | Free | **Pro** |
| --- | --- | --- |
| Invocations | 500 K/mo | **2 M/mo**, then $2/M |
| Max functions per project | 100 | **500** |
| Max wall-clock duration | 150 s | **400 s** |
| Memory | 256 MB | 256 MB |
| Max CPU time | 2 s/request | 2 s/request |
| Function size (bundled) | 20 MB | 20 MB |
| Secrets | 100 per project, ≤ 48 KiB each | same |

Source: <https://supabase.com/docs/guides/functions/limits> (fetched 2026-07-29).

Restrictions worth knowing: no Web Worker / Node `vm` API; **no multithreaded native libs — explicitly no
`sharp`/`libvips`**; outbound ports 25/587 blocked; HTML responses only with a custom domain; static files
need Docker CLI deploy.

**Verdict:** low relevance today. The embedding pipeline calls **local Ollama**, which an Edge Function in
AWS cannot reach. The 2 s CPU cap and 256 MB memory also make Edge Functions a poor fit for chunking large
documents. They'd become useful only for *webhook receivers* — e.g. a transcription provider calling back
when meeting audio is done. Even then, your Next.js server on `:3777` can serve that route directly if it's
reachable. **Skip for now.**

### 2.7 Auth

| | Free | **Pro** |
| --- | --- | --- |
| MAUs included | 50,000 | **100,000**, then $0.00325/MAU |
| Custom SMTP | ✅ | ✅ |
| Basic MFA (TOTP) | ✅ | ✅ |
| Advanced MFA (Phone) | ❌ | $75/mo first project |
| **Leaked-password protection** | ❌ | **✅** |
| **Single session per user** | ❌ | **✅** |
| **Session timeouts** | ❌ | **✅** |
| Remove Supabase branding from emails | ❌ | ✅ |
| Auth audit logs | 1 hour | **7 days** |
| SAML SSO | ❌ | 50 MAU included, then $0.015/MAU |

**Verdict:** for one user, MAU limits are meaningless. The three genuinely useful Pro unlocks are **leaked-
password protection**, **single session per user**, and **session timeouts** — cheap hardening if the app
ever becomes internet-reachable. Nothing here justifies the plan on its own.

### 2.8 Observability

| | Free | **Pro** |
| --- | --- | --- |
| Log retention (API & Database) | 1 day | **7 days** |
| Metrics endpoint (Prometheus) | ❌ | **✅** |
| Query Performance / Index Advisor | dashboard | dashboard |
| Log Drains | ❌ | **$60/drain/mo + $0.20/M events + $0.09/GB egress** — extra cost |
| Platform audit logs | ❌ | ❌ (Team+) |
| SOC2 / ISO 27001 / HIPAA | ❌ | ❌ (Team+ / add-on) |

**Verdict:** the Prometheus metrics endpoint + 7-day logs + `index_advisor`/`hypopg`-backed advisors are a
real quality-of-life upgrade over the local stack, which gives you Docker logs and nothing else. Log Drains
are not worth $60/mo here.

### 2.9 Explicitly extra-cost add-ons (NOT included in the $25)

| Add-on | Price |
| --- | --- |
| Point-in-Time Recovery | **$100/mo per 7 days retention** (+ requires ≥ Small compute) |
| Custom Domain | $10/domain/month/project |
| Database Branching | $0.01344/branch/hour |
| Advanced MFA (Phone) | $75/mo first project, $10/mo each additional |
| SAML/SSO | 50 MAU included, then $0.015/MAU |
| Log Drains | $60/drain/mo + $0.20/M events + $0.09/GB egress |
| Image Transformations | 100 origin images included, then $5/1,000 |
| **Read Replicas** | billed per replica (own compute) |
| IPv4 address | separate add-on |

**Read Replicas** (<https://supabase.com/docs/guides/platform/read-replicas>) deserve a note because they
sound like a backup: **they are not.** They're async streaming replicas for read scaling and geo-latency;
they only serve `SELECT`, only the Data API's `GET` requests use them, and **Auth/Storage/Realtime cannot
use a replica at all**. A replica also faithfully replicates a `DELETE FROM pages` in seconds — it protects
against hardware failure, not against you. Supabase's own guidance is not to scale until CPU is sustained
above 70%. **Irrelevant at one user.**

### 2.10 2025–2026 platform additions

- **Supabase Queues** — durable, guaranteed-delivery, exactly-once-within-visibility-window message queue
  on `pgmq` 1.5.1, with dashboard management and RLS-controlled access.
  <https://supabase.com/docs/guides/queues>
- **Supabase Cron (UI)** — `pg_cron` 1.6.4 with a Dashboard scheduler under Integrations → Cron. Jobs can
  run SQL, call DB functions with zero network latency, or make HTTP requests (e.g. invoke an Edge
  Function). Recommendation: ≤ 8 concurrent jobs, ≤ 10 min each. <https://supabase.com/docs/guides/cron>
- **Analytics Buckets (Iceberg)** — S3 Tables–backed Apache Iceberg storage with time travel, schema
  evolution, automatic compaction, an Iceberg FDW wrapper, and Supabase ETL for Postgres→Iceberg
  replication. Hosted-only. <https://supabase.com/blog/analytics-buckets>
- **Vector Buckets (public alpha)** — see §2.4. Not for this app.
- **Declarative schemas + `supabase db diff`** — declare desired state in `supabase/schemas/*.sql`, run
  `supabase db diff -f <name>` to *generate* the versioned migration via `migra`. Ordering is controlled by
  `[db.migrations] schema_paths` in `config.toml` (currently `schema_paths = []` in this repo).
  <https://supabase.com/docs/guides/local-development/declarative-database-schemas>
  **Known `migra` blind spots that matter to this repo:** DML is not captured (so `seed.sql`-style inserts
  and the `insert into storage.buckets` in the initial migration are invisible), RLS `alter policy` and
  column privileges are missed, `grant` statements get duplicated from default privileges, and comments,
  partitions, materialized views and `create domain` are untracked; views aren't recreated on column type
  changes. Given `CLAUDE.md`'s hard rule that *"migrations must include explicit GRANTs (local images ship
  no default grants)"*, **declarative schemas would fight this repo's conventions.** Verdict: don't adopt
  wholesale; `supabase db diff` is still useful ad-hoc to *check for drift*.
- **Data API vs direct connection** — note your `config.toml` already carries the 2026 deprecation notice
  for `auto_expose_new_tables` (field removed 2026-10-30, after which new `public` entities are never
  auto-exposed to `anon`/`authenticated`/`service_role` without explicit `GRANT`s). This repo is already on
  the safe side of that change. Also note `[storage.analytics] enabled = false` and self-hosted
  analytics/vector became opt-in on 2026-06-03.

---

## Part 3 — What Pro would cost this project

Assumptions: single user, "100s of pages", images/covers, and eventual meeting audio.

**Data sizing.** A few hundred pages of prose ≈ single-digit MB of text. `blocks` rows (one per top-level
node) plus ProseMirror JSON overhead, plus `chunks` with `vector(768)` embeddings (≈ 3 KB/row raw) — even at
10,000 chunks that's ~30 MB of vectors plus index. **Realistic database size: well under 1 GB**, against
8 GB included. Images at a few hundred KB each and audio at ~1 MB/minute: 100 hours of recordings ≈ 6 GB,
against **100 GB included**. Egress for one user is a rounding error against **250 GB**.

**So the usage tiers are all free. The cost is entirely compute-per-project.**

| Scenario | Monthly |
| --- | --- |
| Pro plan base | $25 |
| **Your account today** (finance-hub + coverage active, 2 × Micro = $20, − $10 credits) | **$35** |
| …+ a hosted NotionClone project on Micro | **$45** |
| …if you also unpause `market-visualizer` + `rankIt` (Pro projects never auto-pause) | **$65** |
| Hosted NotionClone **+ PITR 7 days** (PITR requires ≥ Small: $15 not $10) | **$150** |
| Local stack + dumps parked in an existing project's Storage bucket | **$35** (no change) |

Two account-level warnings:

1. **On Pro, projects never pause.** The two INACTIVE projects were presumably paused under Free. If you
   restore them, each starts billing $10/mo indefinitely. Leave them paused, or delete them —
   **but remember deleting a project irreversibly destroys its backups too.**
2. **Spend Cap is ON by default on Pro.** Keep it on. With it on, exceeding a quota triggers a grace period
   and email rather than a surprise bill.

---

## Part 4 — Recommendation 1: local, hosted, or hybrid?

### Recommendation: **stay local-primary, add a hosted off-site backup target. Hybrid, tilted local.**

**Why not hosted primary.**

- **Offline.** The Electron shell at `127.0.0.1:3777` is a *notes app you open on a laptop*. On a hosted
  primary, every page load, every debounced block save, and the entire sidebar tree fail without internet.
  A personal knowledge base that stops working on a plane is a downgrade no backup story compensates for.
- **Latency, compounded by the architecture.** This is a server-first app: server actions in `app/actions/*`
  call `lib/db/*` over a service-role client. Those are *sequential* round trips from the machine running
  the Next.js server, not a single batched query. Local Postgres answers in ~0.5–2 ms; `us-west-2` answers
  in 30–90 ms. A page open that does 4–6 sequential queries goes from imperceptible (~10 ms) to a visible
  200–500 ms stall, and the debounced block save that currently feels instant starts lagging behind typing.
- **The RAG path makes it worse.** `hybrid_search` (FTS + cosine, RRF-fused) plus the neighbor-expansion RPC
  are latency-sensitive and run per AI query, while the LLM itself is local Ollama. You'd be putting the
  internet in the middle of a pipeline whose other end is on `localhost`.
- **Cost.** +$10/mo forever for a strictly worse interactive experience.

**Why not pure local either.** Because pure local is what produced the 2026-07-07 incident. The local stack
has no backups, no PITR, no advisors, no metrics, and its entire dataset is one `docker volume rm` from
gone.

**The hybrid, concretely:**

```
  [ local Supabase stack ]  ← primary, read+write, offline-capable, ~1 ms
            │
            ├─ nightly pg_dump (custom format, compressed) ─┐
            │                                               ├→ ~/Backups/notionclone/  (local, 30 days)
            │                                               ├→ off-site copy (restic/B2 or iCloud)
            │                                               └→ Supabase Storage bucket (Pro, free within 100 GB)
            │
            ├─ continuous markdown mirror ──────────────→ ~/ObsidianVault/NotionClone (already exists)
            │
            └─ monthly restore drill into a scratch stack (§5.5)
```

The vault mirror in `lib/export/` (default `~/ObsidianVault/NotionClone`, exporter-owned subfolder
`Notion/`) is already a **partial, human-readable, continuously-updated backup** — and it is why the July
incident wasn't total. But be clear about what it does *not* preserve: block-level structure and `blockId`
attrs, inline comments, database-page property values and `db_property_options`, backlinks/`links`, RAG
`chunks`/embeddings, favorites/recents, `app_settings`, fractional `position` keys, and Auth users. It is a
content backup, not a system backup. **Do not treat it as the backup.**

**Flip to hosted primary when — and only when — one of these becomes true:**

1. You want the app on a **second device** (another Mac, an iPad, a phone). At that moment a shared hosted
   Postgres plus **Realtime Broadcast + Presence** (§2.5) becomes the only sane design, and the latency
   cost is worth it.
2. You want the app reachable from outside the LAN (deployed frontend + custom domain).
3. Local Docker/colima maintenance becomes a bigger annoyance than the latency.

Until then, the hosted side's job is **durability, not serving**.

---

## Part 5 — Recommendation 2: the single best backup strategy (do this first)

The core insight: **the risk is not disk failure, it is you (or an agent) running a destructive command.**
Physical replication, read replicas, and even hosted daily backups all faithfully propagate `DROP`. What
defends against operator error is **immutable, versioned, point-in-time-labelled dumps that live somewhere
the destructive command cannot reach**, plus **a rehearsed restore**.

### 5.1 Why `pg_dump` from inside the container

The local DB is Postgres **17** (`major_version = 17` in `config.toml`). A Homebrew `pg_dump` at a lower
major version will refuse to dump it. Running `pg_dump` *inside* the Supabase DB container guarantees an
exact version match and needs no local Postgres install. The container is named after `project_id` in
`config.toml`, i.e. **`supabase_db_NotionClone`**.

A full-cluster `pg_dump` as `postgres` captures `public` **and** `auth.users`, `storage.objects`/`buckets`,
`vault`, and the `supabase_migrations.schema_migrations` history — everything a restore needs.

### 5.2 The script

Save as `scripts/backup-local-db.sh`, `chmod +x` it. It is read-only against the database.

```bash
#!/usr/bin/env bash
# Nightly logical backup of the LOCAL Supabase stack. READ-ONLY against the DB.
set -Eeuo pipefail

PROJECT_ID="NotionClone"                 # matches project_id in supabase/config.toml
DB_CONTAINER="supabase_db_${PROJECT_ID}"
STORAGE_CONTAINER="supabase_storage_${PROJECT_ID}"
DEST="${HOME}/Backups/notionclone"
KEEP_DAYS=30
STAMP="$(date +%Y-%m-%dT%H-%M-%S)"
OUT="${DEST}/${STAMP}"

# colima / docker socket (see CLAUDE.md)
export DOCKER_HOST="${DOCKER_HOST:-unix://${HOME}/.colima/default/docker.sock}"

mkdir -p "$OUT"

# 0. Fail loudly if the stack isn't up — an empty backup is worse than none.
docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" | grep -q true \
  || { echo "FATAL: $DB_CONTAINER is not running; refusing to write an empty backup" >&2; exit 1; }

# 1. Whole-cluster custom-format dump (compressed, selectively restorable).
docker exec "$DB_CONTAINER" \
  pg_dump -U postgres -d postgres -Fc --no-owner --no-privileges --compress=9 \
  > "${OUT}/db.dump"

# 2. Plain-SQL twin: greppable, diffable, restorable without pg_restore.
docker exec "$DB_CONTAINER" \
  pg_dump -U postgres -d postgres --no-owner --no-privileges \
  | gzip -9 > "${OUT}/db.sql.gz"

# 3. Roles (globals) — passwords for custom roles are NOT in the per-db dump.
docker exec "$DB_CONTAINER" \
  pg_dumpall -U postgres --roles-only > "${OUT}/roles.sql"

# 4. Storage objects (the `attachments` bucket). DB dumps hold metadata only.
docker exec "$STORAGE_CONTAINER" tar -cf - -C /var/lib/storage . \
  | gzip -9 > "${OUT}/storage.tar.gz" || echo "WARN: storage container not found; skipped"

# 5. Migration history + a manifest, so a restore is self-describing.
docker exec "$DB_CONTAINER" psql -U postgres -d postgres -At \
  -c "select version from supabase_migrations.schema_migrations order by version" \
  > "${OUT}/migrations-applied.txt"

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -At -c "
  select 'spaces=' || (select count(*) from spaces)
      || ' pages='  || (select count(*) from pages)
      || ' blocks=' || (select count(*) from blocks)
      || ' chunks=' || (select count(*) from chunks)
      || ' db_size=' || pg_size_pretty(pg_database_size('postgres'))" \
  > "${OUT}/manifest.txt"

# 6. SANITY GATE: refuse to keep a backup that lost the data. Tune the floor once
#    you know your real page count; this catches "dumped an empty reset database".
PAGES=$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -At -c "select count(*) from pages")
if [ "$PAGES" -lt 20 ]; then
  mv "$OUT" "${OUT}.SUSPECT"
  echo "FATAL: only ${PAGES} pages — kept as ${OUT}.SUSPECT, NOT pruning old backups" >&2
  exit 2
fi

# 7. Off-site copy. Pick one (or more) — a backup on the same disk is not a backup.
#    a) iCloud/Dropbox:
#       rsync -a --delete "$DEST/" "${HOME}/Library/Mobile Documents/com~apple~CloudDocs/NotionCloneBackups/"
#    b) restic to Backblaze B2 (encrypted, deduped, versioned) — recommended:
#       restic -r b2:my-bucket:notionclone backup "$OUT"
#    c) Supabase Storage (Pro, free within your 100 GB) — see §6.

# 8. Prune (only reached when the sanity gate passed).
find "$DEST" -maxdepth 1 -type d -name '20*' -mtime "+${KEEP_DAYS}" -exec rm -rf {} +

echo "OK  ${OUT}  $(cat "${OUT}/manifest.txt")"
```

Wire it into `package.json`:

```json
{
  "scripts": {
    "db:backup": "bash scripts/backup-local-db.sh",
    "db:restore-drill": "bash scripts/restore-drill.sh"
  }
}
```

### 5.3 Schedule it (macOS `launchd`, survives reboots)

`~/Library/LaunchAgents/com.erik.notionclone.backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.erik.notionclone.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/erikmarquardt/Hub/OS/projects/NotionClone/scripts/backup-local-db.sh</string>
  </array>
  <!-- 02:15 daily; StartCalendarInterval runs at next wake if the Mac was asleep -->
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>15</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/Users/erikmarquardt/Library/Logs/NotionCloneBackup.log</string>
  <key>StandardErrorPath</key><string>/Users/erikmarquardt/Library/Logs/NotionCloneBackup.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DOCKER_HOST</key>
    <string>unix:///Users/erikmarquardt/.colima/default/docker.sock</string>
  </dict>
</dict>
</plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.erik.notionclone.backup.plist
launchctl kickstart -k gui/$(id -u)/com.erik.notionclone.backup   # run once now
tail -f ~/Library/Logs/NotionCloneBackup.log
```

**Also turn on Time Machine** to an external disk — `CLAUDE.md` records that it is not configured. Exclude
`node_modules` and `.next`; include `~/Backups/notionclone`. That is the cheapest second copy you will ever
buy, and it makes the Docker volume itself recoverable.

### 5.4 The guardrail that would have prevented 2026-07-07

Back up *immediately before* anything destructive, and make the destructive path go through the backup:

```json
{
  "scripts": {
    "db:reset": "bash scripts/backup-local-db.sh && echo '--- backup taken; reset still requires explicit consent ---' && false"
  }
}
```

Deliberately ending in `false` means `npm run db:reset` **takes a backup and then refuses to reset** — you
must type the real `supabase db reset` yourself, by which point a fresh dump exists. Combine with the
existing `CLAUDE.md` CAUTION block, which already forbids agents from running it without explicit consent.

### 5.5 The restore drill — a backup you have never restored is a rumour

Run this **monthly**, and always before a risky migration. Save as `scripts/restore-drill.sh`:

```bash
#!/usr/bin/env bash
# Restore the newest backup into a THROWAWAY Postgres 17. Never touches the real stack.
set -Eeuo pipefail
export DOCKER_HOST="${DOCKER_HOST:-unix://${HOME}/.colima/default/docker.sock}"

LATEST="$(ls -1d "${HOME}/Backups/notionclone"/20* | tail -1)"
echo "Drilling: $LATEST"

docker rm -f nc_restore_drill >/dev/null 2>&1 || true
docker run -d --name nc_restore_drill -e POSTGRES_PASSWORD=postgres \
  -p 55432:5432 supabase/postgres:17.6.1.147 >/dev/null
until docker exec nc_restore_drill pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done

docker exec -i nc_restore_drill psql -U postgres -q < "${LATEST}/roles.sql" || true
docker exec -i nc_restore_drill pg_restore -U postgres -d postgres --no-owner --no-privileges \
  < "${LATEST}/db.dump" || true      # FK/extension ordering noise is expected; row counts are the test

echo "--- verification ---"
docker exec nc_restore_drill psql -U postgres -d postgres -c "
  select (select count(*) from spaces) spaces,
         (select count(*) from pages)  pages,
         (select count(*) from blocks) blocks,
         (select count(*) from chunks) chunks;"
echo "--- expected (from manifest) ---"; cat "${LATEST}/manifest.txt"

echo
echo "Now the real test: read an actual note."
docker exec nc_restore_drill psql -U postgres -d postgres -c \
  "select p.title, left(b.content::text, 120) from pages p
     join blocks b on b.page_id = p.id order by p.updated_at desc limit 5;"

read -r -p "Numbers match and the text is real? [y/N] " ok
[ "$ok" = y ] && echo "DRILL PASSED" || echo "DRILL FAILED — fix the backup before trusting it"
docker rm -f nc_restore_drill >/dev/null
```

**This same scratch container is the safe place to verify migrations** — and it's strictly better than a
Supabase branch, because you can restore *real data* into it first and then run `supabase migration up`
against it. That upgrades the workflow `STATE.md` already describes from "migrations replay on an empty DB"
to "migrations replay on **my actual data**", which is where the dangerous bugs live.

### 5.6 What "good" looks like

| Layer | Mechanism | RPO | Covers |
| --- | --- | --- | --- |
| Continuous | vault markdown mirror (`lib/export/`) | seconds | page *text* only |
| Nightly | `pg_dump` → `~/Backups/notionclone` (30 versions) | 24 h | full DB + roles + storage blobs |
| Nightly | off-site copy (restic/B2, iCloud, or Supabase Storage) | 24 h | same, survives disk/machine loss |
| Hourly-ish | Time Machine | ~1 h | whole machine incl. Docker volume |
| On demand | pre-destructive backup via `npm run db:reset` gate | 0 | the exact failure mode from July |
| Monthly | restore drill | — | proves the above is real |

---

## Part 6 — Recommendation 3: Pro features to adopt, in priority order

| # | Feature | Cost | What it buys NotionClone | Adopt? |
| --- | --- | --- | --- | --- |
| **1** | **Storage as an off-site dump target** — private `notionclone-backups` bucket on an existing project (`coverage` or `finance-hub`), or its own | **$0** (100 GB included; a compressed dump of this DB is tens of MB) | Turns §5's local dumps into genuine off-site copies with one `curl`/`supabase-js` upload. Highest value-per-dollar in the entire plan. | **Yes, now** |
| **2** | **Query Performance + Index Advisor + advisors + 7-day logs + metrics endpoint** | included | The local stack gives you none of this. `index_advisor`/`hypopg` on `hybrid_search` and the `blocks`/`chunks` scans is exactly the kind of tuning you can't do locally. Requires a hosted copy to be useful. | **Yes, once a mirror exists** |
| **3** | **Image Transformations** (Pro-only) | 100 origin images/mo free, then $5/1,000 | Page covers and pasted screenshots served resized + auto-WebP; big drop in payload and load time. Next.js custom `loader` recipe exists. Self-hosted `imgproxy` can do this locally too. | **Yes**, when covers/images grow |
| **4** | **500 GB max upload + resumable (TUS) uploads** | included | Free's 50 MB ceiling blocks meeting audio outright. TUS gives progress + resume for long recordings. | **Yes**, when meeting audio ships |
| **5** | **Hosted mirror project** (nightly `supabase db push` + data load, or restore of the dump) | **+$10/mo** (Micro) | Inherits Pro's **7-day daily backups for free**, gives you a warm standby you could point the app at, unlocks #2, and is a genuinely independent second location. | **Optional — good value** |
| **6** | **pg_cron + pgmq / Supabase Queues** | included | Durable background jobs for re-embedding and (later) transcription callbacks, replacing fire-and-forget `after()` calls in `app/actions/*` that vanish if the process dies. Works locally too. | **Later** |
| **7** | **Realtime Broadcast + Presence** (3 MB messages, 500 concurrent) | included | Multi-device live editing. **Only meaningful on a hosted primary** — this is the feature that should trigger the migration decision, not the other way round. | **Only if going hosted** |
| **8** | **Branching** ($0.01344/branch-hour) | ~$0.01 per verification | Proves migrations replay from zero with a healthy Auth/Storage/Realtime. But branches are **data-less**, so the scratch-container drill (§5.5) is strictly more informative. | **Only if hosted; low priority** |
| **9** | **Auth hardening**: leaked-password protection, single session per user, session timeouts | included | Cheap hardening if the app ever leaves localhost. (Also: `finance-hub` currently has leaked-password protection off — worth flipping.) | **Free, do it** |
| **10** | **PITR** | **$100/mo + Small compute** | 2-minute RPO instead of 24 hours. For a personal notes app whose text is already continuously mirrored to Obsidian, this buys almost nothing over a nightly dump. | **No** |
| 11 | Read Replicas | per-replica compute | Read scaling / geo-latency. Not a backup — replicates your `DROP` faithfully. | **No** |
| 12 | Log Drains | $60/drain/mo + usage | Ship logs elsewhere. | **No** |
| 13 | Custom Domain | $10/mo | Only if the app ever gets a public URL. | **No** |
| 14 | Advanced MFA (Phone) | $75/mo | Single user. | **No** |
| 15 | Analytics Buckets / Vector Buckets | Pro | Iceberg analytics and S3 vector storage at millions-of-vectors scale. Supabase's own guidance says pgvector wins below that. | **No** |
| 16 | Edge Functions | 2 M invocations included | Can't reach local Ollama; 2 s CPU cap; no `sharp`. Only useful for external webhooks. | **No, for now** |
| 17 | Declarative schemas | free (CLI) | `migra` misses `GRANT`s, `alter policy`, DML, comments — all of which this repo relies on. Useful ad-hoc for drift detection via `supabase db diff`. | **Not wholesale** |

### 6.1 Concretely, this week

1. Write `scripts/backup-local-db.sh` and `scripts/restore-drill.sh` (§5.2, §5.5). Run both **today**.
2. Load the `launchd` agent (§5.3). Verify tomorrow morning's log.
3. Enable **Time Machine** to an external disk.
4. Add the `npm run db:reset` backup gate (§5.4) and cross-reference it from the `CLAUDE.md` CAUTION block.
5. Create a private `notionclone-backups` bucket on an existing Pro project and add step 7c to the script.
6. Leave `market-visualizer` and `rankIt` **paused** so they don't start billing $10/mo each.
7. Unrelated but worth doing: revoke `EXECUTE` on `finance-hub`'s `public.rls_auto_enable()` from `anon`
   and `authenticated`, and enable leaked-password protection there.

---

## Sources (all fetched 2026-07-29)

| Topic | URL |
| --- | --- |
| Pricing & full plan comparison | <https://supabase.com/pricing> · <https://supabase.com/pricing.md> |
| Backups & PITR | <https://supabase.com/docs/guides/platform/backups> |
| Physical vs logical backups | <https://supabase.com/blog/postgresql-physical-logical-backups> |
| Branching | <https://supabase.com/docs/guides/deployment/branching> |
| Storage file limits | <https://supabase.com/docs/guides/storage/uploads/file-limits> |
| Image transformations | <https://supabase.com/docs/guides/storage/serving/image-transformations> |
| Resumable (TUS) uploads | <https://supabase.com/docs/guides/storage/uploads/resumable-uploads> |
| Realtime architecture | <https://supabase.com/docs/guides/realtime/architecture> |
| Edge Function limits | <https://supabase.com/docs/guides/functions/limits> |
| Queues (pgmq) | <https://supabase.com/docs/guides/queues> |
| Cron (pg_cron) | <https://supabase.com/docs/guides/cron> |
| Read Replicas | <https://supabase.com/docs/guides/platform/read-replicas> |
| Egress pricing & optimisation | <https://supabase.com/docs/guides/platform/manage-your-usage/egress> |
| Declarative schemas / `db diff` | <https://supabase.com/docs/guides/local-development/declarative-database-schemas> |
| Vector Buckets (alpha) | <https://supabase.com/features/vector-buckets> |
| Analytics Buckets (Iceberg) | <https://supabase.com/blog/analytics-buckets> |
| Database linter reference | <https://supabase.com/docs/guides/database/database-linter> |
| `supabase db dump` CLI | <https://supabase.com/docs/reference/cli/supabase-db-dump> |
| Account facts | Supabase Management API via MCP — `list_organizations`, `get_organization`, `list_projects`, `get_project`, `list_tables`, `list_extensions`, `get_advisors` (read-only) |
