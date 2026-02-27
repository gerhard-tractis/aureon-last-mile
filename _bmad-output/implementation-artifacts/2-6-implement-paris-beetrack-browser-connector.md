# Story 2.6: Implement Paris/Beetrack Excel Import via Playwright + n8n

Status: done

## Story

As an operations manager at Transportes Musan,
I want the system to automatically trigger a Beetrack Excel export and parse the resulting file from email,
so that orders from Paris/Cencosud are imported without manual login and data copy.

## Context & Approach Decision

**Original spec called for OpenClaw + Groq LLM browser agent.** After analysis, this was replaced with a simpler, more reliable approach:

- **Beetrack has no API** (requires Paris account owner to provision credentials — pending meeting)
- **Beetrack has no direct download** — only "send report to email" which delivers an Office Online link
- **This is a temporary solution** until API credentials + webhooks are provisioned by Paris

**Final architecture:** Two-part pipeline:
1. **Playwright script** (4x daily via cron/jobs): login → navigate → trigger Excel report to IMAP inbox → close browser
2. **n8n workflow** (IMAP trigger): detect Beetrack email → extract Office Online link → download .xlsx → parse → group by order → column map → upsert orders + packages → job tracking

This reuses the proven Story 2.5 pattern (IMAP → parse → upsert) with a Playwright trigger bolted on front.

**Migration path:** When Paris provides API keys + webhooks, deactivate the Playwright cron and replace the n8n trigger with a webhook receiver. The parsing/upsert pipeline stays the same.

## Acceptance Criteria

### AC1: Playwright Trigger (Worker Connector)
**Given** the cron creates 4 browser jobs daily (07:00, 10:00, 13:00, 16:00 CLT)
**When** the worker picks up a Paris browser job
**Then** `beetrack.ts` connector launches Playwright headless Chromium
**And** authenticates at Beetrack login page using credentials from `connector_config` (decrypted with `ENCRYPTION_KEY`)
**And** navigates to the report/export section
**And** sets filter to today's date
**And** triggers "send report to email" to the configured IMAP inbox address
**And** closes the browser session immediately (free RAM on 8GB VPS)
**And** updates the job record with `status: completed` and `result: { report_triggered: true }`

### AC2: n8n IMAP Workflow — Email Detection & Download
**Given** a Beetrack report email arrives in the shared IMAP inbox
**When** the n8n Beetrack Excel Import workflow polls (every 10 minutes)
**Then** the email is filtered by Beetrack sender address/subject (distinct from Easy filter)
**And** the Office Online link (`view.officeapps.live.com/...`) is extracted from the email body
**And** the link is resolved to the actual .xlsx download URL
**And** the .xlsx file is downloaded via HTTP Request
**And** the raw file is uploaded to Supabase Storage: `raw-files/musan/paris/{date}/beetrack_export_{timestamp}.xlsx`
**And** a `raw_files` record is created with file metadata

### AC3: Excel Parsing & Column Mapping
**Given** the downloaded .xlsx has sheet "DispatchTrack" with 65 columns
**When** the Map & Validate node processes the rows
**Then** row 0 (headers) is parsed for column index mapping
**And** rows 1+ (data) are grouped by `Orden` column (multiple rows per order = multiple packages/cartons)
**And** columns are mapped to the orders schema per the mapping table below
**And** the `CARTONID` column maps to `packages.label` (scannable barcode)
**And** `Código del producto` + `Nombre del producto` map to `packages.sku_items`
**And** phone numbers are normalized to Chilean format (+56XXXXXXXXX)
**And** empty/whitespace-only fields are treated as null

### AC4: Order Upsert
**Given** mapped order data is ready
**When** upserting to Supabase
**Then** orders are upserted using `ON CONFLICT (operator_id, order_number)` — existing orders are updated
**And** each order has `imported_via = 'EMAIL'`, `retailer_name = 'Paris'`, `tenant_client_id = Paris client UUID`
**And** `raw_data` preserves the original Excel row as JSON for audit trail
**And** packages are linked to their parent order via `order_id` FK after upsert returns order IDs

