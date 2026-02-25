# Story 3.1: Create Performance Metrics Tables and Calculation Logic

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Aureon DevOps engineer,
I want to create database tables and functions for calculating SLA, FADR, and other performance metrics,
So that dashboard queries are fast and metrics are consistently calculated.

## Acceptance Criteria

1. **Given** the orders table exists with delivery data
   **When** I run the migration
   **Then** the `delivery_attempts` table exists with fields:
   - `id` UUID PK DEFAULT gen_random_uuid()
   - `operator_id` UUID NOT NULL FK → operators(id) ON DELETE CASCADE
   - `order_id` UUID NOT NULL FK → orders(id) ON DELETE CASCADE
   - `attempt_number` INT NOT NULL
   - `status` delivery_attempt_status_enum ('success', 'failed', 'returned')
   - `failure_reason` VARCHAR(100) nullable
   - `attempted_at` TIMESTAMPTZ NOT NULL
   - `driver_id` UUID nullable
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `deleted_at` TIMESTAMPTZ nullable (soft delete)

2. **And** the `performance_metrics` table exists with fields:
   - `id` UUID PK DEFAULT gen_random_uuid()
   - `operator_id` UUID NOT NULL FK → operators(id) ON DELETE CASCADE
   - `metric_date` DATE NOT NULL
   - `retailer_name` VARCHAR(50) nullable (NULL = all-retailer aggregate)
   - `total_orders` INT NOT NULL DEFAULT 0
   - `delivered_orders` INT NOT NULL DEFAULT 0
   - `first_attempt_deliveries` INT NOT NULL DEFAULT 0
   - `failed_deliveries` INT NOT NULL DEFAULT 0
   - `shortage_claims_count` INT NOT NULL DEFAULT 0
   - `shortage_claims_amount_clp` NUMERIC(12,2) NOT NULL DEFAULT 0
   - `avg_delivery_time_minutes` NUMERIC(8,2) nullable
   - `created_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `updated_at` TIMESTAMPTZ NOT NULL DEFAULT NOW()
   - `deleted_at` TIMESTAMPTZ nullable (soft delete)

3. **And** unique constraint on `(operator_id, metric_date, retailer_name)` prevents duplicate metrics — use COALESCE for NULL retailer_name handling: `UNIQUE (operator_id, metric_date, COALESCE(retailer_name, '__ALL__'))`

4. **And** database function `calculate_sla(p_operator_id UUID, p_start_date DATE, p_end_date DATE)` returns NUMERIC(5,2) = `(delivered_orders / NULLIF(total_orders, 0) * 100)`

5. **And** database function `calculate_fadr(p_operator_id UUID, p_start_date DATE, p_end_date DATE)` returns NUMERIC(5,2) = `(first_attempt_deliveries / NULLIF(total_orders, 0) * 100)`

6. **And** database function `get_failure_reasons(p_operator_id UUID, p_start_date DATE, p_end_date DATE)` returns JSON array of `{reason, count, percentage}`

7. **And** pg_cron job scheduled at 2:00 AM UTC to calculate yesterday's metrics for all operators and upsert into performance_metrics table

8. **And** RLS policies enforce tenant isolation on both tables using `operator_id = public.get_operator_id()`

9. **And** audit triggers attached to both tables using existing `audit_trigger_func()`

10. **And** all SQL tests pass (target: 20+ assertion blocks)

## Edge Cases

- Division by zero (no orders on a day) → NULLIF guard returns NULL, display as "N/A"
- Missing delivery attempt data → SLA calculation excludes orders without attempts
- Metrics calculation cron fails → Log to Sentry via pg_net or application-level alerting, retry next night
- NULL retailer_name in unique constraint → COALESCE to sentinel value `'__ALL__'` for uniqueness
- Concurrent cron executions → Use `ON CONFLICT ... DO UPDATE` (upsert) to handle idempotently

## Tasks / Subtasks

- [x] Task 1: Create migration file (AC: #1, #2, #3, #8, #9)
  - [x] 1.1 Create ENUM type `delivery_attempt_status_enum` ('success', 'failed', 'returned') with idempotent DO $$ pattern
  - [x] 1.2 Create `delivery_attempts` table with all columns, FKs, soft delete
  - [x] 1.3 Create `performance_metrics` table with all columns, FKs, soft delete
  - [x] 1.4 Create unique functional index on `(operator_id, metric_date, COALESCE(retailer_name, '__ALL__'))` for performance_metrics
  - [x] 1.5 Create indexes: `idx_delivery_attempts_operator_id`, `idx_delivery_attempts_order_id`, `idx_delivery_attempts_attempted_at`, `idx_performance_metrics_operator_id`, `idx_performance_metrics_metric_date`
  - [x] 1.6 Enable RLS on both tables + create tenant isolation policies (FOR ALL + FOR SELECT)
  - [x] 1.7 GRANT/REVOKE permissions (authenticated gets SELECT/INSERT/UPDATE/DELETE; anon gets nothing)
  - [x] 1.8 Attach `audit_trigger_func()` trigger to both tables
  - [x] 1.9 Attach `set_updated_at()` trigger to `performance_metrics` (has `updated_at` column)
  - [x] 1.10 Add inline validation DO $$ block at end of migration
- [x] Task 2: Create database functions (AC: #4, #5, #6)
  - [x] 2.1 Create `calculate_sla(p_operator_id, p_start_date, p_end_date)` → NUMERIC(5,2)
  - [x] 2.2 Create `calculate_fadr(p_operator_id, p_start_date, p_end_date)` → NUMERIC(5,2)
  - [x] 2.3 Create `get_failure_reasons(p_operator_id, p_start_date, p_end_date)` → JSONB
  - [x] 2.4 All functions use `SECURITY INVOKER` (RLS applies), query `performance_metrics` for SLA/FADR and `delivery_attempts` for failure reasons
- [x] Task 3: Set up pg_cron nightly job (AC: #7)
  - [x] 3.1 Enable pg_cron extension (if not already enabled)
  - [x] 3.2 Create `calculate_daily_metrics(p_date DATE)` function that aggregates from orders + delivery_attempts into performance_metrics via upsert
  - [x] 3.3 Schedule cron: `SELECT cron.schedule('nightly-metrics', '0 2 * * *', $$SELECT calculate_daily_metrics(CURRENT_DATE - INTERVAL '1 day')$$)`
  - [x] 3.4 Add per-retailer breakdown (loop over DISTINCT retailer_name) + aggregate row (retailer_name = NULL)
- [x] Task 4: Update TypeScript types (AC: all)
  - [x] 4.1 Add `delivery_attempts` Row/Insert/Update types to `apps/frontend/src/lib/types.ts`
  - [x] 4.2 Add `performance_metrics` Row/Insert/Update types to `apps/frontend/src/lib/types.ts`
  - [x] 4.3 Add `delivery_attempt_status_enum` to Enums section
  - [x] 4.4 Add new functions to Functions section (`calculate_sla`, `calculate_fadr`, `get_failure_reasons`, `calculate_daily_metrics`)
- [x] Task 5: Write SQL tests (AC: #10)
  - [x] 5.1 Create `apps/frontend/supabase/tests/performance_metrics_schema_test.sql`
  - [x] 5.2 Test ENUM exists, both tables have all columns with correct types
  - [x] 5.3 Test RLS enabled on both tables
  - [x] 5.4 Test indexes exist
  - [x] 5.5 Test unique constraint on performance_metrics
  - [x] 5.6 Test FK constraints exist
  - [x] 5.7 Test triggers exist (audit + updated_at)
  - [x] 5.8 Test functions exist and return correct types
  - [x] 5.9 Test cron job is scheduled
  - [x] 5.10 Target: 20+ assertion blocks

## Dev Notes

### Technical Requirements

**Database Engine:** Supabase (managed PostgreSQL). All schema changes via migration files only — never use the Dashboard SQL Editor for DDL.

**pg_cron:** Fully supported on Supabase (v1.6.4). Enable via Dashboard → Extensions panel if not already active. The cron job runs in the `postgres` role context — it bypasses RLS, which is correct for the nightly aggregation job (it needs to calculate across all operators).

**Function Design:**
- `calculate_sla` and `calculate_fadr` query the `performance_metrics` table (pre-aggregated), NOT raw orders. This keeps dashboard queries fast.
- `get_failure_reasons` queries `delivery_attempts` directly (needs row-level detail for reason grouping).
- `calculate_daily_metrics` (cron target) queries `orders` + `delivery_attempts` to populate `performance_metrics`. This is the only function that touches raw data.
- All user-facing functions use `SECURITY INVOKER` — RLS filters by operator automatically.
- `calculate_daily_metrics` should be `SECURITY DEFINER` with explicit `SET search_path = public` since it runs via pg_cron (no JWT context).

**NUMERIC vs DECIMAL:** They are aliases in PostgreSQL. Use `NUMERIC(precision, scale)` in migration SQL for clarity. Use `NUMERIC(5,2)` for percentages (max 999.99%), `NUMERIC(12,2)` for CLP amounts, `NUMERIC(8,2)` for time in minutes.

**Unique Constraint with NULLs:** PostgreSQL treats NULL != NULL in unique constraints, so `(operator_id, metric_date, NULL)` would allow duplicates. Solution: create a unique INDEX (not constraint) using `COALESCE`:
```sql
CREATE UNIQUE INDEX idx_perf_metrics_unique_daily
ON performance_metrics (operator_id, metric_date, COALESCE(retailer_name, '__ALL__'));
```

**Upsert Pattern for Cron Job:**
```sql
INSERT INTO performance_metrics (operator_id, metric_date, retailer_name, ...)
VALUES (...)
ON CONFLICT (operator_id, metric_date, COALESCE(retailer_name, '__ALL__'))
DO UPDATE SET
  total_orders = EXCLUDED.total_orders,
  delivered_orders = EXCLUDED.delivered_orders,
  ...
  updated_at = NOW();
