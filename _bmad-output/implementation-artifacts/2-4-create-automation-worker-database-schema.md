# Story 2.4: Create Automation Worker Database Schema

**Epic:** 2 - Order Data Ingestion & Automation Worker
**Story ID:** 2.4
**Status:** done
**Created:** 2026-02-23

**Note:** Scope changed 2026-02-18 via Sprint Change Proposal. Original "Manual Order Entry Form" story moved to 2.8.

---

## Story

**As an** Aureon DevOps engineer,
**I want to** create the database tables for the automation worker's connector framework and job queue,
**So that** connectors can be configured per tenant/client and jobs can be tracked and orchestrated.

---

## Acceptance Criteria

### tenant_clients Table

```gherkin
Given The existing operators table serves as the tenant identity
When I run the migration
Then The `tenant_clients` table exists with fields:
  - id (UUID PK, gen_random_uuid())
  - operator_id (UUID FK to operators, NOT NULL)
  - name (VARCHAR(255), NOT NULL)
  - slug (VARCHAR(100), NOT NULL)
  - connector_type (ENUM: 'csv_email', 'api', 'browser', NOT NULL)
  - connector_config (JSONB, NOT NULL, default '{}')
  - is_active (BOOLEAN, NOT NULL, default true)
  - created_at (TIMESTAMPTZ, NOT NULL, default NOW())
  - updated_at (TIMESTAMPTZ, NOT NULL, default NOW())
And Unique constraint on (operator_id, slug) prevents duplicate client slugs per operator
And RLS policy enforces tenant isolation via operator_id = public.get_operator_id()
```

### jobs Table

```gherkin
Given The tenant_clients table exists
When I run the migration
Then The `jobs` table exists with fields:
  - id (UUID PK)
  - operator_id (UUID FK to operators, NOT NULL)
  - client_id (UUID FK to tenant_clients, NOT NULL)
  - job_type (ENUM: 'csv_email', 'api', 'browser', NOT NULL)
  - status (ENUM: 'pending', 'running', 'completed', 'failed', 'retrying', NOT NULL, default 'pending')
  - priority (INT, NOT NULL, default 5)
  - scheduled_at (TIMESTAMPTZ, NOT NULL, default NOW())
  - started_at (TIMESTAMPTZ, nullable)
  - completed_at (TIMESTAMPTZ, nullable)
  - result (JSONB, nullable)
  - error_message (TEXT, nullable)
  - retry_count (INT, NOT NULL, default 0)
  - max_retries (INT, NOT NULL, default 3)
  - created_at (TIMESTAMPTZ, NOT NULL, default NOW())
And Index on jobs (status, priority DESC, scheduled_at) WHERE status IN ('pending', 'retrying') for efficient worker polling
And RLS policy enforces tenant isolation via operator_id = public.get_operator_id()
```

### raw_files Table

```gherkin
Given The jobs table exists
When I run the migration
Then The `raw_files` table exists with fields:
  - id (UUID PK)
  - operator_id (UUID FK to operators, NOT NULL)
  - client_id (UUID FK to tenant_clients, NOT NULL)
  - job_id (UUID FK to jobs, NOT NULL)
  - file_name (VARCHAR(500), NOT NULL)
  - storage_path (VARCHAR(1000), NOT NULL)
  - file_size_bytes (INT, nullable)
  - row_count (INT, nullable)
  - received_at (TIMESTAMPTZ, NOT NULL, default NOW())
And RLS policy enforces tenant isolation via operator_id = public.get_operator_id()
```

### orders Table Extensions

```gherkin
Given The orders table exists (from Story 2.1)
When I run the migration
Then The orders table has new nullable columns added (ADD COLUMN IF NOT EXISTS):
  - external_load_id (VARCHAR(100) nullable)
  - recipient_region (VARCHAR(100) nullable)
  - service_type (VARCHAR(50) nullable)
  - total_weight_kg (DECIMAL(10,3) nullable)
  - total_volume_m3 (DECIMAL(10,6) nullable)
  - status (VARCHAR(50) NOT NULL default 'pending')
  - status_detail (VARCHAR(255) nullable)
  - source_file (VARCHAR(500) nullable)
  - tenant_client_id (UUID FK to tenant_clients nullable)
```