### AC5: Job Tracking & Error Handling
**Given** the n8n workflow processes an import
**When** it completes
**Then** a job record is created/updated with `rows_processed`, `orders_upserted`, `packages_inserted`, `errors`
**And** audit log entries are created automatically (via DB trigger) for each order INSERT/UPDATE
**And** on failure: job is marked `failed`, error logged to Sentry, email body preserved for debugging

### AC6: Playwright Failure Handling
**Given** the Playwright connector encounters an error
**When** login fails, page is unreachable, or navigation errors occur
**Then** a screenshot is saved to Supabase Storage: `raw-files/musan/paris/{date}/error_screenshot_{timestamp}.png`
**And** the job is marked `failed` with descriptive `error_message`
**And** the worker retry logic handles retries (exponential backoff, max 3 retries per Story 2.7)
**And** the browser session is always closed in a `finally` block (prevent zombie Chromium processes)

### AC7: Sequential Browser Execution
**Given** the VPS has only 8GB RAM
**When** a browser job is picked up
**Then** only one Playwright browser session runs at a time (enforced by `FOR UPDATE SKIP LOCKED` single-job polling)
**And** browser is launched with minimal flags: `--no-sandbox`, `--disable-gpu`, `--disable-dev-shm-usage`

## Beetrack Excel Column Mapping

Sheet: **DispatchTrack** | Encoding: **UTF-8** | Row 0 = headers, Row 1+ = data

| # | Beetrack Column | Maps To | Notes |
|---|---|---|---|
| 0 | Identificador ruta | `orders.external_load_id` | Route/load identifier (e.g., 45017521) |
| 2 | Orden | `orders.order_number` | **Primary key** — group rows by this value |
| 4 | Fecha estimada | `orders.delivery_date` | Format: `2026-02-25 23:37:59` — parse date only |
| 6 | Estado | `orders.status_detail` | e.g., "Ruta troncal" |
| 11 | Id cliente | `orders.raw_data.rut` | Chilean RUT (e.g., 15.371.858-K) |
| 12 | Nombre cliente | `orders.customer_name` | |
| 13 | Dirección cliente | `orders.delivery_address` | Full address string |
| 14 | Teléfono cliente | `orders.customer_phone` | Normalize to +56 format |
| 15 | Correo electrónico cliente | `orders.metadata.customer_email` | |
| 21 | Latitud dirección | `orders.metadata.latitude` | |
| 22 | Longitud dirección | `orders.metadata.longitude` | |
| 32 | Desc_Comuna | `orders.comuna` | e.g., NUNOA, PROVIDENCIA |
| 43 | isPrime | `orders.metadata.is_prime` | VIP flag: "Vip", "Oro", "Prime", etc. |
| 48 | URLGUIA | `orders.metadata.delivery_guide_url` | PDF link for individual order |
| 49 | URLCARGA | `orders.metadata.load_guide_url` | PDF link for full load |
| 51 | Código del producto | `packages.sku_items[].sku` | Product code |
| 52 | Nombre del producto | `packages.sku_items[].description` | Product name |
| 56 | CARTONID | `packages.label` | **Scannable barcode** (e.g., DD033408164) |

**Ignored columns:** Cantidad despachada (always "0 / 1", useless), AGRUPACIONES DE TRANSPORTES (always "Musan Ltda"), and ~45 other columns preserved only in `raw_data`.

**Data pattern:** Multiple rows per order (one row per carton/product). Example: order 67810990 has 2 rows → 1 order + 2 packages. Group by `Orden`, aggregate cartons into `packages` array.

## Tasks / Subtasks

### Part 1: Playwright Connector (Worker)

- [x] Task 1: Create `apps/worker/src/connectors/beetrack.ts` (AC: 1, 6, 7)
  - [x] 1.1: Implement `executeBeetrack(job: JobRecord): Promise<JobResult>`
  - [x] 1.2: Load Paris `connector_config` from DB (query `tenant_clients` by `client_id`)
  - [x] 1.3: Decrypt credentials using `ENCRYPTION_KEY` env var
  - [x] 1.4: Launch Playwright headless Chromium with minimal memory flags
  - [x] 1.5: Login to Beetrack (URL from `connector_config.beetrack_url`)
  - [x] 1.6: Navigate to report/export section, set today's date filter
  - [x] 1.7: Trigger "send report to email" with configured inbox address
  - [x] 1.8: Close browser in `finally` block
  - [x] 1.9: On error: capture screenshot → upload to Supabase Storage → include path in error result

