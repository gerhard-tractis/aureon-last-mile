# Story 3A.8: Dashboard Pipeline Navigation & Loading Metrics Tab

Status: done

## Dependencies

Depends on: Story 3A.2 (data pipeline validation — ensures orders/packages data is trustworthy). No dependency on 3A.6 (alerting) or 3A.7 (Easy WMS webhook).

## Story

As an operations manager at Transportes Musan,
I want the dashboard restructured as a pipeline view with tabs for each operational stage, starting with a Loading Data tab showing order/package ingestion metrics,
So that I can understand what data came into the system, track ingestion volume by client and region, and see what deliveries are committed per day.

## Acceptance Criteria

1. **AC1: Pipeline Navigation** — The dashboard has a horizontal tab bar representing the full last-mile operational pipeline:
   - Tabs: Vista General | ① Carga | ② Retiro | ③ Recepción | ④ Distribución | ⑤ Despacho | ⑥ Última Milla
   - Desktop (≥768px): horizontal tab bar with gold accent border-bottom on active tab, thin connector lines between stages
   - Mobile (<768px): dropdown `<select>` element (no horizontal scroll)
   - Only "Vista General" and "① Carga" are enabled; rest show "Próximamente" tooltip and are disabled
   - Active tab state persists via `?tab=` URL query param (shareable, survives refresh)

2. **AC2: Date Filter Bar** — Shared across all Loading tab sections, sticky on scroll:
   - Quick preset buttons: Hoy | Ayer | Esta Semana | Este Mes | Este Año | Personalizado
   - Pill-shaped buttons with gold fill (#e6c15c) on active, slate outline on inactive
   - Custom date range inputs shown only when "Personalizado" is selected
   - Previous period auto-calculated for trend comparisons

3. **AC3: KPI Strip** — 5 headline metric cards:
   - Órdenes Cargadas (orders by `created_at` in period)
   - Bultos Cargados (packages count, subtitle: "Promedio: X.X por orden")
   - Órdenes Comprometidas (orders by `delivery_date` in period)
   - Clientes Activos (distinct `retailer_name`)
   - Comunas Cubiertas (distinct `comuna`)
   - Grid: 5 columns on desktop, wraps on mobile
   - Loading skeleton states while fetching

4. **AC4: Charts Row** — 2 charts side by side on desktop, stacked on mobile:
   - Left: "Evolución Diaria de Órdenes Cargadas" — stacked bar chart by retailer (Paris: #0ea5e9, Easy: #10b981)
   - Right: "Órdenes Comprometidas por Día" — line chart with gold line (#e6c15c)
   - Both use Recharts, responsive containers

5. **AC5: Breakdown Tables** — 2 tables side by side on desktop, stacked on mobile:
   - Left: "Órdenes por Cliente" — Cliente | Órdenes | Bultos | % del Total
   - Right: "Órdenes por Región / Comuna" — region dropdown filter + comuna table (Comuna | Órdenes | %)

6. **AC6: Supabase RPC Functions** — 5 SQL functions for aggregated metrics:
   - `get_packages_loaded_stats` — package count + avg per order
   - `get_daily_orders_by_client` — daily order counts grouped by retailer
   - `get_committed_orders_daily` — committed orders per delivery date
   - `get_orders_by_client` — orders and packages grouped by retailer with percentages
   - `get_orders_by_comuna` — orders grouped by comuna with optional region filter
   - All use SECURITY INVOKER for RLS compliance

7. **AC7: TanStack Query Integration** — 9 query hooks with 30s staleTime, 60s refetchInterval, keepPreviousData pattern

## Technical Notes

- Design doc: `docs/plans/2026-03-04-dashboard-pipeline-tabs-loading-metrics.md`
- Implementation plan: `docs/plans/2026-03-04-dashboard-pipeline-tabs-loading-metrics-plan.md`
- Dashboard page wrapped in `<Suspense>` boundary for `useSearchParams()` static prerender compatibility
- Migration: `20260305000001_create_loading_metrics_functions.sql`

## Files Changed

### Created
- `apps/frontend/src/components/dashboard/PipelineNav.tsx` + test
- `apps/frontend/src/components/dashboard/DateFilterBar.tsx` + test
- `apps/frontend/src/components/dashboard/LoadingTab.tsx` + test
- `apps/frontend/src/components/dashboard/LoadingKPIStrip.tsx` + test
- `apps/frontend/src/components/dashboard/DailyOrdersChart.tsx` + test
- `apps/frontend/src/components/dashboard/CommittedOrdersChart.tsx` + test
- `apps/frontend/src/components/dashboard/OrdersByClientTable.tsx` + test
- `apps/frontend/src/components/dashboard/OrdersByComunaTable.tsx` + test
- `apps/frontend/src/hooks/useDatePreset.ts` + test
- `apps/frontend/src/hooks/useLoadingMetrics.ts` + test
- `apps/frontend/supabase/migrations/20260305000001_create_loading_metrics_functions.sql`

### Modified
- `apps/frontend/src/app/app/dashboard/page.tsx` — added PipelineNav, Suspense boundary, tab routing

## Delivery

- PR #61 — merged 2026-03-04
- 228 tests across 24 test files, all passing
- CI: Build ✅ Lint ✅ TypeScript ✅ Tests ✅

## Known Issues

- **Paris orders missing packages:** ~34% of Paris orders ingested today have no package records in the `packages` table. This is a data pipeline issue (Paris XLSX ingestion), not a dashboard bug. Dashboard accurately reflects DB state. Tracked under Story 3A.1 E2E verification.
