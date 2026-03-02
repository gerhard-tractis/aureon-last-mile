# Story 3.5: Create Failed Deliveries Analysis with Chart.js Visualizations

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **business owner**,
I want to see visual charts analyzing failed delivery reasons and trends,
So that I can identify patterns and address root causes.

## Acceptance Criteria

### AC1: Two Charts Side-by-Side Layout
**Given** I am viewing the dashboard below the customer performance table
**When** The failed deliveries analysis section loads
**Then** Two charts display side-by-side in a responsive grid:
- Left: Horizontal bar chart (failure reasons breakdown)
- Right: Line chart (failed deliveries trend over time)

**And** Section title: "ANÁLISIS DE ENTREGAS FALLIDAS"
**And** Layout: `grid grid-cols-1 lg:grid-cols-2 gap-6`
**And** Each chart in a white card container: rounded-xl, p-6, shadow-sm, border border-slate-200

### AC2: Failure Reasons Bar Chart
**Given** The bar chart is rendered
**Then** It displays:
- Title: "Top 5 Razones de Fallo (Últimos 30 Días)" — or matches current date range
- Horizontal bars showing failure reason categories
- Each bar shows: reason label (left), count (right of bar), percentage label on bar
- Bars colored by severity: Red (#ef4444) if >50 occurrences, Yellow (#f59e0b) if 20-50, Gray (#94a3b8) if <20
- Bars sorted by count descending (largest at top)
- Animated fill on load (0.6s ease-out, staggered 0.1s per row)

**And** If fewer than 5 failure reasons exist, show all available reasons
**And** Bar height: 32px, border-radius: 6px, gap between bars: 12px

### AC3: Failed Deliveries Trend Line Chart
**Given** The line chart is rendered
**Then** It displays:
- Title: "Tendencia de Entregas Fallidas"
- X-axis: Dates (daily granularity)
- Y-axis: Count of failed deliveries
- Single line in red (#ef4444) with area gradient fill below at 20% opacity
- Hover tooltip: date, count, top failure reason for that day
- Peak annotation: "Pico: [date] ([count] fallos)"
- Lowest annotation: "Mínimo: [date] ([count] fallos)"

**And** Chart uses recharts (already installed v2.15.0 — NOT chart.js despite epic title)
**And** Responsive sizing (resizes with window via `<ResponsiveContainer>`)

### AC4: Shared Date Range Filter
**Given** Both charts are displayed
**Then** A single date range filter above both charts applies to both simultaneously
**And** Options: "Últimos 7 días", "Últimos 30 días" (default), "Últimos 90 días"
**And** Changing date range refreshes both charts via TanStack Query

### AC5: Click Drill-Down
**Given** The charts are rendered
**Then** Clicking a bar in the bar chart opens a drill-down dialog showing:
- The selected failure reason highlighted
- Count and percentage of total failures
- Trend context: "X de Y entregas fallidas en este periodo"

**And** Clicking a point on the line chart opens a drill-down dialog showing:
- The selected date's failure count
- Top failure reasons for that day (from `get_failure_reasons` RPC scoped to that single day)

**Note:** Drill-downs show aggregate data only (no individual order rows) — keeps MVP simple, avoids complex delivery_attempts joins.

### AC6: Empty & Error States
**Given** No failed deliveries exist in the selected period
**Then** Show empty state: "Sin entregas fallidas en este periodo" with a green checkmark icon

**Given** Data is loading
**Then** Show skeleton loaders matching chart dimensions (rectangular placeholders)

**Given** API error
**Then** Show error message with retry button, last cached data remains visible

### AC7: Accessibility
**Given** The charts are rendered
**Then** Each chart has an `aria-label` describing its purpose
**And** Tooltips are keyboard accessible
**And** Color is never the only indicator — counts and percentages always shown as text
**And** Chart containers have `role="img"` with descriptive `aria-label`

## Tasks / Subtasks

- [x]Task 1: Create `useFailureReasons` hook (AC: #2, #4)
  - [x]1.1 Add to `useDashboardMetrics.ts` — calls existing `get_failure_reasons` RPC
  - [x]1.2 Return type: `{ reason: string; count: number; percentage: number }[]`
  - [x]1.3 Query key: `['dashboard', operatorId, 'failure-reasons', startDate, endDate]`

- [x]Task 2: Create `useDailyFailedDeliveries` hook (AC: #3, #4)
  - [x]2.1 Add to `useDashboardMetrics.ts` — query `performance_metrics` for daily failed_deliveries
  - [x]2.2 Return type: `DailyMetricPoint[]` (reuse existing type from 3.3)
  - [x]2.3 Filter: `retailer_name IS NULL` (aggregate rows), ordered by metric_date ASC
  - [x]2.4 Query key: `['dashboard', operatorId, 'daily-failed', startDate, endDate]`

- [x]Task 3: Build `FailureReasonsChart` component (AC: #2, #5, #7)
  - [x]3.1 Create `src/components/dashboard/FailureReasonsChart.tsx`
  - [x]3.2 Use recharts `<BarChart>` with `layout="vertical"` for horizontal bars
  - [x]3.3 Custom bar colors based on count thresholds (red/yellow/gray)
  - [x]3.4 Animated bars: `<Bar animationDuration={600}>`
  - [x]3.5 Click handler on bars to open drill-down dialog
  - [x]3.6 `role="img"` with `aria-label` on container

- [x]Task 4: Build `FailedDeliveriesTrendChart` component (AC: #3, #5, #7)
  - [x]4.1 Create `src/components/dashboard/FailedDeliveriesTrendChart.tsx`
  - [x]4.2 Use recharts `<AreaChart>` with red line + area fill at 20% opacity
  - [x]4.3 `<XAxis>` with date labels, `<YAxis>` with count, `<Tooltip>` with custom formatter
  - [x]4.4 Calculate and annotate peak/lowest points using `<ReferenceDot>` or custom labels
  - [x]4.5 Click handler on data points for drill-down
  - [x]4.6 `<ResponsiveContainer width="100%" height={300}>`

- [x]Task 5: Build `FailedDeliveriesAnalysis` container component (AC: #1, #4, #6)
  - [x]5.1 Create `src/components/dashboard/FailedDeliveriesAnalysis.tsx`
  - [x]5.2 Grid layout with date range selector, both charts
  - [x]5.3 Default date range: 30 days (different from table's 7-day default)
  - [x]5.4 Empty state with green checkmark when no failures
  - [x]5.5 Skeleton loaders for loading state

- [x]Task 6: Build drill-down dialogs (AC: #5)
  - [x]6.1 Reuse `MetricDrillDownDialog` wrapper from 3.3
  - [x]6.2 Failure reason drill-down: show reason name, count, percentage, context line
  - [x]6.3 Date drill-down: call `get_failure_reasons` RPC scoped to single day, show date count + top reasons

- [x]Task 7: Integrate into Dashboard page (AC: all)
  - [x]7.1 Add `<FailedDeliveriesAnalysis operatorId={operatorId} />` below `<CustomerPerformanceTable />` in `dashboard/page.tsx`

- [x]Task 8: Write tests (all ACs)
  - [x]8.1 Unit tests for FailureReasonsChart (bar colors, sorting, empty state)
  - [x]8.2 Unit tests for FailedDeliveriesTrendChart (peak/lowest annotations, tooltip)
  - [x]8.3 Unit tests for FailedDeliveriesAnalysis (date range filter, loading, error)
  - [x]8.4 Hook tests for useFailureReasons and useDailyFailedDeliveries
  - [x]8.5 Accessibility tests: aria-labels, role="img", keyboard navigation

## Dev Notes

### Architecture Patterns & Constraints

**Follow established dashboard component patterns exactly:**
- Feature components in `src/components/dashboard/`
- Hooks in `src/hooks/useDashboardMetrics.ts` (extend existing, do NOT create new hook files)
- `createSPAClient()` inside `queryFn`, `enabled: !!operatorId`, `DASHBOARD_QUERY_OPTIONS`

**Charting Library: recharts v2.15.0 (already installed — do NOT install chart.js):**
- Despite the epic title mentioning "Chart.js", the project uses recharts (confirmed in Stories 3.2 and 3.3)
- Import from `recharts`: `BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area, CartesianGrid, ReferenceDot`
- All charts wrapped in `<ResponsiveContainer width="100%" height={N}>`

**Existing RPC: `get_failure_reasons` — USE THIS, do not recreate:**
```typescript
// Already available — returns top failure reasons with counts and percentages
const { data } = await createSPAClient().rpc('get_failure_reasons', {
  p_operator_id: operatorId,
  p_start_date: startDate,
  p_end_date: endDate,
}) as unknown as { data: { reason: string; count: number; percentage: number }[] | null; error: any };
```

**Daily failed deliveries — use existing `useDailyMetricsSeries` pattern:**
```typescript
// Reuse the pattern from Story 3.3 with 'failed_deliveries' column
// Or create a dedicated hook if date range differs (30 days vs 7 days)
useDailyMetricsSeries(operatorId, startDate, endDate, 'failed_deliveries')
```
Note: `useDailyMetricsSeries` has a column allow-list from Story 3.3 code review (H3 fix). Ensure `'failed_deliveries'` is in the allow-list, or add it.

**Date Range — default 30 days (different from other sections):**
- This section defaults to 30 days (matching the epic spec "Last 30 Days")
- Use its own local date range state, independent of the customer table's date range
- Use `subDays` from `date-fns` for calculations

**Horizontal Bar Chart Pattern:**
```tsx
<ResponsiveContainer width="100%" height={250}>
  <BarChart data={reasons} layout="vertical" margin={{ left: 120 }}>
    <XAxis type="number" />
    <YAxis type="category" dataKey="reason" width={110} tick={{ fontSize: 14 }} />
    <Tooltip />
    <Bar dataKey="count" radius={[0, 6, 6, 0]} animationDuration={600}>
      {reasons.map((entry, i) => (
        <Cell key={i} fill={getBarColor(entry.count)} />
      ))}
    </Bar>
  </BarChart>
</ResponsiveContainer>
```

**Bar Color Thresholds:**
```typescript
function getBarColor(count: number): string {
  if (count > 50) return '#ef4444';  // red
  if (count >= 20) return '#f59e0b'; // yellow
  return '#94a3b8';                   // gray
}
```

**Peak/Lowest Annotation Pattern:**
```typescript
const peak = data.reduce((max, d) => d.value > max.value ? d : max, data[0]);
const lowest = data.reduce((min, d) => d.value < min.value ? d : min, data[0]);
// Use <ReferenceDot> or custom <Label> at peak/lowest coordinates
```

**Spanish UI Text (MUST use exactly):**
- Section title: "ANÁLISIS DE ENTREGAS FALLIDAS"
- Bar chart title: "Top 5 Razones de Fallo"
- Line chart title: "Tendencia de Entregas Fallidas"
- Peak label: "Pico: [date] ([count] fallos)"
- Lowest label: "Mínimo: [date] ([count] fallos)"
- Tooltip date format: use `date-fns/format` with `'dd MMM'` locale es
- Empty state: "Sin entregas fallidas en este periodo"
- Error: "Error al cargar datos. Reintentar."
- Date range: "Últimos 7 días", "Últimos 30 días", "Últimos 90 días"

### Common Mistakes to AVOID
- ❌ Do NOT install chart.js — use recharts (already installed v2.15.0)
- ❌ Do NOT create Supabase client at module level — always inside `queryFn`
- ❌ Do NOT create new hook files — extend `useDashboardMetrics.ts`
- ❌ Do NOT use spinners — use skeleton loaders matching chart dimensions
- ❌ Do NOT forget `role="img"` and `aria-label` on chart containers
- ❌ Do NOT hardcode failure reason strings — they come from the database
- ❌ Do NOT use `useDailyMetricsSeries` with a column not in the allow-list — check/add `'failed_deliveries'`

### Project Structure Notes

**Files to CREATE:**
- `src/components/dashboard/FailureReasonsChart.tsx` — Horizontal bar chart
- `src/components/dashboard/FailedDeliveriesTrendChart.tsx` — Line/area trend chart
- `src/components/dashboard/FailedDeliveriesAnalysis.tsx` — Container with date range + both charts
- `src/components/dashboard/FailedDeliveriesAnalysis.test.tsx` — Tests

**Files to MODIFY:**
- `src/hooks/useDashboardMetrics.ts` — Add `useFailureReasons`, `useDailyFailedDeliveries` hooks (or reuse `useDailyMetricsSeries` with 'failed_deliveries')
- `src/app/app/dashboard/page.tsx` — Add `<FailedDeliveriesAnalysis operatorId={operatorId} />` below `<CustomerPerformanceTable />`

**Files to NOT touch:**
- `src/components/dashboard/HeroSLA.tsx`, `PrimaryMetricsGrid.tsx`, `MetricsCard.tsx`, `CustomerPerformanceTable.tsx`
- Supabase migrations — `get_failure_reasons` RPC already exists from 3.1
- `src/lib/types.ts` — Auto-generated

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-Story-3.5]
- [Source: _bmad-output/planning-artifacts/architecture.md#Chart-Library-Recharts]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Failed-Deliveries-Analysis]
- [Source: _bmad-output/implementation-artifacts/3-3-implement-primary-metrics-cards-fadr-claims-efficiency.md]
- [Source: _bmad-output/implementation-artifacts/3-4-build-customer-performance-table-sortable-color-coded.md]
- [Source: apps/frontend/src/hooks/useDashboardMetrics.ts]
- [Source: apps/frontend/src/components/dashboard/Sparkline.tsx — recharts pattern reference]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation.

### Completion Notes List

- Task 1: Added `useFailureReasons` hook to `useDashboardMetrics.ts` — calls `get_failure_reasons` RPC, returns `FailureReasonRow[]`.
- Task 2: Reused existing `useDailyMetricsSeries` with `'failed_deliveries'` column (already in allow-list). No new hook needed.
- Task 3: Built `FailureReasonsChart.tsx` — recharts horizontal `BarChart` with `layout="vertical"`, color-coded bars (red/yellow/gray by count threshold), click drill-down dialog, `role="img"` + `aria-label`.
- Task 4: Built `FailedDeliveriesTrendChart.tsx` — recharts `AreaChart` with red line + gradient fill, peak/lowest `ReferenceDot` annotations, click-to-drilldown on active dots, date drill-down fetches per-day failure reasons via `useFailureReasons`.
- Task 5: Built `FailedDeliveriesAnalysis.tsx` — container with date range selector (default 30 days), grid layout for both charts, skeleton loaders, error banner with retry.
- Task 6: Drill-down dialogs reuse `MetricDrillDownDialog`. Bar click shows reason detail + context. Dot click shows date count + top reasons.
- Task 7: Integrated below `<CustomerPerformanceTable />` in `dashboard/page.tsx`.
- Task 8: 17 tests covering container (6), bar chart (4), trend chart (5), accessibility (2).
- Full suite: 497 tests passing, 0 failures, 0 TS/lint errors.

### Change Log

- 2026-03-02: Story 3.5 implementation complete — failed deliveries analysis with recharts visualizations.

### File List

- `apps/frontend/src/hooks/useDashboardMetrics.ts` (MODIFIED) — added `useFailureReasons` hook + `FailureReasonRow` type
- `apps/frontend/src/components/dashboard/FailureReasonsChart.tsx` (NEW) — horizontal bar chart
- `apps/frontend/src/components/dashboard/FailedDeliveriesTrendChart.tsx` (NEW) — area trend chart
- `apps/frontend/src/components/dashboard/FailedDeliveriesAnalysis.tsx` (NEW) — container component
- `apps/frontend/src/components/dashboard/FailedDeliveriesAnalysis.test.tsx` (NEW) — 17 tests
- `apps/frontend/src/app/app/dashboard/page.tsx` (MODIFIED) — integrated FailedDeliveriesAnalysis
