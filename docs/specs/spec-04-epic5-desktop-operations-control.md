# Epic 5 — Desktop Operations Control Center

**Date:** 2026-03-13
**Status:** completed
**Epic:** 5 — Operations Control Center
**Stories:** 5.2, 5.3
**Depends on:** spec-03 (DB & Realtime Foundation)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

## Problem

Operations managers need a real-time dashboard to monitor the order pipeline across all 8 stages, filter and search orders, see urgency indicators, and drill into order details. The existing `/app/dashboard/operaciones` shows SLA/delivery metrics but has no pipeline view or order-level monitoring.

## Solution

Build a new `/app/operations-control` route with a pipeline overview (8 stage cards), a filterable/sortable orders table, and an order detail modal. All data refreshes via Supabase Realtime (from spec-03) with TanStack Query polling as fallback.

### Key Design Decisions

1. **New route, not an extension** of existing dashboard — different tool, different purpose.
2. **Pipeline cards + orders table** on one page — no tab switching needed for the core workflow.
3. **Clicking a pipeline card** filters the orders table to that stage.
4. **Order detail as modal** — stays in context of the table, not a separate route.
5. **Partial indicator** shown in table when `status ≠ leading_status` (e.g., "2/3").
6. **Sidebar:** Uses the existing `AppLayout` sidebar with a new nav item. Story 5.2's mockup shows a collapsible 70px/250px hover-expand sidebar — this is a full navigation restructure tracked separately (see `docs/plans/2026-03-10-nav-restructure-design.md`). This spec adds the OCC page and nav item to the current sidebar.
7. **Filter state in Zustand store:** `useOpsControlFilterStore` shared between pipeline cards and orders table for cross-component filter synchronization.
8. **Countdown timers decrement client-side** between refetches via a `useInterval` hook that recalculates time remaining every 60s from the stored deadline.

---

## Page Layout

```
┌─────────────────────────────────────────────────────┐
│ Sidebar    │  Header: "Operations Control - [Operator]"    │
│ (existing) │  Date selector (today default) + realtime dot │
│            │───────────────────────────────────────────────│
│            │  8 Pipeline Stage Cards (responsive grid)      │
│            │  [Ingresado][Verificado][En Bodega][Asignado]  │
│            │  [En Carga] [Listo]    [En Ruta] [Entregado]  │
│            │───────────────────────────────────────────────│
│            │  Filter toolbar: search, date, status, stage   │
│            │───────────────────────────────────────────────│
│            │  Orders Table (sortable, filterable, live)     │
│            │  ...rows...                                    │
│            │  Load More                                     │
└─────────────────────────────────────────────────────┘
```

**Responsive grid breakpoints:**
- `≥1440px`: 8 columns (all cards in one row)
- `1280px–1440px`: 4×2 grid
- `<768px`: renders mobile layout (spec-05)

---

## Components

### PipelineOverview.tsx

Renders 8 `PipelineCard` components in a responsive grid.

Data source: `usePipelineCounts(operatorId, date)` hook.

### PipelineCard.tsx

Single pipeline stage card:
- Stage name (Spanish label)
- Large count number with count-up animation on change
- Lucide icon per stage:
  - Ingresado → `PackagePlus`
  - Verificado → `ScanSearch`
  - En Bodega → `Warehouse`
  - Asignado → `UserCheck`
  - En Carga → `Truck`
  - Listo → `CheckCircle`
  - En Ruta → `Navigation`
  - Entregado → `PackageCheck`
- Footer status text: "X urgentes" (red) or "X atrasados" (gray) or "OK" (green) based on counts
- Color coding based on urgency counts:
  - Red border/glow if `urgent_count > 0` or `late_count > 0`
  - Yellow if `alert_count > 0` but no urgent/late
  - Green if all OK
  - Gray if count is 0
- Click handler: sets stage filter on orders table
- "Actualizado hace Xs" badge at bottom of pipeline section (uses `useRealtimeStatus` + last fetch timestamp)

### OrdersTable.tsx

Sortable, filterable table with columns:

| Column | Content | Sortable | Default |
|--------|---------|----------|---------|
| Status | Priority dot (🔴🟡🟢⚫) | Yes | — |
| Pedido | Order # (clickable → detail modal) | Yes | — |
| Cliente | `retailer_name` | Yes | — |
| Destino | `comuna` | Yes | — |
| Promesa | `delivery_date` ("Hoy", "Mañana", "DD/MM") | Yes | — |
| Ventana | Time window countdown ("En 45 min", "Pasado") | Yes | ↑ asc (default) |
| Estado | `status` colored badge | Yes | — |
| Parcial | "2/3" when `status ≠ leading_status` | No | — |
| Acciones | Context-sensitive: "Ver" (always), "Reasignar" (alert/urgent), "Escalar" (late) | No | — |

