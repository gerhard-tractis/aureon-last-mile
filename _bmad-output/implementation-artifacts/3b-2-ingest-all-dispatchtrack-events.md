# Story 3B.2: Ingest All DispatchTrack Events

Status: ready-for-dev

## Dependencies

Depends on: Story 3B.1 (done — PR #69, #70 merged). Tables `routes`, `dispatches`, `fleet_vehicles` exist in production. `delivery_attempts` table has been dropped.

**CRITICAL**: The `beetrack-webhook` edge function is currently BROKEN — it still writes to `delivery_attempts` which no longer exists. Every webhook call returns a 500 error. Payloads are logged via `console.log` but not persisted. This story must be completed urgently to restore data ingestion.

## Story

As a platform operator,
I want the DispatchTrack webhook to populate `routes`, `dispatches`, and `fleet_vehicles` from ALL webhook resource types,
so that delivery tracking data flows into the new schema and the dashboard has live data again.

## Acceptance Criteria

1. **AC1: Dispatch events upsert into `dispatches`** — When a `resource=dispatch` webhook arrives:
   - Upsert into `dispatches` on `(operator_id, provider, external_dispatch_id)`
   - Map all typed columns from payload (see field mapping below)
   - Store full payload in `raw_data`
   - Look up `order_id` from `orders.order_number` matching `identifier` (nullable — skip if not found)
   - Store `external_route_id` from payload `route_id` field (for later FK backfill)
   - Process ALL statuses (1=pending, 2=delivered, 3=failed, 4=partial) — not just terminal ones

2. **AC2: Route events upsert into `routes`** — When a `resource=route` webhook arrives:
   - Upsert into `routes` on `(operator_id, provider, external_route_id)`
   - Map: `route` → `external_route_id`, `date` → `route_date`, `truck_driver` → `driver_name`
   - Derive `status` from `started`/`ended` booleans:
     - `started=false, ended=false` → `'planned'`
     - `started=true, ended=false` → `'in_progress'`
     - `started=true, ended=true` → `'completed'`
   - Map: `started_at` → `start_time`, `ended_at` → `end_time`, `kpi_distance` → `total_km`
   - Upsert `fleet_vehicles` from `truck` + `vehicle_type` fields
   - Link `vehicle_id` FK to the upserted fleet vehicle
   - **Backfill**: After upserting route, update any `dispatches` rows where `external_route_id` matches and `route_id IS NULL`
   - Store full payload in `raw_data`

3. **AC3: Fleet vehicles auto-created** — When processing dispatch or route events:
   - Upsert `fleet_vehicles` on `(operator_id, provider, external_vehicle_id)` using `truck_identifier` (dispatch) or `truck` (route)
   - Set `vehicle_type` from `truck_type` (dispatch) or `vehicle_type` (route)
   - Return the vehicle's UUID for FK linking

4. **AC4: Dispatch guide events logged** — When a `resource=dispatch_guide` webhook arrives:
   - Log the event (already done via `console.log`)
   - No database write needed (order creation is handled by CSV/WMS import)
   - Return `{ok: true, skipped: "dispatch_guide"}`

5. **AC5: Review events logged** — When a `resource=review` webhook arrives:
   - Log the event
   - No database write needed (future story for customer satisfaction)
   - Return `{ok: true, skipped: "review"}`

6. **AC6: Edge function deployed and verified** — The updated function:
   - Is deployed via `supabase functions deploy beetrack-webhook`
   - Processes real incoming webhooks without errors
   - Populates all three tables with live data
   - Removes the FULL PAYLOAD debug logging (no longer needed)

7. **AC7: Backward compatibility** — The rewritten RPCs (`get_failure_reasons`, `calculate_daily_metrics`) continue working correctly with data in the new `dispatches` table format.

## Tasks / Subtasks

- [x] Task 1: Rewrite the edge function (AC: #1-5)
  - [x] 1.1 Update `STATUS_MAP` to use `dispatch_status_enum` values (`pending`, `delivered`, `failed`, `partial`) — process ALL statuses including pending
  - [x] 1.2 Create `handleDispatch()` function: upsert fleet vehicle → upsert dispatch with all mapped fields → attempt order lookup
  - [x] 1.3 Create `handleRoute()` function: upsert fleet vehicle → upsert route with derived status → backfill `dispatches.route_id`
  - [x] 1.4 Update main handler to route by `resource` type (dispatch → handleDispatch, route → handleRoute, others → log & skip)
  - [x] 1.5 Remove FULL PAYLOAD debug logging
  - [x] 1.6 Add structured logging: `beetrack-webhook: ${resource}/${event} dispatch_id=${id} status=${status}`
- [ ] Task 2: Deploy and verify (AC: #6-7)
  - [ ] 2.1 Deploy with `supabase functions deploy beetrack-webhook`
  - [ ] 2.2 Wait for real webhook events to arrive
  - [ ] 2.3 Verify `dispatches` table has new rows (non-legacy)
  - [ ] 2.4 Verify `fleet_vehicles` table has been populated
  - [ ] 2.5 Verify `get_failure_reasons` RPC returns correct data
  - [ ] 2.6 Verify dashboard still works
- [ ] Task 3: Push via PR (AC: all)
  - [ ] 3.1 Create feature branch, commit edge function changes
  - [ ] 3.2 Create PR with auto-merge
  - [ ] 3.3 Verify CI passes and PR merges

## Dev Notes

### Field Mapping — Dispatch Payload → `dispatches` Table

| Webhook Field | Column | Notes |
|---------------|--------|-------|
| `dispatch_id` | `external_dispatch_id` | Cast integer to string |
| `route_id` | `external_route_id` | Cast integer to string (for FK backfill) |
| `identifier` | → lookup `orders.order_number` | Set `order_id` if found, NULL if not |
| `status` | `status` | Map: 1→pending, 2→delivered, 3→failed, 4→partial |
| `substatus` | `substatus` | Direct |
| `substatus_code` | `substatus_code` | Direct (string, e.g. "07") |
| `position` | `planned_sequence` | Direct |
| `estimated_at` | `estimated_at` | Direct timestamp |
| `arrived_at` | `arrived_at` | Direct timestamp |
| `time_of_management` | `completed_at` | Direct timestamp |
| `management_latitude` | `latitude` | Direct |
| `management_longitude` | `longitude` | Direct |
| `is_pickup` | `is_pickup` | Direct boolean |
| `truck_identifier` | → upsert `fleet_vehicles` | Lookup/create vehicle |
| `truck_type` | → `fleet_vehicles.vehicle_type` | Via vehicle upsert |
| entire body | `raw_data` | Store full payload |

### Field Mapping — Route Payload → `routes` Table

| Webhook Field | Column | Notes |
|---------------|--------|-------|
| `route` | `external_route_id` | Cast integer to string |
| `date` | `route_date` | Date string |
| `truck_driver` | `driver_name` | Direct |
| `truck` | → upsert `fleet_vehicles` | Lookup/create vehicle |
| `vehicle_type` | → `fleet_vehicles.vehicle_type` | Via vehicle upsert |
| `started` / `ended` | `status` | Derive: see AC2 |
| `started_at` | `start_time` | Direct timestamp |
| `ended_at` | `end_time` | Direct timestamp |
| `kpi_distance` | `total_km` | Direct |
| entire body | `raw_data` | Store full payload |

### Upsert Strategy

All upserts use PostgREST's `onConflict` parameter with the table's UNIQUE constraint:
- `dispatches`: `operator_id,provider,external_dispatch_id`
- `routes`: `operator_id,provider,external_route_id`
- `fleet_vehicles`: `operator_id,provider,external_vehicle_id`

Use `ignoreDuplicates: false` to always update on conflict.

### Route Backfill Logic

When a route event creates/updates a `routes` row:
```typescript
// After upserting route, backfill dispatches that reference this route
const { error } = await supabase
  .from('dispatches')
  .update({ route_id: routeRecord.id })
  .eq('operator_id', MUSAN_OPERATOR_ID)
  .eq('provider', 'dispatchtrack')
  .eq('external_route_id', String(body.route))
  .is('route_id', null);
```

### Order Lookup — Non-Blocking

Order lookup is best-effort. If `orders.order_number` doesn't match the dispatch `identifier`, set `order_id = NULL`. The dispatch is still stored. A future reconciliation process can backfill `order_id` when the order arrives via CSV/WMS.

### Edge Function Deployment

```bash
cd apps/frontend
SUPABASE_ACCESS_TOKEN=... npx supabase functions deploy beetrack-webhook --project-ref wfwlcpnkkxxzdvhvvsxb
```

The function runs with `verify_jwt: false` (already configured) since DispatchTrack sends unauthenticated webhooks with a shared secret header.

### Critical Learnings from Story 3B.1

- `delivery_attempts` table NO LONGER EXISTS — dropped in migration `20260306000001`
- `delivery_attempt_status_enum` NO LONGER EXISTS — dropped in same migration
- RPCs (`get_failure_reasons`, `calculate_daily_metrics`) now query `dispatches` table directly
- `dispatches.external_route_id` column added in migration `20260306000002` for route backfill
- Legacy data migrated with `_legacy_` prefix in `external_dispatch_id`
- `dispatch_status_enum` values: `pending`, `delivered`, `failed`, `partial` (no `in_transit`, `arrived`, or `returned`)

### Existing Codebase Patterns

- Edge function location: `apps/frontend/supabase/functions/beetrack-webhook/index.ts`
- Supabase client: `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` — service role bypasses RLS
- Hardcoded operator: `MUSAN_OPERATOR_ID = '92dc5797-047d-458d-bbdb-63f18c0dd1e7'` (single-tenant for now)
- Response format: `{ok: true/false, ...details}` with appropriate HTTP status codes
- Error handling: log error, return 500 with error message

### References

- [Source: apps/frontend/supabase/functions/beetrack-webhook/index.ts] — Current (broken) edge function
- [Source: apps/frontend/supabase/migrations/20260306000001_add_routes_dispatches_fleet_tables.sql] — Schema
- [Source: apps/frontend/supabase/migrations/20260306000002_add_dispatches_external_route_id.sql] — Backfill column
- [Source: docs/dispatchtrack-webhook-payloads.md] — Complete payload documentation with field mappings
- [Source: _bmad-output/implementation-artifacts/3b-1-schema-design-routes-dispatches-fleet-vehicles.md] — Story 3B.1 learnings

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6

### Debug Log References

### Completion Notes List
- Task 1: Rewrote beetrack-webhook edge function. STATUS_MAP now maps all 4 DT statuses to dispatch_status_enum. handleDispatch() upserts fleet_vehicles + dispatches with full field mapping + non-blocking order lookup. handleRoute() upserts fleet_vehicles + routes with derived status + dispatches.route_id backfill. dispatch_guide/review logged and skipped. Full payload debug logging removed, structured logging added.

### File List
- apps/frontend/supabase/functions/beetrack-webhook/index.ts (modified — complete rewrite)
