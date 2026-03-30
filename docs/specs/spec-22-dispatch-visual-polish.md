# Spec 22 — Dispatch Screen Visual Polish

**Status:** completed

_Date: 2026-03-26_

---

## Goal

Bring the Despacho screen (`/app/dispatch`) and its RouteBuilder inner page up to design system parity with Reception (spec-21) and Distribution (spec-18). Fix critical bug where only today's routes were shown, hiding open routes from previous days.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Route date filter | Show all open routes regardless of date | Routes from previous days were being hidden — operators couldn't see draft routes created yesterday |
| Tab structure | Abiertas / En Ruta / Completadas | Mirrors Reception pattern; separates active work from history |
| Completadas range | Last 7 days | Prevents unbounded query growth while keeping recent context |
| RouteBuilder scope | Full polish including inner page | RouteBuilder had same inline `style={{}}` problems as the list page |
| Destructive actions | AlertDialog confirmations | "Cerrar Ruta" and "Despachar a DispatchTrack" are irreversible — require explicit confirmation |

## Bug Fix

**File:** `apps/frontend/src/hooks/dispatch/useDispatchRoutes.ts`

Removed `.eq('route_date', today)` filter that was hiding open routes from previous days. Query now returns all routes with `status IN ('draft', 'planned')` regardless of date, ordered by `route_date DESC, created_at DESC`.

## Changes

### 1. KPI MetricCards

**New file:** `apps/frontend/src/hooks/dispatch/useDispatchKPIs.ts`

| KPI | Label | Icon |
|-----|-------|------|
| Rutas abiertas | Open route count (draft + planned) | `Route` |
| Paquetes pendientes | SUM(planned_stops) from open routes | `Package` |
| Despachados hoy | Routes dispatched/completed today | `Truck` |
| En ruta ahora | Routes currently in_progress | `TrendingUp` |

Rendered as `grid grid-cols-2 sm:grid-cols-4 gap-3` using `<MetricCard>`.

### 2. Tabs (Abiertas / En Ruta / Completadas)

**New file:** `apps/frontend/src/hooks/dispatch/useDispatchRoutesByStatus.ts`

Generic hook accepting `statuses: RouteStatus[]` and optional `sinceDate` for tab-specific queries.

- **Abiertas:** `['draft', 'planned']`, no date filter
- **En Ruta:** `['in_progress']`, no date filter
- **Completadas:** `['completed', 'cancelled']`, last 7 days

### 3. RouteListTile Redesign

**File:** `apps/frontend/src/components/dispatch/RouteListTile.tsx`

- All inline `style={{}}` → Tailwind classes
- StatusBadge with Spanish labels: draft→Borrador, planned→Planificada, in_progress→En ruta, completed→Completada, cancelled→Cancelada
- Progress bar (completed_stops / planned_stops)
- Overdue warning: `border-status-warning-border bg-status-warning-bg` when `route_date < today` and still draft/planned
- Route date in Spanish locale format

### 4. Page Layout Polish

**File:** `apps/frontend/src/app/app/dispatch/page.tsx`

- Raw `<button>` → shadcn `<Button>` + `<Plus>` icon
- Inline empty state → `<EmptyState>` component per tab
- Loading skeleton cards (3 per tab)
- Responsive grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`

### 5. RouteBuilder Polish

| File | Changes |
|------|---------|
| `RouteBuilder.tsx` | Tailwind flex layout, responsive `flex-col md:flex-row`, StatusBadge in header |
| `RoutePanel.tsx` | shadcn Input, AlertDialog confirmations for close + dispatch, semantic error tokens |
| `ScanZone.tsx` | Tailwind migration from inline styles |
| `PackageRow.tsx` | StatusBadge with 9 Spanish package status labels, shadcn Button ghost for remove |

## Files Changed

| File | Action |
|------|--------|
| `hooks/dispatch/useDispatchRoutes.ts` | Edit — remove date filter, add ordering |
| `hooks/dispatch/useDispatchRoutesByStatus.ts` | Create — generic hook for tab queries |
| `hooks/dispatch/useDispatchKPIs.ts` | Create — 4 KPI counts |
| `app/app/dispatch/page.tsx` | Rewrite — MetricCards, Tabs, Button, EmptyState, skeletons |
| `components/dispatch/RouteListTile.tsx` | Rewrite — Tailwind, progress bar, Spanish labels, overdue |
| `components/dispatch/RouteBuilder.tsx` | Edit — Tailwind, responsive flex layout |
| `components/dispatch/RoutePanel.tsx` | Edit — shadcn components, AlertDialog confirmations |
| `components/dispatch/ScanZone.tsx` | Edit — Tailwind migration |
| `components/dispatch/PackageRow.tsx` | Edit — StatusBadge, Tailwind, Lucide X icon |
| `hooks/dispatch/useDispatchRoutes.test.ts` | Edit — verify no date filter |
| `hooks/dispatch/useDispatchKPIs.test.ts` | Create |
| `hooks/dispatch/useDispatchRoutesByStatus.test.ts` | Create |
| `components/dispatch/RouteListTile.test.tsx` | Create — 18 tests |

## Components Reused

`MetricCard`, `EmptyState`, `StatusBadge`, `Tabs`, `Button`, `Input`, `AlertDialog`, `Skeleton`

## PR

PR #180 — merged 2026-03-26. 13 files changed, 941 insertions, 186 deletions. 39 dispatch tests passing, 0 type errors.
