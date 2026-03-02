# Story 3.3: Implement Primary Metrics Cards (FADR, Claims, Efficiency)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **business owner**,
I want to see key operational metrics (FADR, shortage claims, delivery efficiency) in prominent cards below the SLA section,
So that I can quickly assess overall performance beyond just SLA compliance.

## Acceptance Criteria

### AC1: Three Primary Metrics Cards Layout
**Given** I am viewing the dashboard at `/app/dashboard`
**When** The page loads below the hero SLA section
**Then** Three primary metrics cards display side-by-side in a responsive grid:
- FADR card (First Attempt Delivery Rate)
- Shortage Claims card (Reclamos)
- Efficiency card (Eficiencia)

**And** Cards use `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6` layout below the HeroSLA component
**And** Each card matches the design system: white bg, rounded-xl, p-6, shadow-sm, border border-slate-200, `min-h-[240px]`
**And** Each card has hover effect: `hover:shadow-lg hover:scale-[1.01] transition-all duration-300`
**And** Responsive font scaling: `lg:` uses full sizes, `md:` scales down ~10-15%

### AC2: FADR Card
**Given** The FADR card is rendered
**Then** It displays:
- Icon: 🎯 + Title: "FADR" (text-lg font-semibold text-slate-700)
- Large metric value: percentage (text-[3rem] font-bold, scales to text-[2.5rem] on md) e.g. "92.1%"
- Color-coded: Green (#10b981) if ≥95%, Yellow (#f59e0b) if 90-94.9%, Red (#ef4444) if <90%
- Trend indicator: "↑ +X.X% vs semana anterior" or "↓ -X.X% vs semana anterior"
- Benchmark badge on card: "⭐ Excelente (>95%)" / "✓ Bueno (>90%)" / "⚠️ Bajo estándar (<90%)"
- Context line: "281/305 primera entrega exitosa" (text-sm text-slate-500)
- Mini sparkline chart (recharts) showing last 7 days trend
- Tooltip on hover: "Primera Entrega: Porcentaje de entregas exitosas en el primer intento. >95% = excelente, >90% = bueno. Reduce costos de re-entregas."

**And** Clicking the card opens a drill-down dialog with:
- 30-day historical FADR chart
- Breakdown by retailer
- Benchmark indicator: "Excelente (>95%)" / "Bueno (>90%)" / "Bajo estándar (<90%)"

### AC3: Shortage Claims Card (Reclamos)
**Given** The Shortage Claims card is rendered
**Then** It displays:
- Icon: 💰 + Title: "Reclamos" (text-lg font-semibold text-slate-700)
- Large metric value: amount in CLP (text-[3rem] font-bold, scales to text-[2.5rem] on md) e.g. "150,000 CLP"
- Color-coded by **trend direction**: Red (#ef4444) if increasing vs previous period, Green (#10b981) if decreasing. Additionally use absolute thresholds for the value color: Red if >100K, Yellow (#f59e0b) if 50K-100K, Green if <50K
- Trend indicator: "↓ -80% vs semana anterior" (showing change vs previous period)
- ROI savings indicator: "💾 Ahorro: X CLP este mes" — shows prevented financial exposure via discrepancy detection
- Context line: "N reclamos en periodo" (text-sm text-slate-500)
- Mini sparkline chart (recharts) showing last 7 days trend
- Tooltip on hover: "Reclamos de Indemnización: Multas por diferencias entre manifest y entrega. Sistema previene al detectar discrepancias ANTES de firmar."

**And** Clicking the card opens a drill-down dialog with:
- Breakdown: count of claims, average per claim
- 30-day historical claims chart
- Per-retailer claims breakdown

### AC4: Efficiency Card (Eficiencia)
**Given** The Efficiency card is rendered
**Then** It displays:
- Icon: ⚡ + Title: "Eficiencia" (text-lg font-semibold text-slate-700)
- Large metric value: time in minutes (text-[3rem] font-bold, scales to text-[2.5rem] on md) e.g. "42 min"
- Color-coded: Green (#10b981) if ≤40min, Yellow (#f59e0b) if 40-60min, Red (#ef4444) if >60min
- Trend indicator: "↑ -X min vs semana anterior" (improvement = green even though number is lower)
- Capacity indicator: "📊 X% capacidad" — utilization percentage (actual_orders/capacity)
- Context line: "N pedidos procesados" (text-sm text-slate-500)
- Mini sparkline chart (recharts) showing last 7 days trend
- Tooltip on hover: "Tiempo promedio de carga por camión. Manual: ~2 horas. Con Aureon: 42 minutos. Ahorro: 78 minutos/camión."

### AC5: Edge Cases & Loading States
**Given** Data is loading
**Then** Each card shows a skeleton loader matching the card dimensions (NOT a spinner)

**Given** No delivery attempts exist in the period
**Then** FADR card shows "N/A" with text-slate-400 color

**Given** No shortage claims exist
**Then** Claims card shows "0 CLP" in green (#10b981)

**Given** A metric calculation fails (RPC error)
**Then** The card shows last cached value with a staleness indicator icon (⚠️ "Los datos pueden estar desactualizados")

### AC6: Sparkline Charts
**Given** Each card has a mini sparkline area
**Then** A small recharts `<LineChart>` renders showing daily values for the last 7 days
**And** Chart dimensions: ~120px wide × 40px tall, no axes labels, no legend, no tooltip, no grid
**And** Line color matches the card's status color (green/yellow/red)
**And** Area fill below line with matching color at 20% opacity
**And** Chart is responsive and resizes with the card

## Tasks / Subtasks

- [x] Task 1: Create MetricsCard reusable component (AC: #1, #5)
  - [x] 1.1 Build `MetricsCard.tsx` with props: title, icon, value, unit, color, trend, context, sparklineData, onClick, benchmarkBadge?, roiLine?, capacityLine?
  - [x] 1.2 Build `MetricsCardSkeleton.tsx` matching card layout
  - [x] 1.3 Implement color-coding helper function with configurable thresholds
  - [x] 1.4 Add hover/click interactions and keyboard accessibility (role="button", tabIndex, onKeyDown)

- [x] Task 2: Create sparkline recharts component (AC: #6)
  - [x] 2.1 Build `Sparkline.tsx` using recharts `<LineChart>` + `<Area>` (recharts already installed v2.15.0, do NOT install chart.js)
  - [x] 2.2 Configure: no `<XAxis>`, no `<YAxis>`, no `<Tooltip>`, no `<Legend>`, no `<CartesianGrid>`
  - [x] 2.3 Use `<Area>` with `fill={color}` at `fillOpacity={0.2}`, `stroke={color}`, `dot={false}`

- [x] Task 3: Add new data hooks for metrics cards (AC: #2, #3, #4)
  - [x] 3.1 Add `useShortageClaimsMetric(operatorId, startDate, endDate)` hook in `useDashboardMetrics.ts`
  - [x] 3.2 Add `useAvgDeliveryTimeMetric(operatorId, startDate, endDate)` hook
  - [x] 3.3 Add `useDailyMetricsSeries(operatorId, startDate, endDate)` hook for sparkline data (7-day array)
  - [x] 3.4 Add `useFadrPreviousPeriod(operatorId, prevStartDate, prevEndDate)` hook for FADR trend
  - [x] 3.5 Add trend hooks for claims and efficiency previous periods

- [x] Task 4: Build FADR metrics card (AC: #2)
  - [x] 4.1 Wire `useFadrMetric` + `useFadrPreviousPeriod` + sparkline data into MetricsCard
  - [x] 4.2 Implement FADR color thresholds: ≥95% green, 90-94.9% yellow, <90% red
  - [x] 4.3 Calculate trend delta vs previous 7-day period
  - [x] 4.4 Build FADR drill-down dialog with 30-day chart and retailer breakdown

- [x] Task 5: Build Shortage Claims card (AC: #3)
  - [x] 5.1 Wire `useShortageClaimsMetric` + sparkline data into MetricsCard
  - [x] 5.2 Format CLP currency with thousands separator (Intl.NumberFormat)
  - [x] 5.3 Implement claims color thresholds: >100K red, 50K-100K yellow, <50K green
  - [x] 5.4 Build claims drill-down dialog

- [x] Task 6: Build Efficiency card (AC: #4)
  - [x] 6.1 Wire `useAvgDeliveryTimeMetric` + sparkline data into MetricsCard
  - [x] 6.2 Format time in minutes with "min" suffix
  - [x] 6.3 Implement efficiency color thresholds: ≤40min green, 40-60min yellow, >60min red
  - [x] 6.4 Build efficiency drill-down dialog

- [x] Task 7: Integrate into Dashboard page (AC: #1)
  - [x] 7.1 Add `<PrimaryMetricsGrid />` component below `<HeroSLA />` in `dashboard/page.tsx`
  - [x] 7.2 Pass operatorId and date range props
  - [x] 7.3 Verify responsive layout: 1 column mobile, 2 columns tablet (md), 3 columns desktop (lg)

- [x] Task 8: Write tests (all ACs)
  - [x] 8.1 Unit tests for MetricsCard component (color thresholds, loading, error, click)
  - [x] 8.2 Unit tests for Sparkline component
  - [x] 8.3 Hook tests for new metric hooks (shortage claims, avg delivery time, daily series)
  - [x] 8.4 Integration test for PrimaryMetricsGrid with mocked data
  - [x] 8.5 Edge case tests: null data, zero claims, RPC errors, cached fallback

## Dev Notes

### Architecture Patterns & Constraints

**Component Architecture — follow HeroSLA pattern exactly:**
- Feature components in `src/components/dashboard/`
- Hooks in `src/hooks/useDashboardMetrics.ts` (extend existing file, do NOT create new hook files)
- Use `createSPAClient()` inside `queryFn`, not at module level
- All queries use `enabled: !!operatorId` guard
- Query keys follow: `['dashboard', operatorId, 'metric-name', startDate, endDate]`
- Use `CallableFunction` cast for `.rpc()` calls (Supabase SSR v0.5.x workaround)
- Shared `DASHBOARD_QUERY_OPTIONS` constant for staleTime/refetchInterval

**Date Range Strategy — reuse existing `getDashboardDates()`:**
- Current period: last 7 days (today - 6 through today, UTC)
- Previous period: previous 7 days (today - 13 through today - 7)
- Always use `useMemo(() => getDashboardDates(), [])` to prevent recalculation

**Data Sources from performance_metrics table:**
- `shortage_claims_count` and `shortage_claims_amount_clp` columns exist (from Story 3.1 migration)
- `avg_delivery_time_minutes` column exists
- `first_attempt_deliveries` used by existing `calculate_fadr` RPC
- For sparkline: query daily rows with `retailer_name IS NULL` (aggregate rows), return array of 7 values

**Recharts Sparkline (already installed v2.15.0 — do NOT install chart.js):**
```tsx
import { LineChart, Line, Area, AreaChart, ResponsiveContainer } from 'recharts';

// Sparkline component pattern:
<ResponsiveContainer width="100%" height={40}>
  <AreaChart data={sparklineData}>
    <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.2} dot={false} />
  </AreaChart>
</ResponsiveContainer>
```
- No `<XAxis>`, `<YAxis>`, `<Tooltip>`, `<Legend>`, `<CartesianGrid>`
- `data` prop: `Array<{ date: string; value: number }>`

**Color Thresholds — helper function pattern (return Tailwind inline hex classes matching HeroSLA):**
```typescript
type ColorThresholds = {
  green: number;    // threshold for green
  yellow: number;   // threshold for yellow (between green and red)
  direction: 'higher-better' | 'lower-better';
};

function getMetricColor(value: number | null, thresholds: ColorThresholds): string {
  if (value === null || isNaN(value)) return 'text-slate-400';
  const { green, yellow, direction } = thresholds;
  if (direction === 'higher-better') {
    if (value >= green) return 'text-[#10b981]';
    if (value >= yellow) return 'text-[#f59e0b]';
    return 'text-[#ef4444]';
  }
  // lower-better (e.g., delivery time)
  if (value <= green) return 'text-[#10b981]';
  if (value <= yellow) return 'text-[#f59e0b]';
  return 'text-[#ef4444]';
}
```

**CLP Currency Formatting:**
```typescript
new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
```

**Spanish UI Text (MUST use exactly):**
- FADR card title: "FADR"
- FADR tooltip: "Primera Entrega: Porcentaje de entregas exitosas en el primer intento. >95% = excelente, >90% = bueno. Reduce costos de re-entregas."
- FADR benchmark: "⭐ Excelente (>95%)" / "✓ Bueno (>90%)" / "⚠️ Bajo estándar (<90%)"
- Claims card title: "Reclamos"
- Claims tooltip: "Reclamos de Indemnización: Multas por diferencias entre manifest y entrega. Sistema previene al detectar discrepancias ANTES de firmar."
- Claims ROI: "💾 Ahorro: X CLP este mes"
- Efficiency card title: "Eficiencia"
- Efficiency tooltip: "Tiempo promedio de carga por camión. Manual: ~2 horas. Con Aureon: 42 minutos. Ahorro: 78 minutos/camión."
- Efficiency capacity: "📊 X% capacidad"
- Trend: "↑ +X.X% vs semana anterior" / "↓ -X.X% vs semana anterior"
- No data: "N/A" or "Sin datos para este periodo"
- Stale data: "Los datos pueden estar desactualizados"

**Accessibility Requirements:**
- Each card: `role="button"`, `tabIndex={0}`, `aria-label` describing the metric
- Keyboard: Enter/Space opens drill-down dialog
- Dialog: Must include `DialogDescription` for screen readers
- Color is never the only indicator — always pair with text/icons

### Existing RPC Functions Available (DO NOT recreate)
- `calculate_fadr(p_operator_id, p_start_date, p_end_date)` → `number | null`
- `calculate_sla(p_operator_id, p_start_date, p_end_date)` → `number | null`
- `get_failure_reasons(p_operator_id, p_start_date, p_end_date)` → `{reason, count, percentage}[]`

### New Hook Return Types (add to useDashboardMetrics.ts)

```typescript
// useShortageClaimsMetric return type
export type ShortageClaimsMetric = {
  count: number;          // SUM(shortage_claims_count)
  amount: number;         // SUM(shortage_claims_amount_clp)
} | null;

// useAvgDeliveryTimeMetric returns: number | null (average minutes)

// useDailyMetricsSeries return type — for sparklines
export type DailyMetricPoint = {
  date: string;           // YYYY-MM-DD
  value: number;          // metric value for that day
};
// Hook returns: DailyMetricPoint[] (sorted ASC by date, 7 entries)
// Missing days: include with value=0 (do NOT skip days — sparkline needs continuous data)

// useFadrPreviousPeriod returns: number | null (same as useSlaPreviousPeriod pattern)
// useClaimsPreviousPeriod returns: ShortageClaimsMetric | null
// useDeliveryTimePreviousPeriod returns: number | null
```

### New Hook Supabase Query Templates

```typescript
// useShortageClaimsMetric — follows usePerformanceMetricsSummary pattern
export function useShortageClaimsMetric(operatorId: string | null, startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'claims', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('shortage_claims_count, shortage_claims_amount_clp')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null);  // aggregate rows only
      if (error) throw error;
      if (!data || data.length === 0) return null;
      return data.reduce((acc, row) => ({
        count: acc.count + (row.shortage_claims_count ?? 0),
        amount: acc.amount + (row.shortage_claims_amount_clp ?? 0),
      }), { count: 0, amount: 0 }) as ShortageClaimsMetric;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}

// useDailyMetricsSeries — returns 7 daily values for sparklines
// metricColumn param: 'first_attempt_deliveries' | 'shortage_claims_amount_clp' | 'avg_delivery_time_minutes' etc.
export function useDailyMetricsSeries(
  operatorId: string | null, startDate: string, endDate: string,
  metricColumn: string  // column name from performance_metrics
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'daily-series', metricColumn, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select(`metric_date, ${metricColumn}`)
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .is('retailer_name', null)
        .order('metric_date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map(row => ({
        date: row.metric_date,
        value: row[metricColumn] ?? 0,
      })) as DailyMetricPoint[];
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
```

### Common Mistakes to AVOID (from Story 3.2 code review)
- ❌ Do NOT create Supabase client at module level — always inside `queryFn`
- ❌ Do NOT invert responsive breakpoints (e.g., `p-12 md:p-6` is WRONG; use `p-6 md:p-12`)
- ❌ Do NOT duplicate `useOperatorId` — import from existing `useDashboardMetrics.ts`
- ❌ Do NOT forget `DialogDescription` in drill-down dialogs
- ❌ Do NOT use white text on light backgrounds — fails WCAG contrast
- ❌ Do NOT forget to memoize expensive calculations with `useMemo`
- ❌ Do NOT use spinners for loading — use skeleton loaders matching layout dimensions
- ❌ Do NOT call `calculate_daily_metrics` from frontend — it's SECURITY DEFINER, cron-only

### Project Structure Notes

**Files to CREATE:**
- `src/components/dashboard/MetricsCard.tsx` — Reusable metric card component
- `src/components/dashboard/MetricsCardSkeleton.tsx` — Skeleton loader
- `src/components/dashboard/Sparkline.tsx` — Recharts sparkline wrapper (AreaChart, no axes)
- `src/components/dashboard/PrimaryMetricsGrid.tsx` — Grid container for 3 cards
- `src/components/dashboard/MetricDrillDownDialog.tsx` — Reusable drill-down dialog
- `src/components/dashboard/PrimaryMetricsGrid.test.tsx` — Tests
- `src/components/dashboard/MetricsCard.test.tsx` — Tests

**Files to MODIFY:**
- `src/hooks/useDashboardMetrics.ts` — Add new hooks (shortage claims, avg delivery time, daily series, previous period hooks)
- `src/app/app/dashboard/page.tsx` — Add `<PrimaryMetricsGrid />` below `<HeroSLA />`
- `package.json` — No changes needed (recharts v2.15.0 already installed)

**Files to NOT touch:**
- `src/components/dashboard/HeroSLA.tsx` — Already complete from 3.2
- Supabase migrations — All needed columns/functions exist from 3.1
- `src/lib/types.ts` — Auto-generated, do not manually edit

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-Story-3.3]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend-Architecture]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Primary-Metrics-Grid]
- [Source: _bmad-output/implementation-artifacts/3-2-build-hero-sla-section-with-real-time-calculation.md#Dev-Notes]
- [Source: apps/frontend/src/hooks/useDashboardMetrics.ts]
- [Source: apps/frontend/src/components/dashboard/HeroSLA.tsx]
- [Source: apps/frontend/supabase/migrations/20260224000002_create_metrics_functions.sql]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation, all tests passed on first run.

### Completion Notes List

- Built reusable `MetricsCard` component with configurable color thresholds (higher-better/lower-better), hover tooltip, keyboard accessibility, sparkline integration, and optional benchmark/ROI/capacity lines.
- Built `Sparkline` component wrapping recharts `AreaChart` with no axes/tooltip/legend per AC6.
- Built `MetricsCardSkeleton` matching card layout dimensions.
- Added 7 new hooks to `useDashboardMetrics.ts`: `useShortageClaimsMetric`, `useAvgDeliveryTimeMetric`, `useDailyMetricsSeries`, `useFadrPreviousPeriod`, `useClaimsPreviousPeriod`, `useDeliveryTimePreviousPeriod`, plus types `ShortageClaimsMetric` and `DailyMetricPoint`.
- Built `PrimaryMetricsGrid` orchestrating all 3 cards (FADR, Reclamos, Eficiencia) with responsive grid layout and drill-down dialogs.
- Built `MetricDrillDownDialog` reusable dialog wrapper with `DialogDescription` for accessibility.
- Integrated `PrimaryMetricsGrid` into dashboard page below `HeroSLA`.
- 55 new tests across 3 test files. Full suite: 445 passed, 0 failures, 0 regressions.

### Change Log

- 2026-03-02: Implemented Story 3.3 — Primary Metrics Cards (FADR, Claims, Efficiency)
- 2026-03-02: Code review — 7 issues fixed (3H, 4M): responsive breakpoint inversion, FADR sparkline raw counts→%, SQL injection whitelist, trend arrow logic, magic number constant, ROI hardcoded→computed, FADR context line data source

## Senior Developer Review (AI)

**Review Date:** 2026-03-02
**Reviewer:** Claude Opus 4.6 (self-review, same LLM)
**Outcome:** Approve (after fixes)

### Action Items

- [x] [HIGH] H1: Responsive breakpoint inversion on metric value font size (MetricsCard.tsx:115)
- [x] [HIGH] H2: FADR sparkline shows raw first_attempt_deliveries count instead of percentage (PrimaryMetricsGrid.tsx:88)
- [x] [HIGH] H3: useDailyMetricsSeries vulnerable to column injection via dynamic string interpolation (useDashboardMetrics.ts:199)
- [x] [MED] M1: Claims trend arrow/sign logic confusing — simplified arrow mapping (PrimaryMetricsGrid.tsx:37-60)
- [x] [MED] M2: Capacity denominator hardcoded as magic number 500 (PrimaryMetricsGrid.tsx:187)
- [x] [MED] M3: ROI savings line hardcoded to $0 — now computes delta vs previous period (PrimaryMetricsGrid.tsx:169)
- [x] [MED] M4: 13 concurrent Supabase queries on mount — acknowledged, acceptable for TanStack Query caching layer
- [x] [LOW] L2: FADR context line used deliveredOrders instead of first_attempt_deliveries — added useFadrSummary hook

### File List

- `src/components/dashboard/MetricsCard.tsx` (NEW)
- `src/components/dashboard/MetricsCardSkeleton.tsx` (NEW)
- `src/components/dashboard/Sparkline.tsx` (NEW)
- `src/components/dashboard/PrimaryMetricsGrid.tsx` (NEW)
- `src/components/dashboard/MetricDrillDownDialog.tsx` (NEW)
- `src/components/dashboard/MetricsCard.test.tsx` (NEW)
- `src/components/dashboard/PrimaryMetricsGrid.test.tsx` (NEW)
- `src/hooks/useDashboardMetrics.ts` (MODIFIED — added 9 hooks + 3 types + column whitelist)
- `src/hooks/useDashboardMetrics.test.ts` (MODIFIED — added 4 new describe blocks)
- `src/app/app/dashboard/page.tsx` (MODIFIED — added PrimaryMetricsGrid import + render)

- `src/components/dashboard/MetricsCard.tsx` (NEW)
- `src/components/dashboard/MetricsCardSkeleton.tsx` (NEW)
- `src/components/dashboard/Sparkline.tsx` (NEW)
- `src/components/dashboard/PrimaryMetricsGrid.tsx` (NEW)
- `src/components/dashboard/MetricDrillDownDialog.tsx` (NEW)
- `src/components/dashboard/MetricsCard.test.tsx` (NEW)
- `src/components/dashboard/PrimaryMetricsGrid.test.tsx` (NEW)
- `src/hooks/useDashboardMetrics.ts` (MODIFIED — added 7 hooks + 2 types)
- `src/hooks/useDashboardMetrics.test.ts` (MODIFIED — added 4 new describe blocks)
- `src/app/app/dashboard/page.tsx` (MODIFIED — added PrimaryMetricsGrid import + render)
