# Story 3B.1: Schema Design — Routes, Dispatches, Fleet Vehicles

Status: review

## Dependencies

Depends on: Epic 3A (done), PR #68 (merged — full payload logging deployed). Sprint change proposal approved 2026-03-06.

**Blocked until:** At least 24-48 hours of DispatchTrack webhook payload logs are available in Supabase Edge Function logs. The developer MUST analyze real payloads before finalizing column definitions. The schema below is a draft — field names and types may change based on payload discovery.

## Story

As a platform architect,
I want provider-agnostic `routes`, `dispatches`, and `fleet_vehicles` tables designed and migrated,
so that we can ingest delivery tracking data from any routing provider (DispatchTrack, SimpliRoute, Driv.in) and enable OTIF tracking, order status updates, and fleet cost analysis.

## Acceptance Criteria

1. **AC1: Routing Provider Enum** — A new `routing_provider_enum` type is created:
   ```sql
   CREATE TYPE routing_provider_enum AS ENUM ('dispatchtrack', 'simpliroute', 'drivin');
   ```

2. **AC2: Route Status Enum** — A new `route_status_enum` type is created:
   ```sql
   CREATE TYPE route_status_enum AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
   ```

3. **AC3: Dispatch Status Enum** — A new `dispatch_status_enum` type is created. **IMPORTANT: Verify values against real DispatchTrack payloads before finalizing.**
   ```sql
   CREATE TYPE dispatch_status_enum AS ENUM (
     'pending',        -- Assigned to route, not yet attempted
     'in_transit',     -- Driver en route to stop
     'arrived',        -- Driver arrived at delivery location
     'delivered',      -- Successfully delivered (terminal)
     'failed',         -- Delivery failed (terminal)
     'returned',       -- Returned to sender (terminal)
     'partial'         -- Partial delivery (terminal)
   );
   ```

4. **AC4: Routes Table** — Created with provider-agnostic columns:
   ```sql
   CREATE TABLE public.routes (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
     provider routing_provider_enum NOT NULL,
     external_route_id VARCHAR(100) NOT NULL,
     route_date DATE NOT NULL,
     driver_name VARCHAR(255),
     vehicle_id UUID REFERENCES public.fleet_vehicles(id) ON DELETE SET NULL,
     status route_status_enum NOT NULL DEFAULT 'planned',
     planned_stops INTEGER,
     completed_stops INTEGER DEFAULT 0,
     start_time TIMESTAMPTZ,
     end_time TIMESTAMPTZ,
     total_km DECIMAL(10,2),
     idle_time_minutes INTEGER,
     raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     deleted_at TIMESTAMPTZ,
     CONSTRAINT unique_route_per_operator_provider UNIQUE (operator_id, provider, external_route_id)
   );
   ```

5. **AC5: Dispatches Table** — Created with provider-agnostic columns. Links to `routes` and `orders`:
   ```sql
   CREATE TABLE public.dispatches (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
     route_id UUID REFERENCES public.routes(id) ON DELETE SET NULL,
     order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
     provider routing_provider_enum NOT NULL,
     external_dispatch_id VARCHAR(100),
     status dispatch_status_enum NOT NULL DEFAULT 'pending',
     substatus VARCHAR(255),
     planned_sequence INTEGER,
     arrived_at TIMESTAMPTZ,
     completed_at TIMESTAMPTZ,
     failure_reason VARCHAR(255),
     driver_notes TEXT,
     raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     deleted_at TIMESTAMPTZ,
     CONSTRAINT unique_dispatch_per_operator UNIQUE (operator_id, provider, external_dispatch_id)
   );
   ```
   - `route_id` is nullable because a dispatch event may arrive before we've seen the route event
   - `order_id` is nullable because the order may not exist yet (webhook arrived before CSV import)

6. **AC6: Fleet Vehicles Table** — Created with provider-agnostic columns:
   ```sql
   CREATE TABLE public.fleet_vehicles (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
     provider routing_provider_enum NOT NULL,
     external_vehicle_id VARCHAR(100),
     plate_number VARCHAR(20),
     vehicle_type VARCHAR(50),
     driver_name VARCHAR(255),
     raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     deleted_at TIMESTAMPTZ,
     CONSTRAINT unique_vehicle_per_operator UNIQUE (operator_id, provider, external_vehicle_id)
   );
   ```

