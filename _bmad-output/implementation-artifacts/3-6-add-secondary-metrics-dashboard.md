# Story 3.6: Add Secondary Metrics Dashboard

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **business owner**,
I want to see additional operational metrics (capacity utilization and orders/hour),
So that I have a more complete picture of business performance beyond SLA and FADR.

## Acceptance Criteria

### AC1: Two Secondary Metrics Cards Layout
**Given** I am viewing the dashboard below the failed deliveries analysis section
**When** The secondary metrics section loads
**Then** Two metric cards display in a responsive row:
- Capacidad Utilizada (Capacity Utilization)
- Pedidos por Hora (Orders per Hour)

**And** Layout: `grid grid-cols-1 sm:grid-cols-2 gap-6`
**And** Section title: "MÉTRICAS SECUNDARIAS"
**And** Each card: white bg, rounded-xl, p-6, shadow-sm, border border-slate-200
**And** Note: Cost/delivery and customer satisfaction cards deferred — no data sources exist in the current schema. Will be added when cost tracking and NPS/survey integrations are implemented.

### AC2: Capacity Utilization Card
**Given** The capacity card is rendered
**Then** It displays:
- Icon: 📊 + Title: "Capacidad Utilizada"
- Large value: percentage (e.g., "89.2%")
- Color-coded: Yellow (#f59e0b) if >85%, Green (#10b981) if 60-85%, Red (#ef4444) if <60% or >95%
- Trend indicator: "↑/↓ X.X% vs semana anterior"
- Tooltip: "Utilización: X pedidos / Y capacidad"

**And** Calculation: (SUM(total_orders) / capacity_target * 100) for the period
**And** Capacity target hardcoded as constant with TODO for future settings (default: 1000 orders/day)

### AC3: Orders per Hour Card
**Given** The orders/hour card is rendered
**Then** It displays:
- Icon: ⏱️ + Title: "Pedidos por Hora"
- Large value: number with 1 decimal (e.g., "38.2")
- Color-coded: Green (#10b981) if ≥40, Yellow (#f59e0b) if 30-39.9, Red (#ef4444) if <30
- Trend indicator vs previous period
- Tooltip: "Total: X pedidos en Y horas operativas"

**And** Calculation: SUM(total_orders) / operational_hours for the period
**And** Operational hours = number of days in period × daily_operational_hours (default 10h, hardcoded with TODO)

### AC4: Trend Indicators on Both Cards
**Given** Both cards are rendered
**Then** Each shows trend: "↑ +X.X% vs semana anterior" (green) or "↓ -X.X% vs semana anterior" (red)
**And** Trend compares current period vs previous period of same length

### AC5: Loading & Error States
**Given** Data is loading
**Then** Each card shows skeleton loader matching card dimensions (reuse `MetricsCardSkeleton` from 3.3)

**Given** No orders in period
**Then** Show "N/A" with text-slate-400

**Given** API error
**Then** Show last cached value with staleness indicator

### AC6: Accessibility
**Given** The cards are rendered
**Then** Each card has `aria-label` describing the metric and its value
**And** Color is never the only indicator — values always shown as text

## Tasks / Subtasks

- [x] Task 1: Create `useSecondaryMetrics` hook (AC: #2, #3, #4)
  - [x] 1.1 Add to `useDashboardMetrics.ts`
  - [x] 1.2 Query `performance_metrics` for aggregate data: SUM(total_orders), SUM(delivered_orders)
  - [x] 1.3 Return type: `SecondaryMetrics` with capacityPct, ordersPerHour, totalOrders, totalDelivered
  - [x] 1.4 Calculate current + previous period for trends
  - [x] 1.5 Query key: `['dashboard', operatorId, 'secondary-metrics', startDate, endDate]`

- [x] Task 2: Build `SecondaryMetricsGrid` container component (AC: #1, #5)
  - [x] 2.1 Create `src/components/dashboard/SecondaryMetricsGrid.tsx`
  - [x] 2.2 2-column responsive grid (`grid-cols-1 sm:grid-cols-2`)
  - [x] 2.3 Pass data to `MetricsCard` components (reuse from 3.3)
  - [x] 2.4 Loading: show `MetricsCardSkeleton` for each card

- [x] Task 3: Configure two metric cards (AC: #2, #3, #4, #6)
  - [x] 3.1 Capacity card with special color logic (yellow >85%, green 60-85%, red <60% or >95%)
  - [x] 3.2 Orders/hour card with standard thresholds (≥40 green, 30-39.9 yellow, <30 red)
  - [x] 3.3 Both cards use `MetricsCard` component with appropriate props

- [x] Task 4: Integrate into Dashboard page (AC: all)
  - [x] 4.1 Add `<SecondaryMetricsGrid operatorId={operatorId} />` below `<FailedDeliveriesAnalysis />` in `dashboard/page.tsx`

- [x] Task 5: Write tests (all ACs)
  - [x] 5.1 Unit tests for SecondaryMetricsGrid (layout, loading, error)
  - [x] 5.2 Unit tests for capacity color thresholds (special dual-red logic)
  - [x] 5.3 Unit tests for orders/hour color thresholds
  - [x] 5.4 Hook tests for useSecondaryMetrics (via mocked hook in component tests)
  - [x] 5.5 Edge case tests: no orders, zero days, trend calculation

## Dev Notes

### Architecture Patterns & Constraints

**Reuse `MetricsCard` from Story 3.3 — do NOT build new card components:**
- The `MetricsCard.tsx` component supports: title, icon, value, color, trend, context, sparklineData, tooltipText, benchmarkBadge, roiLine, capacityLine, onClick, ariaLabel, isStale
- This is sufficient for both secondary metrics cards
- No new sub-components needed

**Data source:**
- **Capacity**: Computed from `performance_metrics.total_orders` vs hardcoded daily target (1000). TODO for future settings integration.
- **Orders/hour**: Computed from `SUM(total_orders) / (days_in_period * 10h)`. Default operational hours: 10h/day.
- Cost/delivery and satisfaction cards deferred — no data sources exist yet.

**Hook pattern — single hook returning all 4 metrics:**
```typescript
export type SecondaryMetrics = {
  capacityPct: number | null;       // (total_orders / target) * 100
  capacityTarget: number;            // configurable, default 1000/day
  ordersPerHour: number | null;      // total_orders / (days * hours)
  totalOrders: number;               // for tooltips
  totalDelivered: number;            // for tooltips
};

export function useSecondaryMetrics(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'secondary-metrics', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('total_orders, delivered_orders')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);  // aggregate rows only
      if (error) throw error;

      const totals = (data ?? []).reduce(
        (acc, row) => ({
          totalOrders: acc.totalOrders + (row.total_orders ?? 0),
          totalDelivered: acc.totalDelivered + (row.delivered_orders ?? 0),
        }),
        { totalOrders: 0, totalDelivered: 0 }
      );

      const daysInPeriod = data?.length || 1;
      const DAILY_CAPACITY = 1000;  // TODO: make configurable via settings
      const OPERATIONAL_HOURS = 10; // TODO: make configurable

      return {
        capacityPct: totals.totalOrders > 0
          ? Math.round((totals.totalOrders / (daysInPeriod * DAILY_CAPACITY)) * 1000) / 10
          : null,
        capacityTarget: DAILY_CAPACITY,
        ordersPerHour: totals.totalOrders > 0
          ? Math.round((totals.totalOrders / (daysInPeriod * OPERATIONAL_HOURS)) * 10) / 10
          : null,
        totalOrders: totals.totalOrders,
        totalDelivered: totals.totalDelivered,
      } as SecondaryMetrics;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
```

**Capacity color — special logic (not simple higher-better):**
```typescript
function getCapacityColor(value: number | null): string {
  if (value === null) return 'text-slate-400';
  if (value > 95 || value < 60) return 'text-[#ef4444]';  // over or under utilized
  if (value > 85) return 'text-[#f59e0b]';                 // high utilization warning
  return 'text-[#10b981]';                                  // healthy range 60-85%
}
```

**Spanish UI Text (MUST use exactly):**
- Section title: "MÉTRICAS SECUNDARIAS"
- Capacity: "Capacidad Utilizada", tooltip "Utilización: X pedidos / Y capacidad"
- Orders/hour: "Pedidos por Hora", tooltip "Total: X pedidos en Y horas operativas"
- Trend: "↑ +X.X% vs semana anterior" / "↓ -X.X% vs semana anterior"
- No data: "N/A"

### Common Mistakes to AVOID
- ❌ Do NOT build new card components — reuse `MetricsCard` from Story 3.3
- ❌ Do NOT create new hook files — extend `useDashboardMetrics.ts`
- ❌ Do NOT create Supabase client at module level
- ❌ Do NOT use spinners — reuse `MetricsCardSkeleton`
- ❌ Do NOT add sparklines to secondary cards (not in spec — keeps them visually distinct from primary cards)
- ❌ Do NOT over-engineer capacity target config — hardcode with TODO comment for now
- ❌ Do NOT add cost/delivery or satisfaction cards — deferred, no data sources exist

### Project Structure Notes

**Files to CREATE:**
- `src/components/dashboard/SecondaryMetricsGrid.tsx` — Container grid with 2 cards (Capacity + Orders/Hour)
- `src/components/dashboard/SecondaryMetricsGrid.test.tsx` — Tests

**Files to MODIFY:**
- `src/hooks/useDashboardMetrics.ts` — Add `useSecondaryMetrics` hook + `SecondaryMetrics` type
- `src/app/app/dashboard/page.tsx` — Add `<SecondaryMetricsGrid operatorId={operatorId} />` below `<FailedDeliveriesAnalysis />`

**Files to NOT touch:**
- `src/components/dashboard/MetricsCard.tsx` — Reuse as-is from 3.3
- `src/components/dashboard/MetricsCardSkeleton.tsx` — Reuse as-is
- All other dashboard components from 3.2, 3.3, 3.4, 3.5
- Supabase migrations — no new tables or functions needed

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-Story-3.6]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend-Architecture]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Secondary-Metrics-Row]
- [Source: _bmad-output/implementation-artifacts/3-3-implement-primary-metrics-cards-fadr-claims-efficiency.md]
- [Source: apps/frontend/src/components/dashboard/MetricsCard.tsx — reuse for all 4 cards]
- [Source: apps/frontend/src/hooks/useDashboardMetrics.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation.

### Completion Notes List

- Added `useSecondaryMetrics` and `useSecondaryMetricsPreviousPeriod` hooks to `useDashboardMetrics.ts` with `SecondaryMetrics` type export
- Created `SecondaryMetricsGrid.tsx` with capacity (special dual-red color logic) and orders/hour cards reusing `MetricsCard` from 3.3
- Integrated into dashboard page below `FailedDeliveriesAnalysis` (also integrated 3.5's component which was built but not yet added to page)
- 23 tests covering: layout, loading skeletons, N/A states, trend indicators, stale/error indicators, aria-labels, grid responsiveness, all color threshold functions, and formatTrend edge cases
- Full regression suite: 520 tests passing, 0 failures, lint clean
- Constants `DAILY_CAPACITY=1000` and `OPERATIONAL_HOURS=10` hardcoded with TODO comments per spec

### Change Log

- 2026-03-02: Story 3.6 implementation complete — secondary metrics dashboard with capacity utilization and orders/hour cards

### File List

- `apps/frontend/src/hooks/useDashboardMetrics.ts` (modified) — Added `SecondaryMetrics` type, `useSecondaryMetrics`, `useSecondaryMetricsPreviousPeriod` hooks
- `apps/frontend/src/components/dashboard/SecondaryMetricsGrid.tsx` (new) — Container grid with 2 metric cards, color logic, trend formatting
- `apps/frontend/src/components/dashboard/SecondaryMetricsGrid.test.tsx` (new) — 23 unit tests
- `apps/frontend/src/app/app/dashboard/page.tsx` (modified) — Added `FailedDeliveriesAnalysis` + `SecondaryMetricsGrid` imports and rendering