- [x] Task 2: Register beetrack connector in `apps/worker/src/connectors/index.ts` (AC: 1)
  - [x] 2.1: Import `executeBeetrack` and add to `connectors` registry as `browser` type
  - [x] 2.2: Remove placeholder `throw new Error('Browser connector not implemented')`

- [x] Task 3: Update cron schedule for 4x daily (AC: 1)
  - [x] 3.1: Change cron from `0 6 * * *` to create 4 jobs at 07:00, 10:00, 13:00, 16:00 CLT
  - [x] 3.2: Update duplicate detection to allow multiple jobs per day (check by `scheduled_at` window, not just date)

- [x] Task 4: Install Playwright dependency (AC: 1)
  - [x] 4.1: Add `playwright` to `apps/worker/package.json` (Chromium already on VPS from Story 2.3)
  - [x] 4.2: Verify Chromium binary path on VPS, configure `PLAYWRIGHT_BROWSERS_PATH` if needed

- [x] Task 5: Implement credential encryption/decryption utility (AC: 1, 6)
  - [x] 5.1: Create `apps/worker/src/crypto.ts` — `decryptField(encryptedValue: string): string`
  - [x] 5.2: Uses AES-256-GCM with `ENCRYPTION_KEY` from VPS env
  - [x] 5.3: Handle `ENCRYPTED:` prefix convention from `connector_config`

### Part 2: n8n Workflow

- [x] Task 6: Create n8n workflow `beetrack-excel-import` (AC: 2, 3, 4, 5)
  - [x] 6.1: IMAP Trigger — same inbox as Easy, different filter (Beetrack sender/subject)
  - [x] 6.2: Filter Email node — match Beetrack sender address and subject pattern
  - [x] 6.3: Extract Link node (Code) — parse email HTML body, extract `view.officeapps.live.com` URL
  - [x] 6.4: Resolve Download URL node (Code) — transform Office Online view URL to direct download URL
  - [x] 6.5: HTTP Request node — download the .xlsx file from resolved URL
  - [x] 6.6: Extract Spreadsheet node — parse .xlsx (sheet "DispatchTrack", `headerRow: true`)
  - [x] 6.7: Map & Validate node (Code) — column mapping per table above, group by `Orden`, create orders + packages arrays
  - [x] 6.8: Create Job Record — POST to Supabase `jobs` table
  - [x] 6.9: UPSERT Orders — POST to Supabase `orders?on_conflict=operator_id,order_number` with `Prefer: resolution=merge-duplicates`
  - [x] 6.10: Link Packages — map `order_number` → `order_id` from upsert response
  - [x] 6.11: UPSERT Packages — POST to Supabase `packages` (conflict on `operator_id, label`)
  - [x] 6.12: Complete Job — PATCH job record with results summary
  - [x] 6.13: Error Trigger path — mark job failed, log to Sentry

- [x] Task 7: Export n8n workflow JSON (AC: 2)
  - [x] 7.1: Export sanitized workflow to `apps/worker/n8n/workflows/beetrack-excel-import.json`
  - [x] 7.2: Replace secrets with `<SUPABASE_SERVICE_ROLE_KEY>` placeholder (same pattern as Easy)

### Part 3: Configuration & Integration

- [x] Task 8: Update Paris `connector_config` in seed migration (AC: 1, 2)
  - [x] 8.1: Add `report_email_to` field (IMAP inbox address for report delivery)
  - [x] 8.2: Add `email_filter_from` and `email_filter_subject` fields for n8n IMAP filtering
  - [x] 8.3: Update `export_format` from `"csv"` to `"xlsx"`
  - [x] 8.4: Create new migration file (do NOT modify existing migration)

- [x] Task 9: Add env vars to `.env.example` (AC: 1)
  - [x] 9.1: `ENCRYPTION_KEY` — AES-256 key for credential decryption
  - [x] 9.2: `PLAYWRIGHT_BROWSERS_PATH` — Chromium binary location (if not default)