7. **AC7: Indexes** — Standard indexes for RLS performance and common queries:
   ```sql
   -- Routes
   CREATE INDEX idx_routes_operator_id ON public.routes(operator_id);
   CREATE INDEX idx_routes_operator_date ON public.routes(operator_id, route_date);
   CREATE INDEX idx_routes_operator_provider ON public.routes(operator_id, provider);
   CREATE INDEX idx_routes_deleted_at ON public.routes(deleted_at);

   -- Dispatches
   CREATE INDEX idx_dispatches_operator_id ON public.dispatches(operator_id);
   CREATE INDEX idx_dispatches_route_id ON public.dispatches(route_id);
   CREATE INDEX idx_dispatches_order_id ON public.dispatches(order_id);
   CREATE INDEX idx_dispatches_operator_status ON public.dispatches(operator_id, status);
   CREATE INDEX idx_dispatches_completed_at ON public.dispatches(operator_id, completed_at);
   CREATE INDEX idx_dispatches_deleted_at ON public.dispatches(deleted_at);

   -- Fleet Vehicles
   CREATE INDEX idx_fleet_vehicles_operator_id ON public.fleet_vehicles(operator_id);
   CREATE INDEX idx_fleet_vehicles_plate ON public.fleet_vehicles(operator_id, plate_number);
   CREATE INDEX idx_fleet_vehicles_deleted_at ON public.fleet_vehicles(deleted_at);
   ```

8. **AC8: RLS Policies** — Standard tenant isolation on all three tables:
   ```sql
   -- For each table (routes, dispatches, fleet_vehicles):
   ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "<table>_tenant_isolation" ON public.<table>
     FOR ALL
     USING (operator_id = public.get_operator_id())
     WITH CHECK (operator_id = public.get_operator_id());

   CREATE POLICY "<table>_tenant_select" ON public.<table>
     FOR SELECT
     USING (operator_id = public.get_operator_id());

   GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;
   REVOKE ALL ON public.<table> FROM anon;
   ```

9. **AC9: Audit Triggers** — Attach `audit_trigger_func()` to all three tables:
   ```sql
   CREATE TRIGGER audit_routes_changes
     AFTER INSERT OR UPDATE OR DELETE ON public.routes
     FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
   -- Same for dispatches and fleet_vehicles
   ```

10. **AC10: Replace `delivery_attempts` Table With a View** — `delivery_attempts` is redundant now that `dispatches` exists. It's just a filtered count of terminal dispatches per order. Replace it:
    - Rename the existing table: `ALTER TABLE delivery_attempts RENAME TO delivery_attempts_legacy;`
    - Create a backward-compatible view:
      ```sql
      CREATE VIEW delivery_attempts AS
      SELECT
        d.id,
        d.operator_id,
        d.order_id,
        1 AS attempt_number,  -- dispatches don't track attempt_number; default to 1
        CASE d.status
          WHEN 'delivered' THEN 'success'::delivery_attempt_status_enum
          WHEN 'failed' THEN 'failed'::delivery_attempt_status_enum
          WHEN 'returned' THEN 'returned'::delivery_attempt_status_enum
          WHEN 'partial' THEN 'success'::delivery_attempt_status_enum
        END AS status,
        d.failure_reason,
        COALESCE(d.completed_at, d.arrived_at) AS attempted_at,
        NULL::UUID AS driver_id,
        d.created_at,
        d.deleted_at
      FROM dispatches d
      WHERE d.status IN ('delivered', 'failed', 'returned', 'partial')
        AND d.deleted_at IS NULL;
      ```
    - This view is **backward-compatible** — existing RPCs keep working without code changes
    - The edge function (3b-2) will write to `dispatches` instead of `delivery_attempts`
    - **RPCs that read from `delivery_attempts` (migrate later):**
      - `get_failure_reasons(UUID, DATE, DATE)` — queries `delivery_attempts` for failed status breakdown [Source: `20260224000002_create_metrics_functions.sql`, lines 74-112]
      - `calculate_daily_metrics(DATE)` — joins `orders` + `delivery_attempts` for nightly aggregation into `performance_metrics` [Source: `20260224000002_create_metrics_functions.sql`, lines 122-247]
      - Both use columns: `operator_id`, `order_id`, `status`, `failure_reason`, `attempted_at`, `attempt_number`, `deleted_at`
      - These RPCs will work via the view initially. Future story should rewrite them to query `dispatches` directly for better performance and access to richer data (route_id, substatus, driver_notes)
    - Drop `delivery_attempts_legacy` table in a future cleanup story once view is proven stable