```
Note: `ON CONFLICT` must reference the unique index expression, not column names, when using functional indexes.

### Architecture Compliance

**Multi-Tenant Isolation (MANDATORY):**
- Both tables MUST have `operator_id UUID NOT NULL` with FK → `operators(id) ON DELETE CASCADE`
- Both tables MUST have RLS enabled with tenant isolation policies using `public.get_operator_id()`
- MUST create both `FOR ALL USING/WITH CHECK` and explicit `FOR SELECT USING` policies (2026 best practice for UPDATE compatibility)
- MUST index `operator_id` on both tables — missing index = full table scan on every RLS check

**Soft Delete (7-Year Compliance):**
- Both tables MUST include `deleted_at TIMESTAMPTZ NULL`
- All query functions MUST filter with `WHERE deleted_at IS NULL`

**Audit Logging:**
- Both tables MUST attach the existing `audit_trigger_func()` trigger:
  ```sql
  CREATE TRIGGER audit_delivery_attempts_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.delivery_attempts
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
  ```

**updated_at Auto-Update:**
- `performance_metrics` has `updated_at` → MUST attach `set_updated_at()` trigger
- `delivery_attempts` does NOT have `updated_at` (immutable records) → no trigger needed

**Idempotency (MANDATORY for all DDL):**
- Tables: `CREATE TABLE IF NOT EXISTS`
- ENUMs: `DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
- Policies: wrap in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
- Triggers: wrap in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
- Functions: `CREATE OR REPLACE FUNCTION`
- Indexes: `CREATE INDEX IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS`