- [x] Task 10: Write tests (AC: all)
  - [x] 10.1: Unit test `beetrack.ts` connector — mock Playwright, verify login flow, screenshot on error
  - [x] 10.2: Unit test `crypto.ts` — encrypt/decrypt round-trip, handle invalid key, handle malformed input
  - [x] 10.3: Unit test n8n Map & Validate logic — use sample Excel data from actual Beetrack export (21 rows, 65 cols)
  - [x] 10.4: Integration test — verify cron creates 4 jobs for browser clients

## Dev Notes

### Critical Architecture Decisions

- **No OpenClaw, no Groq, no LLM.** Pure Playwright + n8n. The Beetrack UI is stable enterprise software — CSS selectors are sufficient. LLM browser agents add complexity with no benefit for a single-site scrape.
- **Separate n8n workflow from Easy.** Different Excel structure, different sender filters, independent failure isolation. Clone the Easy workflow pattern but adapt.
- **Temporary solution.** This entire Playwright trigger becomes unnecessary once Paris provisions API keys. Design for easy removal.

### Existing Infrastructure (Already Built)

| Component | Status | Location | Story |
|---|---|---|---|
| Worker poller (poll loop, job claim, retry) | Done | `apps/worker/src/poller.ts` | 2.7 |
| Cron scheduler (creates browser jobs) | Done | `apps/worker/src/cron.ts` | 2.7 |
| Connector registry | Done | `apps/worker/src/connectors/index.ts` | 2.7 |
| Connector types (`JobRecord`, `JobResult`) | Done | `apps/worker/src/connectors/types.ts` | 2.7 |
| `csv-email.ts` connector (reference pattern) | Done | `apps/worker/src/connectors/csv-email.ts` | 2.5 |
| Easy CSV n8n workflow (reference pattern) | Done | `apps/worker/n8n/workflows/easy-csv-import.json` | 2.5 |
| DB schema (orders, packages, jobs, tenant_clients, raw_files) | Done | Supabase migrations | 2.1, 2.4 |
| Paris tenant_client seed (slug: "paris", type: "browser") | Done | `20260223000001_...sql` | 2.4 |
| VPS with Chromium installed | Done | 187.77.48.107 | 2.3 |
| Deploy pipeline (GitHub Actions → SSH → deploy.sh) | Done | `.github/workflows/` | 2.3 |

### Key IDs (Musan / Paris)

- **Musan `operator_id`:** `92dc5797-047d-458d-bbdb-63f18c0dd1e7`
- **Easy `client_id`:** `acf3d096-1ff6-4157-9b69-cab6e6a5789f`
- **Paris `client_id`:** Query from `tenant_clients WHERE slug = 'paris' AND operator_id = '92dc5797...'`
- **Easy CSV n8n workflow ID:** `Cj79hRWYsXPuHfHY`

### Beetrack Excel Specifics (from actual sample — 2026-02-25)

- **Sheet name:** "DispatchTrack"
- **Columns:** 65 (most are internal Beetrack/Paris fields — only ~17 mapped, rest preserved in `raw_data`)
- **Encoding:** UTF-8 (NOT Latin-1 like Easy)
- **Row 0:** Headers
- **Rows 1+:** Data (one row per carton/product, NOT per order)
- **Grouping key:** `Orden` column — multiple rows share the same `Orden` value when an order has multiple cartons
- **Sample size:** 21 data rows → 18 unique orders, some with multiple cartons (e.g., order 67810988 has 2 cartons, order 67810990 has 2 cartons)
- **All orders show `AGRUPACIONES DE TRANSPORTES = "Musan Ltda"`** — confirms this is Musan-specific data

### Lessons from Story 2.5 (Easy CSV)

- n8n Code nodes run in **sandbox** — `fetch()` is NOT available. Use HTTP Request nodes for all external calls.
- n8n binary data uses `filesystem-v2` — not base64. Use native nodes (Compression, Extract from File) for binary operations.
- n8n execution retry replays with the **workflow snapshot from original execution**, not the current version. To test changes, deactivate/reactivate + fresh trigger.
- XLSX Extract with `headerRow: false` outputs `item.json.row` as arrays. With `headerRow: true` outputs objects keyed by header names — **use `headerRow: true` for Beetrack** since row 0 is the actual header (unlike Easy which had a metadata row 0).
- Phone number normalization is critical — Chilean phones can appear as `+56XXXXXXXXX`, `56XXXXXXXXX`, `9XXXXXXXX`, or just `XXXXXXXXX`.
- `ON CONFLICT` upsert with `Prefer: resolution=merge-duplicates` works correctly for both INSERT and UPDATE cases.

