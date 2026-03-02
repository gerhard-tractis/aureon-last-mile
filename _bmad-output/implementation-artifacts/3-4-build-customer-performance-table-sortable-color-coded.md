# Story 3.4: Build Customer Performance Table (Sortable, Color-Coded)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **business owner**,
I want to see a table of all retailers with their performance metrics in sortable columns,
So that I can identify which customers are performing well and which need attention.

## Acceptance Criteria

### AC1: Table Structure & Columns
**Given** I am viewing the dashboard below the primary metrics cards
**When** The customer performance table loads
**Then** A table displays with columns:
- **Cliente** (retailer name) — 25% width, sortable, semibold (600), clickable
- **Pedidos** (order count) — 15% width, sortable, right-aligned, default sort descending
- **SLA %** (on-time delivery) — 15% width, sortable, color-coded background
- **FADR %** (first attempt rate) — 15% width, sortable, color-coded background
- **Fallos** (failed delivery count) — 15% width, sortable, warning color if >8% of total orders
- **Acciones** — 15% width, `[Ver detalles]` blue link opens drill-down dialog

### AC2: Default Sort & Sort Interaction
**Given** The table is loaded
**Then** Default sort is by **Pedidos** (order count) descending (largest customers first)
**And** Clicking any column header toggles sort ascending/descending with visual indicator (↑/↓ icon)
**And** Only one column can be sorted at a time
**And** Sort state is maintained when date range changes