**Permissions Pattern:**
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.performance_metrics TO authenticated;
REVOKE ALL ON public.delivery_attempts FROM anon;
REVOKE ALL ON public.performance_metrics FROM anon;
```

**Function Permissions:**
```sql
-- Revoke default public access, grant only to authenticated
REVOKE EXECUTE ON FUNCTION calculate_sla FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION calculate_fadr FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_failure_reasons FROM PUBLIC;
GRANT EXECUTE ON FUNCTION calculate_sla TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_fadr TO authenticated;
GRANT EXECUTE ON FUNCTION get_failure_reasons TO authenticated;
-- calculate_daily_metrics is internal-only (cron), no grant to authenticated
```

### Library & Framework Requirements

**No new dependencies required for this story.** This is a pure database schema + functions story.

**Existing dependencies used:**
| Dependency | Version | Purpose in this story |
|---|---|---|
| Supabase (managed PostgreSQL) | Latest | Tables, functions, RLS, pg_cron |
| pg_cron extension | 1.6.4 | Nightly metrics aggregation scheduling |
| Vitest | (existing) | Running SQL test assertions via `supabase db push` + test runner |

**DO NOT introduce:**
- No ORM or query builder — all schema work is raw SQL migrations
- No Redis/BullMQ — the cron job runs entirely in PostgreSQL via pg_cron
- No external metrics libraries — calculations are pure SQL functions
- No new npm packages — TypeScript types are hand-written in `types.ts`

**pg_cron activation check:** Before scheduling the job, verify pg_cron is enabled:
```sql
SELECT * FROM pg_extension WHERE extname = 'pg_cron';
```
If not enabled, add to migration: `CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;`

### File Structure Requirements

**Files to CREATE:**

| File | Purpose |
|------|---------|
| `apps/frontend/supabase/migrations/20260224000001_create_performance_metrics_tables.sql` | Main migration: ENUMs, tables, indexes, RLS, triggers, validation |
| `apps/frontend/supabase/migrations/20260224000002_create_metrics_functions.sql` | Database functions: calculate_sla, calculate_fadr, get_failure_reasons, calculate_daily_metrics |
| `apps/frontend/supabase/migrations/20260224000003_schedule_metrics_cron.sql` | pg_cron extension enable + nightly job scheduling |
| `apps/frontend/supabase/tests/performance_metrics_schema_test.sql` | SQL test assertions (20+ blocks) |

**Files to MODIFY:**

| File | Change |
|------|--------|
| `apps/frontend/src/lib/types.ts` | Add Row/Insert/Update types for `delivery_attempts` and `performance_metrics`, add `delivery_attempt_status_enum` to Enums, add function signatures |

**Files NOT to touch:**

- Do NOT modify any existing migration files — forward-only migrations
- Do NOT create API routes — this story is schema-only (Stories 3.2+ will add API/UI)
- Do NOT create React components or hooks
- Do NOT modify `package.json` or add dependencies

**Migration file naming:** `YYYYMMDDHHMMSS_descriptive_snake_case.sql` — use `20260224` prefix with sequential `000001/000002/000003` suffixes.

**Migration split rationale:** Three separate files because:
1. Schema (tables/indexes/RLS) should be independently testable
2. Functions reference the tables — must run after schema
3. pg_cron scheduling is a separate concern and may need different handling per environment (cron may not be available in local dev)

**SQL test file location:** `apps/frontend/supabase/tests/` — follows existing pattern from `automation_worker_schema_test.sql`

### Testing Requirements

**Test file:** `apps/frontend/supabase/tests/performance_metrics_schema_test.sql`

**Test pattern:** pgTAP-style `DO $$ ... $$` assertion blocks. Each block tests one thing, raises `EXCEPTION` on failure, `NOTICE` on pass.

**Required test assertions (minimum 20):**

**ENUM Tests:**
1. `delivery_attempt_status_enum` type exists in `pg_type`
2. Enum has exactly 3 values: 'success', 'failed', 'returned'

**delivery_attempts Table Tests:**
3. Table exists
4. Has column `id` (uuid)
5. Has column `operator_id` (uuid, not null)
6. Has column `order_id` (uuid, not null)
7. Has column `attempt_number` (integer, not null)
8. Has column `status` (user-defined enum)
9. Has column `failure_reason` (varchar, nullable)
10. Has column `attempted_at` (timestamptz, not null)
11. Has column `deleted_at` (timestamptz, nullable)
12. RLS enabled (`pg_class.relrowsecurity = true`)
13. FK to `orders(id)` exists
14. FK to `operators(id)` exists
15. Index `idx_delivery_attempts_operator_id` exists
16. Index `idx_delivery_attempts_order_id` exists

**performance_metrics Table Tests:**
17. Table exists with all required columns
18. RLS enabled
19. Unique index `idx_perf_metrics_unique_daily` exists
20. Index `idx_performance_metrics_operator_id` exists
21. `updated_at` trigger exists (`set_performance_metrics_updated_at`)
22. Audit trigger exists (`audit_performance_metrics_changes`)

**Function Tests:**
23. `calculate_sla` function exists and returns `numeric`
24. `calculate_fadr` function exists and returns `numeric`
25. `get_failure_reasons` function exists and returns `jsonb`
26. `calculate_daily_metrics` function exists

**Cron Tests:**
27. pg_cron extension is enabled
28. Cron job `nightly-metrics` exists in `cron.job` table

**Test execution:** Run via `supabase db push` (applies migrations) then execute the test file against the database. Tests verify schema structure, not data — no seed data required.

**Vitest (TypeScript) tests:** NOT required for this story. Type correctness is verified by `tsc` during CI. TypeScript tests for metrics will come in Story 3.2+ when API routes and hooks are built.

**CI integration:** Existing GitHub Actions workflow runs `tsc` type-check. SQL tests are run manually via `supabase db push` + test file execution. No changes to CI config needed.

### Previous Story Intelligence

**Source:** Stories 2.1 (orders table) and 2.4 (automation worker schema) — the two closest DB schema stories.

**Code Review Fixes Applied in Story 2.4 (MUST NOT repeat these mistakes):**

| Severity | Issue | Fix Applied | Relevance to 3.1 |
|----------|-------|-------------|-------------------|
| HIGH (H1) | Missing types in `packages/types` | Types added to shared package | Add new types to `apps/frontend/src/lib/types.ts` — this is the canonical location |
| HIGH (H2) | Non-idempotent ENUMs, policies, triggers | Wrapped in `DO $$ ... EXCEPTION WHEN duplicate_object` | ALL DDL must be idempotent |
| HIGH (H3) | `set_updated_at()` trigger missing on tables with `updated_at` | Trigger added | `performance_metrics` MUST have this trigger |
| MEDIUM (M1) | Missing `created_at` on tables | Added `DEFAULT NOW()` | Both tables must have `created_at` |
| MEDIUM (M2) | Missing `updated_at` on mutable tables | Added column + trigger | `performance_metrics` is mutable (cron updates it) |
| MEDIUM (M3) | Tests only checked column existence, not types/constraints | Tests expanded | Test column data types, FKs, unique constraints — not just existence |

**Code Review Fixes Applied in Story 2.1:**

| Issue | Fix | Relevance |
|-------|-----|-----------|
| Env var fallback `\|\| ''` in tests | Removed — tests skip cleanly when vars missing | Do NOT use fallback patterns for env vars |
| Stale Supabase client ref | Use fresh client per test | Not applicable (SQL-only tests) |

**Patterns Established to Follow:**
- Migration file header comment block with Story/Epic/Purpose/Dependencies
- Numbered PART sections within migration (PART 1: ENUMs, PART 2: Tables, etc.)
- Inline validation `DO $$` block at end of each migration file
- SQL test file mirrors migration structure — one test block per DDL element

### Git Intelligence

**Recent commit history (last 10):**
```
a163498 chore: resolve merge conflict in sprint-status.yaml
2da787b chore: mark story 2.8 done after code review fixes
1335e76 review(story-2.8): fix 7 code review issues (3H, 4M)
350d8c4 feat(story-2.8): implement manual order entry form (#14)
ea9cf3f chore: mark story 2.7 done + pending tasks checklist (#15)
614ee20 chore: mark story 2.7 done, add pending manual tasks checklist
3dc8222 chore: mark story 2.7 as done after code review fixes (#14)
ab3975c review(story-2.7): fix 6 code review issues (3H, 3M) (#13)
7f6b473 feat(story-2.7): implement job queue orchestration worker (#12)
```

**Commit message conventions:**
- Feature: `feat(story-X.Y): short description (#PR)`
- Code review fixes: `review(story-X.Y): fix N code review issues (severity counts)`
- Status updates: `chore: mark story X.Y done after code review fixes`

**For this story use:**
- Branch: `feat/story-3.1-performance-metrics-tables`
- Commit: `feat(story-3.1): create performance metrics tables and calculation logic`

**Current branch:** `feat/story-2.8-manual-order-form` — dev agent MUST create a new branch from `main` before starting work.

### Latest Tech Information

**pg_cron on Supabase (as of Feb 2026):**
- Version 1.6.4, fully supported and actively maintained
- Enable via Dashboard → Database → Extensions → search "pg_cron" → Enable
- Cron jobs stored in `cron.job` table (schema `cron`)
- Jobs run as `postgres` role — bypasses RLS (correct for aggregation)
- Scheduling syntax: standard cron (`0 2 * * *` = daily at 2 AM UTC)
- Unschedule: `SELECT cron.unschedule('job-name');`
- Monitor: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;`

**Supabase Database Functions — Best Practices:**
- Functions are auto-exposed as RPC endpoints via PostgREST (`supabase.rpc('function_name', params)`)
- Use `SECURITY INVOKER` (default) for user-facing functions — RLS applies
- Use `SECURITY DEFINER` + `SET search_path = public` for cron/internal functions — explicitly set search_path to prevent injection
- Revoke default public execute: `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;` then grant selectively

**PostgreSQL NUMERIC type notes:**
- `NUMERIC(5,2)` stores up to 999.99 — sufficient for percentages
- `NUMERIC(12,2)` stores up to 9,999,999,999.99 — sufficient for CLP amounts
- Exact arithmetic (no floating point errors) — critical for financial/SLA calculations
- Supabase CLI may display as `number` in TypeScript generated types — override manually in `types.ts` with `number` type (no precision loss in JS for this range)

**Functional unique indexes — ON CONFLICT syntax:**
- When using `CREATE UNIQUE INDEX` with expressions (COALESCE), `ON CONFLICT` cannot reference column names
- Must use `ON CONFLICT ON CONSTRAINT constraint_name` or the index expression directly
- Recommended approach: name the index explicitly, then:
  ```sql
  INSERT INTO performance_metrics (...) VALUES (...)
  ON CONFLICT (operator_id, metric_date, COALESCE(retailer_name, '__ALL__'))
  DO UPDATE SET ...;
  ```

### Project Structure Notes

- Migration files go in `apps/frontend/supabase/migrations/` — this is the monorepo frontend app which owns the Supabase project
- TypeScript types in `apps/frontend/src/lib/types.ts` — single source of truth for DB types
- SQL tests in `apps/frontend/supabase/tests/` — alongside existing `automation_worker_schema_test.sql` and `rbac_users_test.sql`
- No `packages/types` shared package exists for DB types — all types live in the frontend app
- No conflicts or variances with unified project structure detected

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 3, Story 3.1 acceptance criteria and edge cases]
- [Source: `_bmad-output/planning-artifacts/architecture.md` — Database architecture, RLS patterns, naming conventions, testing standards]
- [Source: `_bmad-output/implementation-artifacts/2-1-create-orders-table-and-data-model.md` — Orders table schema (FK reference)]
- [Source: `_bmad-output/implementation-artifacts/2-4-create-automation-worker-database-schema.md` — Migration patterns, code review fixes, SQL test patterns]
- [Source: `apps/frontend/supabase/migrations/20260223000001_create_automation_worker_schema.sql` — Migration file structure template]
- [Source: `apps/frontend/src/lib/types.ts` — Existing TypeScript DB types to extend]
- [Source: Supabase docs — pg_cron, database functions, RLS best practices]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- ✅ Task 1: Created migration `20260224000001_create_performance_metrics_tables.sql` — ENUM, 2 tables, 6 indexes (incl. unique functional), RLS (FOR ALL + FOR SELECT), GRANT/REVOKE, 3 triggers (2 audit + 1 set_updated_at), inline validation
- ✅ Task 2: Created migration `20260224000002_create_metrics_functions.sql` — 4 functions (calculate_sla, calculate_fadr, get_failure_reasons as SECURITY INVOKER; calculate_daily_metrics as SECURITY DEFINER with SET search_path), function permissions
- ✅ Task 3: Created migration `20260224000003_schedule_metrics_cron.sql` — pg_cron extension enable + nightly-metrics job at 2:00 AM UTC
- ✅ Task 4: Updated `apps/frontend/src/lib/types.ts` — Added delivery_attempts and performance_metrics Row/Insert/Update types, delivery_attempt_status_enum, 4 function signatures
- ✅ Task 5: Created `apps/frontend/supabase/tests/performance_metrics_schema_test.sql` — 28 assertion blocks covering ENUM values, table columns+types, NOT NULL constraints, nullable columns, RLS, FKs, indexes, triggers, functions+return types, pg_cron, cron job
- TypeScript compilation: clean (0 errors)
- Vitest: 377 passed, 0 regressions

### File List

- `apps/frontend/supabase/migrations/20260224000001_create_performance_metrics_tables.sql` (NEW)
- `apps/frontend/supabase/migrations/20260224000002_create_metrics_functions.sql` (NEW)
- `apps/frontend/supabase/migrations/20260224000003_schedule_metrics_cron.sql` (NEW)
- `apps/frontend/supabase/tests/performance_metrics_schema_test.sql` (NEW)
- `apps/frontend/src/lib/types.ts` (MODIFIED)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (MODIFIED)
- `_bmad-output/implementation-artifacts/3-1-create-performance-metrics-tables-and-calculation-logic.md` (MODIFIED)

### Change Log
- 2026-02-24: Story created by SM agent (Bob) — comprehensive context engine analysis completed
- 2026-02-24: Implementation complete — 3 migrations, TypeScript types, 28 SQL test assertions, 377 Vitest passing
- 2026-02-25: Code review by Amelia (Dev Agent) — found 3H, 4M, 1L issues, auto-fixed 3H + 4M:
  - H1: SECURITY — Added REVOKE EXECUTE on calculate_daily_metrics(DATE) FROM PUBLIC (SECURITY DEFINER was callable by anon)
  - H2: calculate_daily_metrics now explicitly handles all 7 metric columns; preserves shortage/time on upsert
  - H3: Cron migration wrapped in DO/EXCEPTION block for graceful local-dev fallback
  - M1: Added delivery_attempt_status_enum to Constants object in types.ts
  - M2: Tightened get_failure_reasons TS return type from Json to typed array
  - M3: Removed fragile ::TEXT cast on delivery_date comparison (both sides are DATE)
  - M4: Refactored calculate_daily_metrics from 8 separate queries to 2 using COUNT FILTER