Pagination: 25 rows, "Load More" button. Virtual scrolling if >100 rows.

Data source: `useOperationsOrders(operatorId, filters)` hook.

### OrdersFilterToolbar.tsx

- Search input: searches order #, cliente, destino (client-side <500 rows, server-side >500)
- Date filter: Hoy (default), Mañana, Próximos 7 días, Custom range
- Status filter: Todos, Urgentes, Alertas, OK, Pasados
- Stage filter: populated from pipeline card clicks, clearable
- Clear all filters button

### UrgentOrdersBanner.tsx

Alert banner between pipeline cards and orders table (visible when urgent or late orders exist):
- Yellow/red background: "X pedidos urgentes requieren atención"
- "Ver Lista" button sets status filter to urgent
- Dismiss button hides until next data refresh

### OrderDetailModal.tsx

Opens when clicking an order number. Contents:
- Order header: order #, retailer, customer, delivery address, comuna
- Package status breakdown table (`PackageStatusBreakdown.tsx`): label, status, status_updated_at per package
- Status timeline (`StatusTimeline.tsx`): visual history from audit_logs
- Delivery info: promise date, time window
- "Reasignar zona" button (sets new zone assignment — placeholder action for now)
- Notes field (read-only placeholder, future feature)

### RealtimeStatusIndicator.tsx

Green/red dot in the page header showing WebSocket connection status. Uses `useRealtimeStatus()` from spec-03.

---

## Hooks

| Hook | Purpose | Data Source |
|------|---------|-------------|
| `usePipelineCounts(operatorId, date)` | Pipeline card counts + urgency | RPC `get_pipeline_counts()` |
| `useOperationsOrders(operatorId, filters)` | Paginated orders with computed priority | Supabase query on `orders` |
| `useOrderDetail(orderId)` | Single order + packages + audit history | Supabase joins |
| `useRealtimeOrders(operatorId)` | Realtime subscription (from spec-03) | Supabase Realtime |
| `useRealtimeStatus()` | Connection status (from spec-03) | WebSocket state |

All hooks follow existing pattern:
- `{ data, isLoading, isError }` return shape
- `staleTime: 30_000`, `refetchInterval: 60_000`
- `enabled: !!operatorId` guard
- `placeholderData: keepPreviousData` to prevent flash-of-empty on filter changes

---

## AppLayout Changes

Add "Ops Control" nav item in sidebar:
- Position: between Dashboard and Pickup
- Icon: `Activity` from Lucide
- Label: "Ops Control"
- Route: `/app/operations-control`
- Visibility: `operations_manager` and `admin` roles only

---

## File Map

```
src/app/app/operations-control/
  page.tsx                          ← route entry, layout, responsive switch

src/components/operations-control/
  PipelineOverview.tsx              ← 8 pipeline cards grid
  PipelineCard.tsx                  ← single stage card
  UrgentOrdersBanner.tsx            ← alert banner for urgent/late orders
  OrdersTable.tsx                   ← main table with sorting
  OrdersTableRow.tsx                ← single row (extracted to keep table <300 lines)
  OrdersFilterToolbar.tsx           ← search + filter controls
  OrderDetailModal.tsx              ← order detail slideout/modal
  PackageStatusBreakdown.tsx        ← package list in detail modal
  StatusTimeline.tsx                ← audit log timeline
  RealtimeStatusIndicator.tsx       ← green/red connection dot + "Updated Xs ago"

src/hooks/
  usePipelineCounts.ts              ← pipeline counts RPC
  useOperationsOrders.ts            ← paginated filtered orders
  useOrderDetail.ts                 ← single order + packages + audit
  useCountdownTimer.ts              ← client-side timer recalculating every 60s

src/stores/
  useOpsControlFilterStore.ts       ← Zustand: search, date, status, stage filters
```

---

## Edge Cases

- **0 orders in stage:** Card shows "0" in gray, not clickable
- **Narrow desktop (1280-1440px):** Sidebar auto-collapses, cards in 4×2 grid
- **Network offline:** Show last cached counts with "Offline" indicator via `useRealtimeStatus`
- **>500 orders:** Search switches to server-side, virtual scrolling enabled
- **No results for filter combination:** Empty state with "No orders match filters. Clear filters?"
- **Time window passes while viewing:** Row priority recalculated by `useCountdownTimer` every 60s. Late orders sort to bottom (negative countdown treated as lowest priority in sort)
- **New order arrives via Realtime:** Row appears at top with 3s highlight animation (detected by comparing previous query data IDs)
- **Search no results:** Empty state with "No hay órdenes que coincidan con '[query]'"

---

## Dependencies

- **Requires:** spec-03 (status columns, RPCs, realtime subscription)
- **Parallel with:** spec-05 (Mobile OCC — no shared components)
- **Blocked by:** spec-03 must be merged first
