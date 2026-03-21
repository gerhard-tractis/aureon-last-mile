# Spec-13b: Dashboard Redesign

> **Status:** brainstorming
> **Parent:** spec-13 (design language)
> **Depends on:** spec-13a (foundation components)
> **Phase:** 2 of 5

## Goal

Redesign the dashboard pages as a dense command center using the compound components from spec-13a. Everything critical should be above the fold.

## Pages

- `/app/dashboard` (root redirect)
- `/app/dashboard/operaciones`
- `/app/dashboard/analitica`

## Layout — Dense Command Center

```
┌─────────────────────────────────────────────────────────────┐
│ PageShell: [Dashboard > Operaciones]    [Date filter pills] │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ Hero SLA │ Pedidos  │Entregados│ Fallidos │   En Ruta       │
│  94.2%   │  1,247   │  1,089   │    23    │    135          │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│ [Orders by Hour bar chart]     │ [SLA 7d trend line chart]  │
├────────────────────────────────┴────────────────────────────┤
│ [Tabs: Operaciones | Analitica]                             │
├─────────────────────────────────────────────────────────────┤
│ [DataTable: client performance, compact rows]               │
└─────────────────────────────────────────────────────────────┘
```

## Deliverables

### 1. Hero SLA Card

**Existing:** `HeroSLA.tsx`, `HeroSLASkeleton.tsx`
**Action:** Restyle

- Full-width card: `bg-accent text-white rounded-md p-4` (always white text — gold background is consistent across modes)
- SLA value: `font-mono text-[28px] font-bold` (white on gold)
- Subtitle: target + trend inline
- Inline sparkline: white stroke on gold background
- Skeleton: `HeroSLASkeleton` updated with matching dimensions

### 2. KPI Strip (4 MetricCards inline)

**Existing:** `PrimaryMetricsGrid.tsx`, `SecondaryMetricsGrid.tsx`
**Action:** Consolidate into one row of 4 `MetricCard` components

Cards: Pedidos Hoy, Entregados, Fallidos, En Ruta
- Layout: `grid grid-cols-4 gap-3` (stacks to `grid-cols-2` on mobile)
- Each uses `MetricCard` from spec-13a

### 3. Charts Row

**Existing:** `DailyOrdersChart.tsx`, `CommittedOrdersChart.tsx`
**Action:** Restyle

- Side-by-side: `grid grid-cols-2 gap-3`
- Card wrapper: `bg-surface border border-border rounded-md p-3`
- Chart title: `text-xs font-semibold text-text-muted uppercase`
- Gold bars: `fill: var(--color-accent)` for primary data
- Axis labels: `text-text-muted`
- Gridlines: `stroke: var(--color-border-subtle)`

### 4. Tab Bar

**Existing:** `SubTabNav.tsx`
**Action:** Replace with shadcn `Tabs`

- Gold underline on active tab: `border-b-2 border-accent text-accent`
- Inactive: `text-text-secondary`

### 5. Client Performance Table

**Existing:** `CustomerPerformanceTable.tsx`, `CustomerPerformanceTableSkeleton.tsx`
**Action:** Replace with `DataTable`

- Columns: Cliente, Pedidos (mono), SLA % (mono + color), Fallidos (mono + color), OTIF (mono)
- SLA/Fallido color thresholds: green ≥ 93%, amber ≥ 88%, red < 88%
- Row click → metric drill-down Sheet

### 6. Date Filter Bar

**Existing:** `DateFilterBar.tsx`
**Action:** Restyle and move into `PageShell` actions slot

- Pill buttons: Hoy, 7 Dias, 30 Dias, Custom
- Active pill: `bg-accent text-accent-foreground`
- Inactive: `bg-surface-raised text-text-secondary border border-border`

### 7. Analytics Tab Content

**Existing:** `OtifTab.tsx`, `CxTab.tsx`, `UnitEconomicsTab.tsx`
**Action:** Restyle with spec-11 tokens, use `MetricCard` and `DataTable`

### 8. Other Dashboard Components to Restyle

- `DashboardErrorBanner.tsx` → use status error tokens
- `OfflineBanner.tsx` → use status warning tokens
- `ExportDashboardModal.tsx` → restyle as Dialog with accent buttons
- `LoadingKPIStrip.tsx` → skeleton using MetricCard dimensions
- `Sparkline.tsx` → use `stroke: var(--color-accent)`

## Acceptance Criteria

- [ ] Dashboard loads with all KPIs above the fold at 1920x1080 viewport (Playwright default, no browser chrome)
- [ ] Hero SLA card uses gold background with white monospace value
- [ ] 4 KPI MetricCards render inline with trends
- [ ] Charts use spec-11 token colors (no inline hex)
- [ ] Client performance uses `DataTable` with sorting and pagination
- [ ] Tab bar uses shadcn Tabs with gold active indicator
- [ ] Date filter pills use semantic token classes
- [ ] Mobile: KPI grid stacks to 2 columns
- [ ] All Vitest tests pass
- [ ] Build succeeds
