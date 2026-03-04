# Story 3A.1: Populate delivery_attempts from DispatchTrack Order Status

Status: ready-for-dev

## Dependencies

Depends on: Epic 2 Stories 2.5/2.6 (order ingestion — done), Epic 3 Story 3.1 (delivery_attempts table — done). No story dependencies within Epic 3A.

## Story

As an operations manager,
I want delivery outcomes from DispatchTrack to flow into the `delivery_attempts` table,
so that the dashboard metrics calculation has real data and I can see SLA, FADR, and failure analysis.

## Acceptance Criteria

1. **AC1: Estado-to-Enum Mapping** — The n8n Beetrack workflow maps DispatchTrack `Estado` (Spanish string from XLSX) to `delivery_attempt_status_enum` values using a configurable translation table:

   | `Estado` (XLSX) | `delivery_attempt_status_enum` | `failure_reason` |
   |---|---|---|
   | `'Entregado'` | `'success'` | NULL |
   | `'Entregado con novedad'` | `'success'` | NULL |
   | `'No Entregado'` | `'failed'` | `'No Entregado'` |
   | `'Fallido'` | `'failed'` | `'Fallido'` |
   | `'Ausente'` | `'failed'` | `'Ausente'` |
   | `'Dirección incorrecta'` | `'failed'` | `'Dirección incorrecta'` |
   | `'Rechazado'` | `'failed'` | `'Rechazado'` |
   | `'Devuelto'` | `'returned'` | `'Devuelto'` |
   | `'Devolución'` | `'returned'` | `'Devolución'` |
   | Non-terminal (`'Ruta troncal'`, `'Reagendado'`, etc.) | **SKIP** | — |
   | Unknown/unmapped values | **SKIP + log warning** | — |

   Note: The exact list of `Estado` values must be verified against real DispatchTrack XLSX exports. The mapping should be easy to extend (a simple object/dictionary, not deeply nested logic).

2. **AC2: Delivery Attempts Population** — For each order with a terminal `Estado`, a `delivery_attempts` row is created/updated with:
   - `operator_id`: from the order (hardcoded `92dc5797-047d-458d-bbdb-63f18c0dd1e7` for Musan)
   - `order_id`: UUID from the UPSERT Orders response (`Prefer: return=representation` already returns `id`)
   - `attempt_number`: `1` (first attempt — the XLSX represents current dispatch, not historical re-attempts)
   - `status`: mapped enum value from AC1
   - `failure_reason`: mapped string from AC1 (NULL for success)
   - `attempted_at`: full datetime from `Fecha estimada` column (format `YYYY-MM-DD HH:MM:SS`) — preserve full timestamp, do NOT strip to date-only
   - `driver_id`: NULL (not available in XLSX)