### Office Online Link Resolution

The email contains a `view.officeapps.live.com` link. To download the actual .xlsx:
- Parse the URL from the email HTML body
- The Office Online URL typically embeds the original file URL as a query parameter (e.g., `src=` or `wdOrigin=`)
- Extract and decode the source file URL
- HTTP GET the source URL to download the .xlsx binary
- **Important:** Test this with an actual Beetrack email during implementation — the URL structure may vary

### Cron Schedule Change

Current cron (`cron.ts` line 8): `0 6 * * *` — creates ONE job at 06:00 CLT.
New requirement: 4 jobs at 07:00, 10:00, 13:00, 16:00 CLT.

Options:
1. **Multiple cron expressions:** `0 7,10,13,16 * * *` (simplest)
2. **Single cron at 06:00 that creates 4 scheduled jobs** with `scheduled_at` for each time slot

Option 1 is cleaner. Update the cron schedule and adjust duplicate detection to check by `scheduled_at` time window (not just date).

### Project Structure Notes

```
apps/worker/
├── src/
│   ├── connectors/
│   │   ├── types.ts          # Existing — no changes needed
│   │   ├── index.ts          # Update: register beetrack connector
│   │   ├── csv-email.ts      # Existing — reference pattern
│   │   └── beetrack.ts       # NEW — Playwright trigger connector
│   ├── crypto.ts             # NEW — AES-256-GCM decrypt utility
│   ├── cron.ts               # Update: 4x daily schedule
│   ├── poller.ts             # Existing — no changes needed
│   ├── db.ts                 # Existing — no changes needed
│   ├── logger.ts             # Existing — no changes needed
│   └── index.ts              # Existing — no changes needed
├── n8n/workflows/
│   ├── easy-csv-import.json  # Existing — reference pattern
│   └── beetrack-excel-import.json  # NEW — n8n workflow export
└── package.json              # Update: add playwright dependency
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.6] — Original story spec (OpenClaw approach — superseded)
- [Source: _bmad-output/planning-artifacts/architecture.md] — VPS specs, tech stack, naming conventions
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-02-18.md] — Epic 2 expansion rationale
- [Source: apps/worker/src/connectors/csv-email.ts] — Reference connector pattern
- [Source: apps/worker/n8n/workflows/easy-csv-import.json] — Reference n8n workflow
- [Source: apps/frontend/supabase/migrations/20260223000001_create_automation_worker_schema.sql] — Paris seed data, connector_config structure
- [Source: apps/frontend/supabase/migrations/20260217000003_create_orders_table.sql] — Orders + packages schema
- [Source: Beetrack Excel sample — 68900-32ca692c3143f296e73d00b89a72ab45.xlsx] — Actual column structure (21 rows, 65 cols, DispatchTrack sheet)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- vi.mock hoisting issue: fixed by using `vi.hoisted()` for playwright/crypto mocks in beetrack.test.ts

### Completion Notes List
- **Task 5 (crypto.ts):** AES-256-GCM encrypt/decrypt with `ENCRYPTED:` prefix convention. 5 tests (round-trip, plain passthrough, invalid data, missing key, random IV).
- **Task 1 (beetrack.ts):** Full Playwright connector — DB config load, credential decrypt, headless Chromium with minimal flags, login flow, report trigger, screenshot-on-error with Supabase Storage upload, browser close in `finally`. 9 tests.
- **Task 2 (index.ts):** Registered `executeBeetrack` as `browser` connector, removed placeholder stub. Updated index.test.ts.
- **Task 3 (cron.ts):** Changed schedule from `0 6 * * *` to `0 7,10,13,16 * * *`. Duplicate detection uses ±30min `scheduled_at` window instead of daily date range, allowing 4 jobs/day. 5 tests updated.
- **Task 4 (playwright dep):** Added `playwright` to package.json dependencies. `PLAYWRIGHT_BROWSERS_PATH` added to .env.example.
- **Task 6-7 (n8n workflow):** Created 16-node workflow: IMAP trigger → filter Beetrack emails → extract Office Online link → resolve download URL → download .xlsx → upload raw file to Supabase Storage → extract DispatchTrack sheet (headerRow: true) → Map & Validate (group by Orden, Chilean phone normalization, full column mapping per spec) → create job → upsert orders → link packages → upsert packages → complete job. Error trigger path for failure handling. Sanitized with `<SUPABASE_SERVICE_ROLE_KEY>` placeholders.
- **Task 8 (migration):** New migration `20260227000001_update_paris_connector_config.sql` — adds `report_email_to`, `email_filter_from`, `email_filter_subject`; changes `export_format` to `xlsx`; renames credentials to `beetrack_username`/`beetrack_password`.
- **Task 9 (.env.example):** Replaced Groq API section with `PLAYWRIGHT_BROWSERS_PATH`. `ENCRYPTION_KEY` was already present.
- **Task 10 (tests):** 3 test files: beetrack.test.ts (9), crypto.test.ts (6), beetrack-map.test.ts (7) + updated cron.test.ts (5) and index.test.ts (2). Total: 45 tests, all passing.

### File List
- `apps/worker/src/connectors/beetrack.ts` — NEW: Playwright browser connector
- `apps/worker/src/connectors/beetrack.test.ts` — NEW: 9 unit tests
- `apps/worker/src/connectors/beetrack-map.test.ts` — NEW: 7 unit tests for mapping logic
- `apps/worker/src/crypto.ts` — NEW: AES-256-GCM encrypt/decrypt utility
- `apps/worker/src/crypto.test.ts` — NEW: 6 unit tests
- `apps/worker/src/connectors/index.ts` — MODIFIED: registered beetrack connector
- `apps/worker/src/connectors/index.test.ts` — MODIFIED: updated browser connector test
- `apps/worker/src/cron.ts` — MODIFIED: 4x daily schedule, slot-based dedup
- `apps/worker/src/cron.test.ts` — MODIFIED: updated for new schedule/function name
- `apps/worker/.env.example` — MODIFIED: replaced Groq with Playwright browser path
- `apps/worker/package.json` — MODIFIED: added playwright dependency
- `apps/worker/package-lock.json` — MODIFIED: lockfile update from playwright install
- `apps/worker/n8n/workflows/beetrack-excel-import.json` — NEW: n8n workflow (sanitized)
- `apps/frontend/supabase/migrations/20260227000001_update_paris_connector_config.sql` — NEW: Paris config migration

## Senior Developer Review (AI)

**Review Date:** 2026-02-27
**Review Outcome:** Approve (after fixes)
**Reviewer Model:** Claude Opus 4.6

### Action Items (8 total: 3H, 4M, 1L — all fixed)

- [x] **[H1]** `crypto.ts:43` — `decipher.update()` returns Buffer without encoding, silent data corruption for multi-block plaintexts. Fixed: added `undefined, 'utf8'` encoding param.
- [x] **[H2]** `crypto.ts:12` — No validation of ENCRYPTION_KEY length, could produce wrong cipher. Fixed: added 32-byte length check.
- [x] **[H3]** `beetrack.ts:45-67` — Hardcoded CSS selectors are unvalidated guesses. Fixed: added TODO comment documenting this as temporary until API migration.
- [x] **[M1]** `beetrack.ts:93` — Screenshot upload doesn't check `response.ok`. Fixed: added status check with warning log on failure.
- [x] **[M2]** `cron.ts:22-28` — Dedup ±30min window has race condition if cron fires late. Fixed: changed to fixed time-slot approach using nearest scheduled hour.
- [x] **[M3]** `beetrack-map.test.ts` — Mapping logic duplicated between test and n8n workflow with no documentation. Fixed: added prominent comment explaining the duplication.
- [x] **[M4]** Migration `20260227000001` — Missing `operator_id` filter in WHERE clause. Fixed: added `AND operator_id = (SELECT id FROM operators WHERE slug = 'transportes-musan')`.
- [x] **[L1]** `package-lock.json` modified but not in File List. Fixed: added to File List.