### AC3: Color-Coded Performance Indicators
**Given** The table displays SLA % and FADR % columns
**Then** SLA % column has color-coded background:
- Green (#10b981 at 10% opacity) if ≥95%
- Yellow (#f59e0b at 10% opacity) if 90-94.9%
- Red (#ef4444 at 10% opacity) if <90%

**And** FADR % column has color-coded background:
- Green (#10b981 at 10% opacity) if ≥90%
- Yellow (#f59e0b at 10% opacity) if 80-89.9%
- Red (#ef4444 at 10% opacity) if <80%

**And** Fallos column shows warning styling (text-amber-600) if failures > 8% of total orders

### AC4: Date Range Filter
**Given** The table is displayed
**Then** A date range dropdown appears above the table with options:
- Últimos 7 días (default)
- Últimos 30 días
- Últimos 90 días
- Rango personalizado (date picker)

**And** Changing the date range refreshes the table data via TanStack Query
**And** Each row shows data aggregated for the selected period

### AC5: Search & Filter
**Given** The table is displayed
**Then** A search box above the table filters by retailer name (client-side, instant)
**And** Search is case-insensitive and matches partial strings
**And** Filtered results maintain current sort order
**And** Empty search shows all retailers

### AC6: Pagination
**Given** The table has data
**Then** Table shows 10 rows per page
**And** A "Cargar más" (Load More) button appears at the bottom when more rows exist
**And** Clicking it appends the next 10 rows (infinite scroll pattern)
**And** Shows "Mostrando X de Y clientes" count

### AC7: Export CSV
**Given** The table is displayed with data
**Then** An "Exportar CSV" button appears top-right above the table
**And** Clicking downloads a CSV file with current filters/sort applied
**And** CSV includes all columns: Cliente, Pedidos, SLA %, FADR %, Fallos
**And** Filename: `aureon-clientes-YYYY-MM-DD.csv`
**And** Export is logged in audit_logs: action='EXPORT_DASHBOARD', resource_type='report'

### AC8: Loading & Error States
**Given** Data is loading
**Then** Table shows skeleton loader rows (5 rows of pulsing rectangles matching column widths)

**Given** No data for a retailer in the period
**Then** Show "0" for metrics with gray background

**Given** Retailer name is too long
**Then** Truncate with ellipsis, full name on hover (title attribute)

**Given** API error
**Then** Show error banner with retry button, last cached data remains visible with staleness indicator

### AC9: Accessibility
**Given** The table is rendered
**Then** Uses semantic HTML: `<table>`, `<thead>`, `<tbody>`, `<th scope="col">`
**And** Column headers have `aria-sort="ascending"` or `aria-sort="descending"` when active
**And** Sort buttons are keyboard accessible (Tab + Enter/Space)
**And** "Ver detalles" buttons have descriptive `aria-label` including retailer name
**And** Drill-down dialog includes `DialogDescription` for screen readers
**And** Color is never the only indicator — always paired with text/percentage values

## Tasks / Subtasks

- [x] Task 1: Create `useCustomerPerformance` hook (AC: #1, #4, #8)
  - [x] 1.1 Add `useCustomerPerformance(operatorId, startDate, endDate)` to `useDashboardMetrics.ts`
  - [x] 1.2 Add `CustomerPerformanceRow` type
  - [x] 1.3 Direct query on `performance_metrics` WHERE `retailer_name IS NOT NULL`, aggregate in JS (no RPC migration needed)
  - [x] 1.4 Follow existing pattern: `createSPAClient()` inside queryFn, `enabled: !!operatorId`, `DASHBOARD_QUERY_OPTIONS`
  - [x] 1.5 Query key: `['dashboard', operatorId, 'customer-performance', startDate, endDate]`

- [x] Task 2: Build `CustomerPerformanceTable` component (AC: #1, #2, #3, #5, #6, #9)
  - [x] 2.1 Create `src/components/dashboard/CustomerPerformanceTable.tsx`
  - [x] 2.2 Implement semantic HTML table with `<thead>`, `<tbody>`, `<th scope="col">`
  - [x] 2.3 Column headers: clickable for sort with ↑/↓ indicators, `aria-sort` attributes
  - [x] 2.4 SLA % and FADR % cells: color-coded backgrounds using opacity variants of green/yellow/red
  - [x] 2.5 Fallos column: warning styling when >8% of total orders
  - [x] 2.6 Cliente column: truncation with ellipsis, `title` for full name on hover
  - [x] 2.7 "Ver detalles" button per row opening drill-down dialog with accessible `aria-label`

- [x] Task 3: Build retailer drill-down dialog (AC: #1, #9)
  - [x] 3.1 Reuse `MetricDrillDownDialog` wrapper from Story 3.3
  - [x] 3.2 Show per-retailer detail: SLA %, FADR %, order count, failed deliveries breakdown
  - [x] 3.3 Include `DialogDescription` for accessibility
  - [x] 3.4 Close on Escape / click outside

- [x] Task 4: Implement sort logic (AC: #2)
  - [x] 4.1 Local state for sort column and direction (useState)
  - [x] 4.2 Default: `{ column: 'total_orders', direction: 'desc' }`
  - [x] 4.3 Toggle logic: same column click = flip direction, different column = set desc
  - [x] 4.4 Client-side sort using `Array.sort()` with typed comparator
  - [x] 4.5 Maintain sort when data refreshes

- [x] Task 5: Implement search filter (AC: #5)
  - [x] 5.1 Controlled input above table with search icon
  - [x] 5.2 `useMemo` filtered list: case-insensitive `includes` on `retailer_name`
  - [x] 5.3 Debounce NOT needed (client-side filter is instant)

- [x] Task 6: Implement pagination / Load More (AC: #6)
  - [x] 6.1 State: `visibleCount` starting at 10
  - [x] 6.2 Slice sorted+filtered array to `visibleCount`
  - [x] 6.3 "Cargar más" button increments by 10
  - [x] 6.4 Show "Mostrando X de Y clientes" below table

- [x] Task 7: Implement date range selector (AC: #4)
  - [x] 7.1 Dropdown above table: "Últimos 7 días" (default), "Últimos 30 días", "Últimos 90 días"
  - [x] 7.2 State drives `startDate`/`endDate` passed to hook
  - [x] 7.3 Custom range: use HTML date inputs (simple — no library dependency)
  - [x] 7.4 Reset pagination to 10 on date range change

- [x] Task 8: Implement CSV export (AC: #7)
  - [x] 8.1 "Exportar CSV" button top-right
  - [x] 8.2 Generate CSV from currently filtered+sorted data
  - [x] 8.3 Use Blob + URL.createObjectURL for download
  - [x] 8.4 Filename: `aureon-clientes-YYYY-MM-DD.csv`
  - [x] 8.5 Audit log: POST to Supabase `audit_logs` table

- [x] Task 9: Build skeleton loader (AC: #8)
  - [x] 9.1 Create `CustomerPerformanceTableSkeleton.tsx` with 5 skeleton rows
  - [x] 9.2 Match column widths and heights

- [x] Task 10: Integrate into Dashboard page (AC: all)
  - [x] 10.1 Add `<CustomerPerformanceTable operatorId={operatorId} />` below `<PrimaryMetricsGrid />` in `dashboard/page.tsx`

- [x] Task 11: Write tests (all ACs)
  - [x] 11.1 Unit tests for sort logic (all columns, toggle direction)
  - [x] 11.2 Unit tests for color-coding (SLA thresholds, FADR thresholds, Fallos warning)
  - [x] 11.3 Unit tests for search filter (case-insensitive, partial match, empty)
  - [x] 11.4 Unit tests for pagination (load more, count display)
  - [x] 11.5 Unit tests for CSV export (content, filename)
  - [x] 11.6 Hook tests for useCustomerPerformance
  - [x] 11.7 Accessibility tests: aria-sort, keyboard navigation, semantic HTML
  - [x] 11.8 Edge case tests: no data, single retailer, long name truncation

## Dev Notes

### Architecture Patterns & Constraints

**Component Architecture — follow PrimaryMetricsGrid/HeroSLA pattern exactly:**
- Feature components in `src/components/dashboard/`
- Hooks in `src/hooks/useDashboardMetrics.ts` (extend existing file, do NOT create new hook files)
- Use `createSPAClient()` inside `queryFn`, not at module level
- All queries use `enabled: !!operatorId` guard
- Query keys follow: `['dashboard', operatorId, 'customer-performance', startDate, endDate]`
- Shared `DASHBOARD_QUERY_OPTIONS` constant for staleTime/refetchInterval (30s/30s)

**Date Range Strategy — this story adds its OWN date range selector:**
- Default period: last 7 days (matching dashboard default)
- Extended options: 30 days, 90 days, custom range
- Use `subDays` from `date-fns` (already installed) for date calculations
- Date format: `YYYY-MM-DD` strings for Supabase queries

**Data Source — performance_metrics table per-retailer rows:**
- The `performance_metrics` table stores rows WHERE `retailer_name IS NOT NULL` for per-retailer breakdowns
- These are populated by the nightly `calculate_daily_metrics` cron job (Story 3.1)
- Aggregate across the date range: SUM(total_orders), SUM(delivered_orders), SUM(first_attempt_deliveries), SUM(failed_deliveries), SUM(shortage_claims_amount_clp)
- SLA % = SUM(delivered_orders) / SUM(total_orders) * 100
- FADR % = SUM(first_attempt_deliveries) / SUM(total_orders) * 100
- Note: Valor (CLP) column deferred — no revenue/order value column exists in the data model yet. Will be added in a future story when revenue tracking is implemented.

**Table Implementation — use HTML table with Tailwind (no shadcn Table component):**
- Both existing tables (UserTable, AuditLogTable) use raw HTML `<table>` with Tailwind
- Follow the same pattern for consistency
- Container: white bg, rounded-xl, border, shadow-sm (matching card style)
- Header: bg-slate-50, text-slate-700, font-medium
- Row height: 56px with hover:bg-slate-50
- Zebra striping: even:bg-slate-25 (subtle)

**Color-Coding Implementation:**
```typescript
// SLA thresholds (same as HeroSLA)
function getSlaColor(value: number | null): { bg: string; text: string } {
  if (value === null) return { bg: 'bg-slate-50', text: 'text-slate-400' };
  if (value >= 95) return { bg: 'bg-[#10b981]/10', text: 'text-[#10b981]' };
  if (value >= 90) return { bg: 'bg-[#f59e0b]/10', text: 'text-[#f59e0b]' };
  return { bg: 'bg-[#ef4444]/10', text: 'text-[#ef4444]' };
}

// FADR thresholds (same as MetricsCard)
function getFadrColor(value: number | null): { bg: string; text: string } {
  if (value === null) return { bg: 'bg-slate-50', text: 'text-slate-400' };
  if (value >= 90) return { bg: 'bg-[#10b981]/10', text: 'text-[#10b981]' };
  if (value >= 80) return { bg: 'bg-[#f59e0b]/10', text: 'text-[#f59e0b]' };
  return { bg: 'bg-[#ef4444]/10', text: 'text-[#ef4444]' };
}
```

**Retailer Drill-Down Dialog (reuse MetricDrillDownDialog from Story 3.3):**
- Import and wrap with `MetricDrillDownDialog` component
- Show selected retailer's detail: SLA %, FADR %, total orders, delivered, failed, failure rate
- Title: retailer name
- Include `DialogDescription`: "Detalle de rendimiento para {retailer_name}"
- No charts needed — simple data summary for now (charts can be added later)

**CSV Export Implementation:**
```typescript
function exportCSV(data: CustomerPerformanceRow[], filename: string) {
  const headers = ['Cliente', 'Pedidos', 'SLA %', 'FADR %', 'Fallos'];
  const rows = data.map(r => [
    r.retailer_name,
    r.total_orders,
    r.sla_pct?.toFixed(1) ?? 'N/A',
    r.fadr_pct?.toFixed(1) ?? 'N/A',
    r.failed_deliveries,
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

**Spanish UI Text (MUST use exactly):**
- Section title: "DESEMPEÑO POR CLIENTE"
- Column headers: "Cliente", "Pedidos", "SLA %", "FADR %", "Fallos", "Acciones"
- Export button: "Exportar CSV ↓"
- Load more: "Cargar más"
- Count: "Mostrando X de Y clientes"
- Search placeholder: "Buscar cliente..."
- Date range options: "Últimos 7 días", "Últimos 30 días", "Últimos 90 días", "Rango personalizado"
- Action link: "Ver detalles"
- Empty state: "No hay datos de clientes para este periodo"
- Error: "Error al cargar datos. Reintentar."

### Existing RPC Functions Available (DO NOT recreate — not needed for this story)
- `calculate_sla(p_operator_id, p_start_date, p_end_date)` → number | null
- `calculate_fadr(p_operator_id, p_start_date, p_end_date)` → number | null
- `get_failure_reasons(p_operator_id, p_start_date, p_end_date)` → {reason, count, percentage}[]

### Data Approach: Direct Query (NO new RPC or migration)
- Query `performance_metrics` directly using `.from('performance_metrics').select(...)` with filters
- Aggregate by retailer_name in JavaScript — no migration needed, RLS filters automatically
- Retailer count is typically <20, so data volume is negligible

### Hook Implementation Template (direct query, no RPC needed)
```typescript
export type CustomerPerformanceRow = {
  retailer_name: string;
  total_orders: number;
  delivered_orders: number;
  first_attempt_deliveries: number;
  failed_deliveries: number;
  sla_pct: number | null;
  fadr_pct: number | null;
};

export function useCustomerPerformance(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['dashboard', operatorId, 'customer-performance', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await createSPAClient()
        .from('performance_metrics')
        .select('retailer_name, total_orders, delivered_orders, first_attempt_deliveries, failed_deliveries')
        .eq('operator_id', operatorId!)
        .gte('metric_date', startDate)
        .lte('metric_date', endDate)
        .not('retailer_name', 'is', null);
      if (error) throw error;

      // Aggregate by retailer_name in JS
      const byRetailer = new Map<string, CustomerPerformanceRow>();
      for (const row of data ?? []) {
        const key = row.retailer_name!;
        const existing = byRetailer.get(key) ?? {
          retailer_name: key,
          total_orders: 0,
          delivered_orders: 0,
          first_attempt_deliveries: 0,
          failed_deliveries: 0,
          sla_pct: null,
          fadr_pct: null,
        };
        existing.total_orders += row.total_orders ?? 0;
        existing.delivered_orders += row.delivered_orders ?? 0;
        existing.first_attempt_deliveries += row.first_attempt_deliveries ?? 0;
        existing.failed_deliveries += row.failed_deliveries ?? 0;
        byRetailer.set(key, existing);
      }

      // Calculate percentages
      const results = Array.from(byRetailer.values()).map(r => ({
        ...r,
        sla_pct: r.total_orders > 0
          ? Math.round((r.delivered_orders / r.total_orders) * 1000) / 10
          : null,
        fadr_pct: r.total_orders > 0
          ? Math.round((r.first_attempt_deliveries / r.total_orders) * 1000) / 10
          : null,
      }));

      return results;
    },
    enabled: !!operatorId,
    ...DASHBOARD_QUERY_OPTIONS,
  });
}
```

### Common Mistakes to AVOID (from Story 3.2 & 3.3 code reviews)
- ❌ Do NOT create Supabase client at module level — always inside `queryFn`
- ❌ Do NOT invert responsive breakpoints (e.g., `p-12 md:p-6` is WRONG; use mobile-first `p-6 md:p-12`)
- ❌ Do NOT duplicate `useOperatorId` — import from existing `useDashboardMetrics.ts`
- ❌ Do NOT forget `aria-sort` on sortable column headers
- ❌ Do NOT use white text on light backgrounds — fails WCAG contrast
- ❌ Do NOT use spinners for loading — use skeleton loaders matching layout dimensions
- ❌ Do NOT call `calculate_daily_metrics` from frontend — it's SECURITY DEFINER, cron-only
- ❌ Do NOT install new charting libraries — recharts v2.15.0 already installed, no charts needed for this story (table only)
- ❌ Do NOT create new hook files — extend `useDashboardMetrics.ts`
- ❌ Do NOT add shadcn Table component — use HTML table with Tailwind for consistency with UserTable and AuditLogTable patterns

### UX Design Reference

```
DESEMPEÑO POR CLIENTE                                       [Exportar CSV ↓]
┌──────────────┬──────────┬─────────┬────────┬─────────┬─────────────────┐
│ Cliente      │ Pedidos  │ SLA %   │ FADR % │ Fallos  │ Acciones        │
├──────────────┼──────────┼─────────┼────────┼─────────┼─────────────────┤
│ Falabella    │   847    │  96.2%🟢│ 94.1%🟢│   32    │ [Ver detalles]  │
│ Paris        │   623    │  93.8%🟡│ 91.2%🟢│   54    │ [Ver detalles]  │
│ Ripley       │   512    │  89.1%🔴│ 87.3%🟡│   65    │ [Ver detalles]  │
│ Lider        │   294    │  97.1%🟢│ 96.8%🟢│    9    │ [Ver detalles]  │
└──────────────┴──────────┴─────────┴────────┴─────────┴─────────────────┘
```

**Table Design:**
- Container: White background, 24px padding, 12px border radius
- Header: Font size 1rem (16px), medium weight (500), Slate-700 color, Slate-50 background, 2px border-bottom
- Row Height: 56px with 12px 16px padding
- Hover: Background changes to Slate-50, cursor pointer on entire row
- Alternating background: Subtle zebra striping (every other row)

### Project Structure Notes

**Files to CREATE:**
- `src/components/dashboard/CustomerPerformanceTable.tsx` — Main table component with sort, search, filter, pagination, export
- `src/components/dashboard/CustomerPerformanceTableSkeleton.tsx` — Skeleton loader (5 rows)
- `src/components/dashboard/CustomerPerformanceTable.test.tsx` — Tests

**Files to MODIFY:**
- `src/hooks/useDashboardMetrics.ts` — Add `useCustomerPerformance` hook + `CustomerPerformanceRow` type
- `src/app/app/dashboard/page.tsx` — Add `<CustomerPerformanceTable operatorId={operatorId} />` below `<PrimaryMetricsGrid />`

**Files to NOT touch:**
- `src/components/dashboard/HeroSLA.tsx` — Complete from 3.2
- `src/components/dashboard/PrimaryMetricsGrid.tsx` — Complete from 3.3
- `src/components/dashboard/MetricsCard.tsx` — Complete from 3.3
- Supabase migrations — All needed columns exist from 3.1 (no new migration needed if using direct query approach)
- `src/lib/types.ts` — Auto-generated, do not manually edit

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-3-Story-3.4]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend-Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Components-Dashboard-CustomerPerformanceTable]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Performance-by-Customer-Table]
- [Source: _bmad-output/implementation-artifacts/3-3-implement-primary-metrics-cards-fadr-claims-efficiency.md]
- [Source: apps/frontend/src/hooks/useDashboardMetrics.ts]
- [Source: apps/frontend/src/components/dashboard/PrimaryMetricsGrid.tsx]
- [Source: apps/frontend/src/components/admin/UserTable.tsx — sort pattern reference]
- [Source: apps/frontend/src/components/admin/AuditLogTable.tsx — pagination pattern reference]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

None — clean implementation.

### Completion Notes List

- Task 1: Added `useCustomerPerformance` hook + `CustomerPerformanceRow` type to `useDashboardMetrics.ts`. Direct query on `performance_metrics` WHERE `retailer_name IS NOT NULL`, JS aggregation by retailer, SLA/FADR % calculation.
- Tasks 2-8: Built `CustomerPerformanceTable.tsx` — single component containing: semantic HTML table with sort/search/pagination/date-range/CSV-export/drill-down dialog. All Spanish UI text per spec. Color-coded SLA/FADR cells, Fallos warning at >8%.
- Task 9: `CustomerPerformanceTableSkeleton.tsx` — 5 skeleton rows with matching column widths.
- Task 10: Integrated below `<PrimaryMetricsGrid />` in `dashboard/page.tsx`.
- Task 11: 29 tests covering sort logic (5), color-coding (6), search (3), pagination (3), CSV export (1), accessibility (4), edge cases (5), drill-down (1), hook integration (1).
- Full suite: 474 tests passing, 0 failures, 0 lint errors.

### Change Log

- 2026-03-02: Story 3.4 implementation complete — customer performance table with all ACs satisfied.

### File List

- `apps/frontend/src/hooks/useDashboardMetrics.ts` (MODIFIED) — added `useCustomerPerformance` hook + `CustomerPerformanceRow` type
- `apps/frontend/src/components/dashboard/CustomerPerformanceTable.tsx` (NEW) — main table component
- `apps/frontend/src/components/dashboard/CustomerPerformanceTableSkeleton.tsx` (NEW) — skeleton loader
- `apps/frontend/src/components/dashboard/CustomerPerformanceTable.test.tsx` (NEW) — 29 tests
- `apps/frontend/src/app/app/dashboard/page.tsx` (MODIFIED) — integrated CustomerPerformanceTable
