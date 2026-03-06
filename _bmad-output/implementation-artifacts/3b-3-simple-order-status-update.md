# Story 3B.3: Simple Order Status Update

Status: ready-for-dev

## Dependencies

Depends on: Story 3B.2 (done — PR #71, #72 merged). The `beetrack-webhook` edge function is live and populating `dispatches` with all DispatchTrack events. Order lookup (`orderId`) is already implemented in `handleDispatch()`.

## Story

As a platform operator,
I want orders to automatically transition to `delivered` or `failed` when terminal dispatch events arrive,
so that the dashboard reflects real delivery outcomes without manual intervention.

## Acceptance Criteria

1. **AC1: Delivered orders updated** — When a dispatch webhook arrives with `status=2` (delivered) and the dispatch's `identifier` matches an existing `orders.order_number`:
   - Update `orders.status` to `'delivered'`
   - Set `orders.status_detail` to `'Delivered via DispatchTrack dispatch #{dispatch_id}'`
   - Only update if current status is NOT already `'delivered'` (idempotent)

2. **AC2: Failed orders updated** — When a dispatch webhook arrives with `status=3` (failed) and the dispatch's `identifier` matches an existing order:
   - Update `orders.status` to `'failed'`
   - Set `orders.status_detail` to the dispatch `substatus` text (e.g., "No se encuentra dirección") or fallback `'Failed via DispatchTrack dispatch #{dispatch_id}'`
   - Only update if current status is NOT `'delivered'` (delivered takes precedence — don't downgrade)

3. **AC3: Partial deliveries treated as failed** — When `status=4` (partial):
   - Same behavior as AC2 (map to `orders.status = 'failed'`)
   - Set `status_detail` to include "Partial delivery" context

4. **AC4: Pending dispatches don't update orders** — When `status=1` (pending):
   - Do NOT update `orders.status` (this is a story 3b-5 concern for intermediate states)
   - No change to current behavior

5. **AC5: Missing orders handled gracefully** — When `orderId` is `null` (no matching order found):
   - Do NOT attempt the status update
   - Log a warning: `beetrack-webhook: no order found for identifier={identifier}, skipping status update`
   - The dispatch is still stored (existing behavior, unchanged)

6. **AC6: Edge function deployed and verified** — The updated function:
   - Is deployed via CI/CD (merge to main)
   - Processes real incoming webhooks and updates order statuses
   - Does not break existing dispatch/route/fleet_vehicle ingestion

## Tasks / Subtasks

- [x] Task 1: Add order status update logic to handleDispatch (AC: #1-5)
  - [x] 1.1 After the dispatch upsert succeeds (line ~143), add order status update block
  - [x] 1.2 Define terminal statuses: `delivered`, `failed`, `partial` → trigger order update
  - [x] 1.3 For `delivered`: update `orders.status='delivered'`, `status_detail` with dispatch context
  - [x] 1.4 For `failed`/`partial`: update `orders.status='failed'`, `status_detail` with substatus or "Partial delivery" context
  - [x] 1.5 Guard: skip update if `orderId` is null
  - [x] 1.6 Guard: skip update if order is already `'delivered'` (don't downgrade)
  - [x] 1.7 Add structured logging for status updates: `beetrack-webhook: order ${orderId} status → ${newStatus}`
- [ ] Task 2: Deploy and verify (AC: #6)
  - [ ] 2.1 Push via PR with auto-merge
  - [ ] 2.2 Wait for real terminal dispatch webhooks to arrive
  - [ ] 2.3 Verify `orders` table has rows with `status='delivered'` or `status='failed'`
  - [ ] 2.4 Verify `orders.status_detail` is populated
  - [ ] 2.5 Verify non-terminal dispatches (status=1) did NOT update orders
  - [ ] 2.6 Verify dispatches/routes/fleet_vehicles ingestion still works

## Dev Notes

### Implementation Location

Single file change: `apps/frontend/supabase/functions/beetrack-webhook/index.ts`

The order status update goes **after the dispatch upsert** (after line 143 in current code), inside the existing `handleDispatch()` function. The `orderId` is already resolved at line 105.

### Status Mapping

| Dispatch Status Code | `dispatch_status_enum` | → `order_status_enum` | Action |
|---|---|---|---|
| 1 | `pending` | — | No order update (story 3b-5) |
| 2 | `delivered` | `delivered` | Update order |
| 3 | `failed` | `failed` | Update order |
| 4 | `partial` | `failed` | Update order (treat partial as failed) |

### Order Status Enum (existing)

```sql
CREATE TYPE order_status_enum AS ENUM (
  'pending',      -- Imported, awaiting processing
  'processing',   -- Being dispatched / assigned to route
  'dispatched',   -- Out for delivery
  'delivered',    -- Successfully delivered
  'failed'        -- Delivery failed
);
```

Default: `'pending'`. Terminal values used by this story: `'delivered'` and `'failed'`.

### Status Detail Population

- **Delivered**: `"Delivered via DispatchTrack dispatch #${dispatchId}"`
- **Failed**: Use `substatus` from webhook payload (e.g., "No se encuentra dirección", "Cliente ausente"). Fallback: `"Failed via DispatchTrack dispatch #${dispatchId}"`
- **Partial**: `"Partial delivery via DispatchTrack dispatch #${dispatchId}" + substatus if available`

### Idempotency & Precedence

- **Delivered is final**: Once an order is `delivered`, no webhook should change it. Guard with `NOT status = 'delivered'` in the update WHERE clause.
- **Failed can be overridden by delivered**: If a dispatch arrives as `failed` first, then a later re-attempt succeeds with `delivered`, the order should update to `delivered`. This is handled naturally — `delivered` has no guard preventing the update.
- **Multiple dispatches per order**: An order can have multiple dispatch attempts. The latest terminal status wins (except `delivered` is never downgraded).

### Suggested Implementation

```typescript
// After dispatch upsert succeeds (line ~143):

// Update order status for terminal dispatches
if (orderId && (status === 'delivered' || status === 'failed' || status === 'partial')) {
  const orderStatus = status === 'delivered' ? 'delivered' : 'failed';
  let statusDetail: string;
  if (status === 'delivered') {
    statusDetail = `Delivered via DispatchTrack dispatch #${dispatchId}`;
  } else if (status === 'partial') {
    statusDetail = `Partial delivery via DispatchTrack dispatch #${dispatchId}${substatus ? ` — ${substatus}` : ''}`;
  } else {
    statusDetail = substatus || `Failed via DispatchTrack dispatch #${dispatchId}`;
  }

  const { error: orderError } = await supabase
    .from('orders')
    .update({ status: orderStatus, status_detail: statusDetail })
    .eq('id', orderId)
    .neq('status', 'delivered'); // Never downgrade from delivered

  if (orderError) {
    console.warn(`beetrack-webhook: order status update failed for ${orderId}`, orderError);
    // Non-blocking — dispatch is already saved
  } else {
    console.log(`beetrack-webhook: order ${orderId} status → ${orderStatus}`);
  }
}
```

### Auth & RLS

The edge function uses `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS entirely. No migration or policy changes needed.

### No Migration Required

This story modifies only the edge function. The `orders.status` column and `order_status_enum` already exist with the correct values (`delivered`, `failed`). The `status_detail` column also already exists.

### What This Story Does NOT Do

- No intermediate states (`in_route`, `out_for_delivery`) — that's story 3b-5
- No OTIF calculation — that's story 3b-4
- No backfill of historical dispatches → orders — only new webhooks going forward
- No UI changes — dashboard already reads from RPCs that query `dispatches` table

### Project Structure Notes

- Single file modification: `apps/frontend/supabase/functions/beetrack-webhook/index.ts`
- Edge function deploys automatically when PR merges to main (CI/CD pipeline)
- No new dependencies, no new files, no migration

### References

- [Source: apps/frontend/supabase/functions/beetrack-webhook/index.ts] — Edge function with handleDispatch (lines 68-147)
- [Source: apps/frontend/supabase/migrations/20260223000001_create_automation_worker_schema.sql] — order_status_enum definition (lines 54-66), orders.status column (lines 338-343)
- [Source: _bmad-output/implementation-artifacts/3b-2-ingest-all-dispatchtrack-events.md] — Story 3B.2 learnings, field mappings
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-03-06.md] — Epic 3B scope definition

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