3. **AC3: Idempotency via Unique Index** — A Supabase migration adds a unique index:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_attempts_unique_attempt
   ON delivery_attempts(operator_id, order_id, attempt_number)
   WHERE deleted_at IS NULL;
   ```
   The UPSERT uses `?on_conflict=operator_id,order_id,attempt_number` with `Prefer: resolution=merge-duplicates,return=representation` so re-importing the same XLSX does NOT create duplicate rows — it updates the existing attempt.

4. **AC4: n8n Workflow Enhancement** — Two new nodes are added to the existing `beetrack-excel-import` workflow (ID: `5hQa3YQFOwfkWE4V`):

   **Node 1: "Map Delivery Attempts"** (Code node, inserted after "UPSERT Orders" node `bt-upsert-orders`)
   - Input: UPSERT Orders response array (each item has `id`, `order_number`, `status_detail`, `delivery_date`, `operator_id`)
   - Logic: For each order, look up `status_detail` in the Estado mapping. If terminal → build `delivery_attempts` record. If non-terminal → skip.
   - Output: `{ attempts: [...], skipped_count: N, mapped_count: N }`

   **Node 2: "UPSERT Delivery Attempts"** (HTTP Request node, after "Map Delivery Attempts")
   - `POST {{$env.SUPABASE_URL}}/rest/v1/delivery_attempts?on_conflict=operator_id,order_id,attempt_number`
   - Headers: `apikey`, `Authorization: Bearer`, `Content-Type: application/json`, `Prefer: resolution=merge-duplicates,return=representation`
   - Body: `{{ $json.attempts }}`
   - Skip if `attempts` array is empty (no terminal statuses in this batch)

5. **AC5: Workflow Node Wiring** — The new nodes are wired into the existing flow:
   ```
   UPSERT Orders → Map Delivery Attempts → UPSERT Delivery Attempts → Link Packages → ...
   ```
   The "Link Packages" node currently connects directly from "UPSERT Orders" — it must be rewired to connect from "UPSERT Delivery Attempts" (or in parallel, as long as both get the UPSERT Orders output). The delivery attempts data does NOT block package linking.

6. **AC6: Job Summary Extension** — The "Prepare Summary" node (`bt-prepare-summary`) is extended to include:
   - `delivery_attempts_upserted`: count of attempts created/updated
   - `delivery_attempts_skipped`: count of non-terminal statuses skipped
   These are logged in the `jobs` table `result` JSONB for observability.

7. **AC7: Error Handling** — If the UPSERT Delivery Attempts call fails:
   - The error is caught and logged (does NOT fail the entire workflow)
   - Orders and packages are still upserted successfully
   - The job summary includes `delivery_attempts_error: true` with the error message
   - Rationale: delivery_attempts population is additive — losing it for one run is recoverable on the next import

## Tasks / Subtasks

- [x] Task 1: Create Supabase migration for unique index (AC: #3)
  - [x] 1.1: Write migration `20260303000001_add_delivery_attempts_unique_index.sql`
  - [x] 1.2: Add unique partial index on `(operator_id, order_id, attempt_number) WHERE deleted_at IS NULL`
  - [x] 1.3: Test migration applies cleanly on empty table
  - [x] 1.4: Verify ON CONFLICT works with the partial unique index via REST API

- [x] Task 2: Add "Map Delivery Attempts" Code node to n8n workflow (AC: #1, #2, #4)
  - [x] 2.1: Define the Estado-to-enum mapping object
  - [x] 2.2: Write the Code node JS: iterate UPSERT Orders response, map terminal statuses, build attempts array
  - [x] 2.3: Handle `Fecha estimada` datetime parsing (preserve full timestamp for `attempted_at`)
  - [x] 2.4: Track `mapped_count` and `skipped_count` for summary
  - [x] 2.5: Log warnings for unmapped Estado values

- [x] Task 3: Add "UPSERT Delivery Attempts" HTTP Request node (AC: #4, #5)
  - [x] 3.1: Configure HTTP Request node with Supabase REST endpoint
  - [x] 3.2: Set conflict resolution headers for idempotent upsert
  - [x] 3.3: Wire into workflow: after Map Delivery Attempts, before or parallel to Link Packages
  - [x] 3.4: Handle empty attempts array (skip HTTP call)

- [x] Task 4: Extend job summary (AC: #6)
  - [x] 4.1: Update "Prepare Summary" node to include delivery_attempts counts
  - [ ] 4.2: Verify job record shows new fields in `result` JSONB

- [x] Task 5: Error handling (AC: #7)
  - [x] 5.1: Add error output on UPSERT Delivery Attempts node (`continueOnFail: true`)
  - [x] 5.2: Ensure workflow continues to Link Packages even on failure (Link Packages reads from `$('UPSERT Orders').all()` directly)
  - [x] 5.3: Log error details in job summary (Prepare Summary try/catch on UPSERT Delivery Attempts output)

- [ ] Task 6: End-to-end verification — n8n/XLSX path (Paris orders)
  - [ ] 6.1: Trigger a fresh DispatchTrack export with real data (Paris account)
  - [ ] 6.2: Verify `delivery_attempts` table has rows after n8n workflow completes
  - [ ] 6.3: Re-run the same import and verify idempotency (no duplicate rows)

- [ ] Task 7: End-to-end verification — Musan DispatchTrack webhook path
  - [x] 7.1: Confirm `beetrack-webhook` Edge Function is deployed and JWT verification is disabled
  - [ ] 7.2: Wait for a real terminal delivery event (status 2/3/4) from Musan's DispatchTrack account
  - [ ] 7.3: Verify the matching order exists in the `orders` table (ingested via n8n)
  - [ ] 7.4: Verify a `delivery_attempts` row is created with correct `status`, `failure_reason`, and `attempted_at`
  - [ ] 7.5: Re-send the same webhook event and verify idempotency (row updated, not duplicated)

- [ ] Task 8: Metrics and dashboard verification (both paths)
  - [ ] 8.1: Verify `calculate_daily_metrics` cron produces non-zero metrics from the new data
  - [ ] 8.2: Verify dashboard displays the calculated metrics

## Dev Notes

### Critical Architecture Constraints

- **n8n Code nodes run in a sandbox** — `fetch()` is NOT available. All HTTP calls must use HTTP Request nodes, not Code node fetch. [Source: MEMORY.md]
- **n8n binary data uses `filesystem-v2`** — not base64. Use native nodes for binary ops. [Source: MEMORY.md]
- **n8n execution retry replays with the workflow snapshot from original execution**, not the current version. To test changes, deactivate/reactivate + fresh trigger. [Source: MEMORY.md]
- **n8n MCP partial update**: use `nodeId` not `name` for updateNode operations. [Source: MEMORY.md]

### Key IDs

- Musan `operator_id`: `92dc5797-047d-458d-bbdb-63f18c0dd1e7`
- Paris `tenant_client_id`: `acf3d096-1ff6-4157-9b69-cab6e6a5789f`
- n8n workflow ID: `5hQa3YQFOwfkWE4V` (beetrack-excel-import)
- Supabase URL: read from `$env.SUPABASE_URL`
- Supabase service key: read from `$env.SUPABASE_SERVICE_KEY`

### Existing Workflow Node IDs (for n8n MCP partial updates)

Reference the existing workflow JSON to get exact node IDs. The critical nodes are:
- `bt-upsert-orders` — UPSERT Orders (this is where the new nodes connect FROM)
- `bt-link-packages` — Link Packages (this currently connects FROM bt-upsert-orders — must be rewired)
- `bt-prepare-summary` — Prepare Summary (must be updated to include new metrics)
- The node names in the workflow use the `name` field, but for n8n MCP `updateNode` operations, use the `id` field.

### Data Model Context

**`delivery_attempts` table expects:**
```
operator_id     UUID (FK operators)
order_id        UUID (FK orders) — NOT order_number string
attempt_number  INT — always 1 for this import
status          ENUM: 'success' | 'failed' | 'returned'
failure_reason  VARCHAR(100) — NULL for success
attempted_at    TIMESTAMPTZ — from Fecha estimada
driver_id       UUID — NULL (not in XLSX)
```

**`calculate_daily_metrics` reads from `delivery_attempts`:**
- `delivered` = orders with at least one `status='success'` attempt
- `first_attempt_deliveries` (FADR) = orders with `status='success'` AND `attempt_number=1`
- `failed_deliveries` = orders with `status='failed'` AND NO `status='success'` attempt
- `get_failure_reasons()` reads `failure_reason` WHERE `status='failed'`

**The UPSERT Orders response** (`Prefer: return=representation`) returns full order objects including the `id` UUID — this is the `order_id` needed for `delivery_attempts`.

### Estado Value Discovery

The exact set of `Estado` values in real DispatchTrack exports should be verified by:
1. Querying existing orders: `SELECT DISTINCT status_detail FROM orders WHERE retailer_name = 'Paris' ORDER BY status_detail`
2. Checking a recent XLSX in Supabase Storage: `raw-files/musan/paris/YYYY-MM-DD/beetrack_export_*.xlsx`

The mapping in AC1 is a best-effort starting set. Unknown values are safely skipped (not failed).

### Previous Story Intelligence

**From Epic 2 Story 2.6 (Paris/Beetrack Browser Connector):**
- The browser connector (`apps/worker/src/connectors/beetrack.ts`) triggers the XLSX export email — it does NOT process it
- The n8n IMAP trigger picks up the email, downloads the XLSX, and processes it
- The existing "Map & Validate" Code node already parses `Estado` into `status_detail` — but ONLY stores it as a raw string
- The `parseDate()` helper strips time from `Fecha estimada` — for `attempted_at`, we need the FULL datetime

**From Epic 2 Story 2.5 (Easy CSV):**
- The UPSERT pattern `?on_conflict=operator_id,order_number` with `Prefer: resolution=merge-duplicates` is the established pattern
- Same pattern applies for `delivery_attempts` but with different conflict columns

**From Epic 3 Story 3.1 (Metrics Tables):**
- The `delivery_attempt_status_enum` was created with exactly three values: `success`, `failed`, `returned`
- The `calculate_daily_metrics` function was designed to read from `delivery_attempts` — it just has no data yet
- The cron runs nightly at 2 AM UTC (22:00-23:00 Chile time)

### n8n Implementation Strategy

**Option A (RECOMMENDED): Modify existing workflow via n8n MCP**
- Use `n8n_update_partial_workflow` to add two new nodes and rewire connections
- Faster, preserves existing workflow history and versioning

**Option B: Export/modify/reimport workflow JSON**
- Edit `beetrack-excel-import.json` locally, redeploy via n8n API
- More control but loses n8n version history

### Project Structure Notes

- Migration file: `apps/frontend/supabase/migrations/20260303000001_add_delivery_attempts_unique_index.sql`
- n8n workflow: modified in-place via MCP or JSON edit at `apps/worker/n8n/workflows/beetrack-excel-import.json`
- No frontend changes in this story
- No Vitest test changes (n8n workflows are not testable in CI — known limitation from Epic 2 retro)

### References

- [Source: apps/worker/n8n/workflows/beetrack-excel-import.json] — existing n8n workflow
- [Source: apps/frontend/supabase/migrations/20260224000001_create_performance_metrics_tables.sql] — delivery_attempts schema
- [Source: apps/frontend/supabase/migrations/20260224000002_create_metrics_functions.sql] — calculate_daily_metrics function
- [Source: apps/worker/src/connectors/beetrack-map.test.ts] — XLSX column names and Estado values
- [Source: _bmad-output/implementation-artifacts/3-1-create-performance-metrics-tables-and-calculation-logic.md] — Story 3.1 context
- [Source: _bmad-output/implementation-artifacts/epic-2-retro-2026-03-02.md] — n8n limitations and patterns
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-03-03.md] — Course correction context
- [Source: _bmad-output/planning-artifacts/architecture.md] — System architecture

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

- n8n MCP: `updateNode` requires `updates` wrapper (not direct `parameters`), and `removeConnection`/`addConnection` take flat `source`/`target` (not nested in `connection` object). Atomic rollback confirmed working.
- Task 1.4 FINDING: PostgREST `?on_conflict=` does NOT work with partial unique indexes. Added separate migration `20260304000002_add_delivery_attempts_unique_constraint.sql` with a plain `UNIQUE (operator_id, order_id, attempt_number)` constraint. Verified idempotency via REST API: 2 upserts → 1 row, `attempted_at` updated correctly.
- Task 7.1: beetrack-webhook 401 response includes `x-deno-execution-id` → function IS executing (JWT disabled). 401 is from function's own `BEETRACK_WEBHOOK_SECRET` auth check — expected behavior.
- beetrack-excel-import workflow was previously reverted (commit 28a5e52). Re-added `bt-map-delivery-attempts` + `bt-upsert-delivery-attempts` nodes via MCP (8 operations atomically applied 2026-03-04).

### Completion Notes List

**Tasks 1-5 complete (2026-03-03), Tasks 1.3/1.4/7.1 verified (2026-03-04):**

- **Task 1**: Migration `20260303000001_add_delivery_attempts_unique_index.sql` written with partial unique index on `(operator_id, order_id, attempt_number) WHERE deleted_at IS NULL`. Requires `supabase db push` to apply; 1.3/1.4 are live-verification steps.

- **Tasks 2-5**: n8n workflow `5hQa3YQFOwfkWE4V` updated via MCP (12 operations atomically applied):
  - Added `bt-map-delivery-attempts` Code node at [1980,0]: ESTADO_MAP with 9 terminal mappings + NON_TERMINAL skip set + `console.warn` for unknown values. Reads `raw_data['Fecha estimada']` for full datetime (not stripped `delivery_date`).
  - Added `bt-upsert-delivery-attempts` HTTP Request node at [2200,0]: POST to `/rest/v1/delivery_attempts?on_conflict=operator_id,order_id,attempt_number` with `Prefer: resolution=merge-duplicates,return=representation`. `continueOnFail: true` for AC7.
  - Rewired: UPSERT Orders → Map Delivery Attempts → UPSERT Delivery Attempts → Link Packages.
  - `bt-link-packages` updated to use `$('UPSERT Orders').all()` instead of `$input.all()` — decouples from UPSERT Delivery Attempts failure.
  - `bt-prepare-summary` updated with `delivery_attempts_upserted`, `delivery_attempts_skipped`, `delivery_attempts_error` fields in `result` JSONB.
  - Local JSON `beetrack-excel-import.json` synced with all changes.

**Task 1.3**: Migration `20260303000001` applied cleanly to production DB. Additional migration `20260304000002_add_delivery_attempts_unique_constraint.sql` added — plain unique constraint required because PostgREST ON CONFLICT doesn't support partial indexes.

**Task 1.4**: Verified via REST API — POST to `/rest/v1/delivery_attempts?on_conflict=operator_id,order_id,attempt_number` with 2 identical upserts produced exactly 1 row with updated `attempted_at`.

**Task 6 (Paris XLSX E2E)**: beetrack-excel-import workflow re-augmented with `bt-map-delivery-attempts` + `bt-upsert-delivery-attempts` nodes (8 MCP operations atomically applied). Previous revert (commit 28a5e52) was undone. Pending: live DispatchTrack export trigger.

**Task 7.1**: beetrack-webhook confirmed deployed and JWT-disabled. `x-deno-execution-id` header in 401 response confirms function executes; 401 is from function's own BEETRACK_WEBHOOK_SECRET auth (correct behavior).

**Tasks 7.2–7.5, 6.2–6.3, 8**: Require real DispatchTrack events/exports.

### File List

- `apps/frontend/supabase/migrations/20260303000001_add_delivery_attempts_unique_index.sql` (new)
- `apps/frontend/supabase/migrations/20260304000002_add_delivery_attempts_unique_constraint.sql` (new — plain unique constraint for PostgREST ON CONFLICT compatibility)
- `apps/frontend/supabase/functions/beetrack-webhook/index.ts` (new — Musan webhook Edge Function)
- `apps/worker/n8n/workflows/beetrack-excel-import.json` (modified — bt-map-delivery-attempts and bt-upsert-delivery-attempts nodes added, bt-link-packages and bt-prepare-summary updated)