### Seed Data

```gherkin
Given The migration runs successfully
When Seed data is inserted
Then Transportes Musan operator record exists (or is created if not present) with slug 'transportes-musan'
And Easy tenant_client exists: name='Easy', slug='easy', connector_type='csv_email', with connector_config template
And Paris tenant_client exists: name='Paris (Beetrack)', slug='paris', connector_type='browser', with connector_config template
And connector_config for Easy includes: email_filter, csv_delimiter, csv_encoding, column_map keys (with ENCRYPTED: prefix placeholders for credentials)
And connector_config for Paris includes: beetrack_url, login fields (with ENCRYPTED: prefix placeholders for credentials)
```

---

## Tasks / Subtasks

### Task 1: Create ENUM Types (idempotent)
- [x] Create `connector_type_enum` ENUM ('csv_email', 'api', 'browser') with DO $$ EXCEPTION WHEN duplicate_object THEN NULL END $$
- [x] Create `job_status_enum` ENUM ('pending', 'running', 'completed', 'failed', 'retrying') same pattern
- [x] Verify idempotency: running migration twice does not fail

### Task 2: Create tenant_clients Table
- [x] CREATE TABLE IF NOT EXISTS public.tenant_clients with all specified columns
- [x] UNIQUE constraint on (operator_id, slug)
- [x] Index idx_tenant_clients_operator_id on operator_id
- [x] Enable RLS + create tenant isolation policy using public.get_operator_id()
- [x] GRANT SELECT, INSERT, UPDATE, DELETE to authenticated; REVOKE from anon
- [x] Attach audit_trigger_func trigger

### Task 3: Create jobs Table
- [x] CREATE TABLE IF NOT EXISTS public.jobs with all specified columns
- [x] Partial index idx_jobs_worker_poll on (status, priority DESC, scheduled_at) WHERE status IN ('pending', 'retrying')
- [x] Index idx_jobs_operator_id on operator_id
- [x] Index idx_jobs_client_id on client_id
- [x] Enable RLS + create tenant isolation policy
- [x] GRANT permissions; attach audit trigger

### Task 4: Create raw_files Table
- [x] CREATE TABLE IF NOT EXISTS public.raw_files with all specified columns
- [x] Index idx_raw_files_operator_id on operator_id
- [x] Index idx_raw_files_job_id on job_id
- [x] Enable RLS + create tenant isolation policy
- [x] GRANT permissions; attach audit trigger

### Task 5: Extend orders Table
- [x] ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS external_load_id
- [x] ADD COLUMN IF NOT EXISTS recipient_region
- [x] ADD COLUMN IF NOT EXISTS service_type
- [x] ADD COLUMN IF NOT EXISTS total_weight_kg
- [x] ADD COLUMN IF NOT EXISTS total_volume_m3
- [x] ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending'
- [x] ADD COLUMN IF NOT EXISTS status_detail
- [x] ADD COLUMN IF NOT EXISTS source_file
- [x] ADD COLUMN IF NOT EXISTS tenant_client_id UUID REFERENCES public.tenant_clients(id)

### Task 6: Seed Transportes Musan Data
- [x] INSERT operator 'Transportes Musan' / slug 'transportes-musan' ON CONFLICT DO NOTHING
- [x] INSERT tenant_client Easy (csv_email) with connector_config template ON CONFLICT DO NOTHING
- [x] INSERT tenant_client Paris/Beetrack (browser) with connector_config template ON CONFLICT DO NOTHING

### Task 7: Write pgTAP-style SQL Tests
- [x] Create `apps/frontend/supabase/tests/automation_worker_schema_test.sql`
- [x] Test: tenant_clients table exists with correct columns
- [x] Test: jobs table exists with correct columns
- [x] Test: raw_files table exists with correct columns
- [x] Test: RLS enabled on all three tables
- [x] Test: partial index idx_jobs_worker_poll exists
- [x] Test: orders new columns exist
- [x] Test: seed data (Musan operator + Easy + Paris clients) present

### Task 8: Migration Validation Block
- [x] DO $$ ... $$ block verifies all tables, indexes, RLS, seed data exist — raises EXCEPTION on any failure

---

## Dev Notes