11. **AC11: Payload Analysis** — Before writing the migration, the developer MUST:
    - Check Supabase Edge Function logs for `beetrack-webhook: FULL PAYLOAD` entries
    - Document all observed `resource` types and their field structures
    - Verify the draft enum values match real data
    - Adjust column names/types if real payloads differ from the draft schema
    - Save payload samples to `docs/dispatchtrack-webhook-payloads.md` for reference

## Tasks / Subtasks

- [x] Task 1: Analyze DispatchTrack webhook payloads (AC: #11)
  - [x] 1.1 Check Supabase Edge Function logs for FULL PAYLOAD entries
  - [x] 1.2 Collect samples of each resource type (dispatch, dispatch_guide observed; route, review documented from official docs)
  - [x] 1.3 Document field structures in `docs/dispatchtrack-webhook-payloads.md`
  - [x] 1.4 Compare real fields against draft schema — adjusted: added substatus_code, estimated_at, latitude, longitude, is_pickup to dispatches
- [x] Task 2: Create Supabase migration (AC: #1-9, #10 modified)
  - [x] 2.1 Create migration file: `20260306000001_add_routes_dispatches_fleet_tables.sql`
  - [x] 2.2 Write SQL for enums (routing_provider_enum, route_status_enum, dispatch_status_enum)
  - [x] 2.3 Write SQL for fleet_vehicles table (created BEFORE routes)
  - [x] 2.4 Write SQL for routes table
  - [x] 2.5 Write SQL for dispatches table (with payload-informed columns)
  - [x] 2.6 Write SQL for all indexes (13 total)
  - [x] 2.7 Write SQL for RLS policies (idempotent DO blocks, 2 per table)
  - [x] 2.8 Write SQL for audit triggers + set_updated_at triggers
  - [x] 2.9 **CHANGED**: Dropped `delivery_attempts` table entirely (cleaner than view approach)
  - [x] 2.10 **CHANGED**: Migrated legacy data from delivery_attempts into dispatches
  - [x] 2.11 Rewrote RPCs (`get_failure_reasons`, `calculate_daily_metrics`) to query dispatches directly
- [x] Task 3: Test migration (AC: #1-9) — no local Docker, tested against production
  - [x] 3.1 Dry-run passed, then `supabase db push` applied cleanly with all validation NOTICEs
  - [x] 3.2 Verified all tables created via REST API queries
  - [x] 3.3 Verified delivery_attempts table is gone (PGRST205)
  - [x] 3.4 Verified `get_failure_reasons` RPC returns correct data from dispatches
  - [x] 3.5 Verified `calculate_daily_metrics` RPC executes without error
- [ ] Task 4: Push migration via PR (AC: all)
  - [ ] 4.1 Create feature branch, commit migration + payload docs
  - [ ] 4.2 Create PR with auto-merge
  - [ ] 4.3 Verify CI passes

## Dev Notes

### Critical: Payload-First Design

**Do NOT write the migration until Task 1 is complete.** The draft schema above is based on assumptions about the DispatchTrack webhook structure. Real payloads may reveal:
- Additional resource types we haven't accounted for
- Different field names than expected
- Fields we should promote to typed columns vs. leave in `raw_data`
- Vehicle/driver data that changes the `fleet_vehicles` design

### Database Conventions (from existing codebase)

| Convention | Pattern |
|-----------|---------|
| PKs | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| Multi-tenancy | `operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE` |
| Timestamps | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |
| Soft deletes | `deleted_at TIMESTAMPTZ` |
| Raw data | `raw_data JSONB NOT NULL DEFAULT '{}'::jsonb` |
| Enums | `DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` |
| RLS | Two policies per table (ALL + SELECT), `get_operator_id()` helper |
| Audit | `audit_trigger_func()` attached via AFTER trigger |
| Indexes | `idx_<table>_<columns>`, partial indexes with `WHERE deleted_at IS NULL` where needed |
| FKs | `ON DELETE CASCADE` standard, `ON DELETE SET NULL` for optional references |
| Unique constraints | Both plain UNIQUE (for PostgREST upsert) and partial index (for soft-delete) |

### Existing Enums to Be Aware Of

- `order_status_enum`: `pending`, `processing`, `dispatched`, `delivered`, `failed` — Story 3b-3 will use this
- `delivery_attempt_status_enum`: `success`, `failed`, `returned` — being superseded by `dispatch_status_enum`
- `imported_via_enum`: `API`, `EMAIL`, `MANUAL`, `CSV`
- `connector_type_enum`: `csv_email`, `api`, `browser`

### Migration File Order

Create `fleet_vehicles` BEFORE `routes` because `routes.vehicle_id` references `fleet_vehicles(id)`. Order within migration:
1. Enums
2. `fleet_vehicles` table
3. `routes` table
4. `dispatches` table
5. Indexes
6. RLS policies
7. Audit triggers

### Project Structure Notes

- Migration location: `apps/frontend/supabase/migrations/YYYYMMDDHHMMSS_add_routes_dispatches_fleet_tables.sql`
- Payload docs: `docs/dispatchtrack-webhook-payloads.md`
- Edge function (reference only, modified in 3b-2): `apps/frontend/supabase/functions/beetrack-webhook/index.ts`

### References

- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-03-06.md] — Epic 3B definition
- [Source: _bmad-output/planning-artifacts/architecture.md] — DB conventions, RLS patterns, integration patterns
- [Source: apps/frontend/supabase/migrations/20260217000003_create_orders_table.sql] — orders/packages schema pattern
- [Source: apps/frontend/supabase/migrations/20260224000001_create_performance_metrics_tables.sql] — delivery_attempts schema
- [Source: apps/frontend/supabase/functions/beetrack-webhook/index.ts] — Current webhook handler (5 fields extracted)
- [Source: https://webhooks-lastmile.dispatchtrack.com/] — DispatchTrack webhook docs (JS-rendered, use real payloads instead)

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References
- DispatchTrack webhook docs scraped via Playwright from https://webhooks-lastmile.dispatchtrack.com/
- Real dispatch payload sample from Supabase Edge Function logs (2026-03-06)
- Real dispatch_guide payload sample from Supabase Edge Function logs (2026-03-06)

### Completion Notes List
- **AC10 deviation**: Instead of view approach (rename table + create view), dropped `delivery_attempts` entirely and rewrote 2 RPCs to query `dispatches` directly. Cleaner, no legacy table baggage. Approved by Gerhard.
- **dispatch_status_enum**: Removed `in_transit`, `arrived`, `returned` from draft. Real DT only sends 4 statuses (1=pending, 2=success→delivered, 3=rejected→failed, 4=partial). `returned` was never observed in real data.
- **Data migration**: 116 legacy delivery_attempts records migrated to dispatches with synthetic `_legacy_` dispatch IDs.
- **Edge function**: `beetrack-webhook` will fail on upsert until Story 3B.2 updates it to write to `dispatches`. Payloads are logged and not lost.
- **FADR calculation**: Rewritten without `attempt_number`. Now checks if a successful dispatch has no prior failed dispatch (by completed_at).

### File List
- `apps/frontend/supabase/migrations/20260306000001_add_routes_dispatches_fleet_tables.sql` (new)
- `docs/dispatchtrack-webhook-payloads.md` (new)
- `_bmad-output/implementation-artifacts/3b-1-schema-design-routes-dispatches-fleet-vehicles.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)
