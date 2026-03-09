# Story 3B.4: OTIF Metrics, Pending Orders & Dashboard Widget

Status: review

## Dependencies

Depends on: Story 3B.3 (done — PRs #73, #74 merged). Orders now have `status='delivered'` / `status='failed'` from terminal dispatch webhooks. 505 delivered + 25 failed orders confirmed in production. Dispatches table has `estimated_at`, `completed_at`, and `status` fields populated.

## Story

As a platform operator,
I want to see OTIF metrics, delivery outcome breakdown, and pending/overdue order counts on the dashboard,
so that I can measure delivery performance and identify orders needing immediate attention.

## Acceptance Criteria

1. **AC1: OTIF RPC** — A Supabase RPC `get_otif_metrics(p_operator_id UUID, p_start_date DATE, p_end_date DATE)` returns JSON:
   - `total_orders` — count of orders with `delivery_date` in range and `deleted_at IS NULL`
   - `delivered_orders` — count where `status = 'delivered'`
   - `failed_orders` — count where `status = 'failed'`
   - `pending_orders` — count where `status NOT IN ('delivered', 'failed')`
   - `on_time_deliveries` — count where `status = 'delivered'` AND the order's latest terminal dispatch `completed_at::date <= orders.delivery_date`
   - `otif_percentage` — `on_time_deliveries / NULLIF(delivered_orders, 0) * 100` (NULL if no deliveries)
   - Filters by `operator_id` and `delivery_date BETWEEN p_start_date AND p_end_date`

2. **AC2: Pending orders RPC** — A Supabase RPC `get_pending_orders_summary(p_operator_id UUID)` returns JSON:
   - `overdue_count` — orders where `status NOT IN ('delivered', 'failed')` AND `delivery_date < CURRENT_DATE` AND `deleted_at IS NULL`
   - `due_today_count` — same status filter AND `delivery_date = CURRENT_DATE`
   - `due_tomorrow_count` — same status filter AND `delivery_date = CURRENT_DATE + 1`
   - `total_pending` — sum of above
   - Filters by `operator_id`

3. **AC3: Dashboard "Delivery" tab** — Add a new tab `delivery` to PipelineNav (between "Carga" and "Retiro"):
   - Tab label: `⑦ Entregas` (or next available step number)
   - Enabled: `true`
   - Route: `?tab=delivery`

4. **AC4: OTIF widget** — On the delivery tab, show an OTIF card:
   - Large OTIF percentage with color coding (green ≥95%, yellow ≥85%, red <85%)
   - Subtitle: "X de Y pedidos entregados a tiempo"
   - Uses date range from existing dashboard date filter (or defaults to last 30 days)

5. **AC5: Delivery outcome strip** — Below OTIF, show 3 KPI cards:
   - "Entregados" (green) — `delivered_orders` count
   - "Fallidos" (red) — `failed_orders` count
   - "Pendientes" (yellow) — `pending_orders` count
   - Each shows percentage of `total_orders`

6. **AC6: Pending orders alert strip** — Below delivery outcomes, show pending alert cards:
   - "Atrasados" (red, pulsing if >0) — `overdue_count`
   - "Para Hoy" (yellow) — `due_today_count`
   - "Para Mañana" (slate) — `due_tomorrow_count`
   - Each card links/scrolls to a filtered view (future story)

7. **AC7: Data refreshes** — All widgets use TanStack Query with 30s stale time and 60s refetch interval (same pattern as LoadingTab).

## Tasks / Subtasks

- [x] Task 1: Create OTIF metrics RPC migration (AC: #1)
  - [x] 1.1 Create migration file `apps/frontend/supabase/migrations/20260309000001_create_otif_metrics_functions.sql`
  - [x] 1.2 Implement `get_otif_metrics` function — join `orders` with `dispatches` for on-time calculation
  - [x] 1.3 Implement `get_pending_orders_summary` function (AC: #2)
- [x] Task 2: Add "Delivery" tab to PipelineNav (AC: #3)
  - [x] 2.1 Add `'delivery'` to `PipelineTab` type in `PipelineNav.tsx`
  - [x] 2.2 Add tab entry to `TABS` array with `enabled: true`
  - [x] 2.3 Update `page.tsx` to render `DeliveryTab` when `activeTab === 'delivery'`
- [x] Task 3: Create React hooks for OTIF and pending data (AC: #7)
  - [x] 3.1 Create `apps/frontend/src/hooks/useDeliveryMetrics.ts`
  - [x] 3.2 Implement `useOtifMetrics(operatorId, startDate, endDate)` hook — calls `get_otif_metrics` RPC
  - [x] 3.3 Implement `usePendingOrders(operatorId)` hook — calls `get_pending_orders_summary` RPC
- [x] Task 4: Build DeliveryTab component (AC: #4-6)
  - [x] 4.1 Create `apps/frontend/src/components/dashboard/DeliveryTab.tsx`
  - [x] 4.2 Build OTIF hero card with percentage, color threshold, and subtitle
  - [x] 4.3 Build delivery outcome KPI strip (3 cards: delivered, failed, pending)
  - [x] 4.4 Build pending orders alert strip (3 cards: overdue, today, tomorrow)
  - [x] 4.5 Add loading skeletons matching `LoadingKPIStrip` pattern
- [x] Task 5: Write tests (AC: all)
  - [x] 5.1 Unit tests for RPC functions (SQL test or via Supabase client)
  - [x] 5.2 Component tests for DeliveryTab, OTIF card, KPI strips
- [ ] Task 6: Deploy and verify (AC: all)
  - [ ] 6.1 Push via PR with auto-merge
  - [ ] 6.2 Verify migration applies cleanly
  - [ ] 6.3 Verify RPCs return correct data against known production counts (505 delivered, 25 failed)
  - [ ] 6.4 Verify dashboard delivery tab renders with live data

## Dev Notes

### OTIF Calculation Logic

OTIF = On-Time In-Full. For Musan, "In-Full" is implicit (order either delivered or not). "On-Time" means delivered on or before the committed `delivery_date`.

```sql
-- Core OTIF query pattern:
SELECT
  COUNT(*) AS total_orders,
  COUNT(*) FILTER (WHERE o.status = 'delivered') AS delivered_orders,
  COUNT(*) FILTER (WHERE o.status = 'failed') AS failed_orders,
  COUNT(*) FILTER (WHERE o.status NOT IN ('delivered', 'failed')) AS pending_orders,
  COUNT(*) FILTER (
    WHERE o.status = 'delivered'
    AND EXISTS (
      SELECT 1 FROM dispatches d
      WHERE d.order_id = o.id
        AND d.status = 'delivered'
        AND d.completed_at::date <= o.delivery_date
        AND d.deleted_at IS NULL
    )
  ) AS on_time_deliveries
FROM orders o
WHERE o.operator_id = p_operator_id
  AND o.delivery_date BETWEEN p_start_date AND p_end_date
  AND o.deleted_at IS NULL;
```

**Edge case**: If an order has multiple dispatches (retry), only the terminal `delivered` dispatch matters. The `EXISTS` subquery handles this — it finds any delivered dispatch that completed on time.

**Edge case**: Some orders may not have a matching dispatch (imported via CSV but never dispatched). These remain as `pending_orders`.

**Edge case**: `delivery_date` might be NULL for some imported orders. Exclude them (`delivery_date IS NOT NULL`).

### Pending Orders — No Date Range

`get_pending_orders_summary` has NO date range — it returns the current operational state:
- **Overdue**: `delivery_date < TODAY` AND not delivered/failed → immediate action needed
- **Due today**: `delivery_date = TODAY` AND not delivered/failed → in-flight
- **Due tomorrow**: `delivery_date = TOMORROW` AND not delivered/failed → planning visibility

### Migration File Naming

Follow existing pattern: `YYYYMMDD000001_description.sql`. Use today's date: `20260309000001_create_otif_metrics_functions.sql`.

### PipelineNav Tab Addition

Current tabs in order: overview, loading, pickup (disabled), reception (disabled), distribution (disabled), routing (disabled), lastmile (disabled).

Add `delivery` as a NEW enabled tab. Suggested position: after `loading` (step ②), since it represents the "last mile" outcome. Update the `PipelineTab` type union and `TABS` array.

```typescript
// Add to PipelineTab type:
export type PipelineTab = 'overview' | 'loading' | 'delivery' | 'pickup' | ...;

// Add to TABS array after loading:
{ id: 'delivery', step: '⑦', label: 'Entregas', enabled: true },
```

### Frontend Component Architecture

Follow the `LoadingTab` pattern exactly:

```
apps/frontend/src/
├── components/dashboard/
│   ├── DeliveryTab.tsx          — Main tab container
│   └── (reuse existing LoadingKPIStrip pattern for cards)
├── hooks/
│   └── useDeliveryMetrics.ts    — TanStack Query hooks for RPCs
```

### Hook Pattern — Follow `useLoadingMetrics.ts`

```typescript
const DELIVERY_QUERY_OPTIONS = {
  staleTime: 30000,
  refetchInterval: 60000,
  placeholderData: keepPreviousData,
} as const;

export function useOtifMetrics(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['delivery', operatorId, 'otif', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_otif_metrics',
        { p_operator_id: operatorId, p_start_date: startDate, p_end_date: endDate }
      );
      if (error) throw error;
      return data as OtifMetrics;
    },
    enabled: !!operatorId,
    ...DELIVERY_QUERY_OPTIONS,
  });
}
```

### Color Threshold for OTIF

Follow `MetricsCard.tsx` color threshold pattern:
```typescript
const OTIF_THRESHOLDS: ColorThresholds = {
  green: 95,    // ≥95% = green
  yellow: 85,   // ≥85% = yellow
  direction: 'higher-better',  // <85% = red
};
```

### Date Range

The delivery tab needs a date range. Options:
1. **Reuse existing dashboard date filter** if available (check `useDashboardMetrics` or similar)
2. **Default to last 30 days** (`today - 30d` to `today`) with a simple date picker

Check how `LoadingTab` handles dates — it receives `operatorId` as prop and uses its own date state. Follow the same pattern.

### Existing Order Status Enum

```sql
-- order_status_enum: 'pending', 'processing', 'dispatched', 'delivered', 'failed'
-- For OTIF: delivered = success, failed = failure
-- For pending: anything NOT in ('delivered', 'failed') is "pending" from a delivery perspective
```

### RLS & Security

RPCs should use `SECURITY INVOKER` (default) so RLS on `orders` and `dispatches` tables applies. The authenticated user's `operator_id` from JWT will filter correctly.

However, the RPC takes `p_operator_id` as a parameter. Ensure the RPC filters by this param AND the underlying RLS policy enforces it. This matches existing patterns (`calculate_sla`, `calculate_fadr`).

### Production Data for Verification

As of 2026-03-09:
- 505 orders with `status='delivered'`
- 25 orders with `status='failed'`
- ~2,002 orders still in `pending` status
- Total ~2,532 orders

### What This Story Does NOT Do

- No drill-down to individual orders (future story)
- No OTIF by retailer breakdown (could be added but out of scope)
- No historical OTIF trend chart (could be added in enhancement)
- No intermediate order states (story 3b-5)
- No fleet metrics (story 3b-6)

### Project Structure Notes

- Migration: `apps/frontend/supabase/migrations/` — auto-deployed on merge to main
- Components: `apps/frontend/src/components/dashboard/` — existing dashboard folder
- Hooks: `apps/frontend/src/hooks/` — follows existing hook file pattern
- Page modification: `apps/frontend/src/app/app/dashboard/page.tsx` — add delivery tab render
- PipelineNav modification: `apps/frontend/src/components/dashboard/PipelineNav.tsx` — add tab

### References

- [Source: apps/frontend/supabase/migrations/20260306000001_add_routes_dispatches_fleet_tables.sql] — dispatches schema with estimated_at, completed_at
- [Source: apps/frontend/supabase/migrations/20260224000002_create_metrics_functions.sql] — existing RPC patterns (calculate_sla, calculate_fadr, get_failure_reasons)
- [Source: apps/frontend/supabase/migrations/20260305000001_create_loading_metrics_functions.sql] — loading metrics RPC pattern
- [Source: apps/frontend/src/hooks/useLoadingMetrics.ts] — TanStack Query hook pattern for RPCs
- [Source: apps/frontend/src/components/dashboard/LoadingTab.tsx] — Tab component pattern
- [Source: apps/frontend/src/components/dashboard/LoadingKPIStrip.tsx] — KPI card pattern
- [Source: apps/frontend/src/components/dashboard/MetricsCard.tsx] — Color threshold pattern
- [Source: apps/frontend/src/components/dashboard/PipelineNav.tsx] — Tab navigation with PipelineTab type
- [Source: apps/frontend/src/app/app/dashboard/page.tsx] — Dashboard page with tab routing
- [Source: _bmad-output/implementation-artifacts/3b-3-simple-order-status-update.md] — Story 3B.3 learnings, order status mapping
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-03-06.md] — Epic 3B scope definition

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Task 1: Created SQL migration with `get_otif_metrics` (OTIF with on-time via dispatches join) and `get_pending_orders_summary` (overdue/today/tomorrow counts). Both SECURITY INVOKER for RLS.
- Task 2: Added `'delivery'` to PipelineTab type and TABS array (⑦ Entregas, enabled). Wired DeliveryTab in page.tsx.
- Task 3: Created `useDeliveryMetrics.ts` with `useOtifMetrics` and `usePendingOrders` hooks. 30s stale, 60s refetch, keepPreviousData.
- Task 4: Built DeliveryTab with OTIF hero card (color-coded: green ≥95%, yellow ≥85%, red <85%), delivery outcome strip (3 cards), pending alert strip (3 cards with pulsing overdue indicator). Loading skeletons included.
- Task 5: 16 new tests across 2 test files. 666 total tests pass, 0 regressions. Updated PipelineNav.test.tsx and page.test.tsx for new tab.

### Change Log

- 2026-03-09: Implemented OTIF metrics RPCs, delivery dashboard tab, hooks, and tests (Tasks 1-5)

### File List

- `apps/frontend/supabase/migrations/20260309000001_create_otif_metrics_functions.sql` (new)
- `apps/frontend/src/hooks/useDeliveryMetrics.ts` (new)
- `apps/frontend/src/hooks/useDeliveryMetrics.test.ts` (new)
- `apps/frontend/src/components/dashboard/DeliveryTab.tsx` (new)
- `apps/frontend/src/components/dashboard/DeliveryTab.test.tsx` (new)
- `apps/frontend/src/components/dashboard/PipelineNav.tsx` (modified — added delivery tab)
- `apps/frontend/src/components/dashboard/PipelineNav.test.tsx` (modified — added Entregas assertion)
- `apps/frontend/src/app/app/dashboard/page.tsx` (modified — added DeliveryTab import and render)
- `apps/frontend/src/app/app/dashboard/page.test.tsx` (modified — added DeliveryTab mock and test)