### Architecture Context
- Follows existing RLS pattern from Story 1.2/2.1: `public.get_operator_id()` from JWT claims
- All new tables get audit triggers via existing `audit_trigger_func` from Story 1.6
- `connector_config` is JSONB — credentials stored with `ENCRYPTED:` prefix, decrypted by worker at runtime (no pgcrypto required in DB)
- Migration file must be idempotent: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DO $$ EXCEPTION WHEN duplicate_object`
- Migration timestamp: 20260223000001

### Seed Data connector_config Templates
**Easy (csv_email):**
```json
{
  "email_filter": { "from": "ENCRYPTED:easy_sender_email", "subject_contains": "Manifiesto" },
  "csv_encoding": "latin-1",
  "csv_delimiter": ";",
  "column_map": {
    "order_number": "N° CARGA",
    "customer_name": "NOMBRE",
    "customer_phone": "TELEFONO",
    "delivery_address": "DIRECCION",
    "comuna": "COMUNA",
    "delivery_date": "FECHA ENTREGA"
  }
}
```
**Paris (browser):**
```json
{
  "beetrack_url": "https://www.beetrack.com/",
  "username": "ENCRYPTED:paris_beetrack_username",
  "password": "ENCRYPTED:paris_beetrack_password",
  "tenant_id": "ENCRYPTED:paris_beetrack_tenant_id"
}
```

### Edge Cases
- `connector_config` credentials use `ENCRYPTED:` prefix — decrypted at runtime by worker using VPS env key
- Migration conflicts with existing orders columns → handled by `ADD COLUMN IF NOT EXISTS`
- Seed data checks operator existence before inserting clients (`ON CONFLICT DO NOTHING`)

---

## Dev Agent Record

### Implementation Plan
- Task 1-6: Single migration file `20260223000001_create_automation_worker_schema.sql`
- Task 7: SQL test file `apps/frontend/supabase/tests/automation_worker_schema_test.sql`
- Task 8: Validation DO block at end of migration

### Debug Log
| Issue | Resolution |
|-------|-----------|
| - | - |

### Completion Notes
- Migration file created: `apps/frontend/supabase/migrations/20260223000001_create_automation_worker_schema.sql`
- SQL test file created: `apps/frontend/supabase/tests/automation_worker_schema_test.sql`
- All 3 new tables with RLS + audit triggers
- orders table extended with 9 new columns
- Seed data: Musan operator + 2 tenant_clients (Easy, Paris)
- Validation block: 20 assertion checks (expanded after code review)

---

## Senior Developer Review (AI)

**Date:** 2026-02-23
**Reviewer:** Opus 4.6 (adversarial code review)
**Outcome:** Changes Requested (7 issues: 3H, 3M, 1L → all H/M fixed automatically)

### Action Items

- [x] [H1] `tenant_clients.updated_at` has no auto-update trigger — added `set_updated_at()` function + BEFORE UPDATE trigger
- [x] [H2] Migration not idempotent for CREATE POLICY/TRIGGER — wrapped all in `DO $$ EXCEPTION WHEN duplicate_object` blocks
- [x] [H3] `orders.status` is unvalidated VARCHAR — created `order_status_enum` ENUM, used for column type
- [x] [M1] `raw_files` missing `created_at` column — added to match project-wide pattern
- [x] [M2] `jobs` missing `updated_at` column — added with auto-update trigger for status transition tracking
- [x] [M3] No constraint/FK validation in tests — added tests 7, 11, 14, 15, 17 for UNIQUE, FK, data type checks
- [ ] [L1] Test file duplicates migration validation block — acknowledged, not fixing (low impact)

---

## File List

- `apps/frontend/supabase/migrations/20260223000001_create_automation_worker_schema.sql` (new, updated with review fixes)
- `apps/frontend/supabase/tests/automation_worker_schema_test.sql` (new, expanded from 15→20 tests)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (updated: 2-4 → review)

---

## Change Log

| Date | Change |
|------|--------|
| 2026-02-23 | Story created and implemented — migration + tests for automation worker schema |
| 2026-02-23 | Code review: 6 issues fixed (3H, 3M) — updated_at triggers, idempotent policies, order_status_enum, BIGINT file_size, constraint tests |
