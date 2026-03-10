# Dashboard Pipeline Tabs & Loading Metrics

**Date:** 2026-03-04
**Status:** Approved
**Scope:** Dashboard restructure with pipeline navigation + Loading Data tab

---

## Context

The current dashboard shows SLA/FADR/failure metrics in a flat vertical layout. We need to restructure it as a **pipeline view** reflecting the full last-mile operation, with each operational process as a tab. The first tab to build is **Loading Data** (ingestion metrics).

## Dashboard Structure

### Pipeline Navigation

The dashboard gets a tab bar representing the operational pipeline:

```
[Overview] ─ [① Carga] ─ [② Retiro] ─ [③ Recepción] ─ [④ Distribución] ─ [⑤ Despacho] ─ [⑥ Última Milla]
```

- **Desktop (>768px):** Horizontal tab bar with step numbers and labels, thin connector lines between stages. Active tab: gold accent border-bottom + bold. Inactive future tabs: muted with "Próximamente" tooltip.
- **Mobile (<768px):** Dropdown select styled as stage indicator (e.g., "① Carga de Datos" + chevron). No horizontal scroll.
- **URL state:** `?tab=loading` query param, shareable, survives refresh.
- **Active tabs:** Overview (existing dashboard content) and Loading (new). Rest are placeholders.

### Tab Mapping

| Tab | Label | Content | Status |
|-----|-------|---------|--------|
| Overview | Vista General | Current SLA/FADR/failures/customer performance | Existing |
| ① Carga | Carga de Datos | Order ingestion metrics (this design) | **New** |
| ② Retiro | Retiro | Pickup operations | Placeholder |
| ③ Recepción | Recepción | Warehouse reception | Placeholder |
| ④ Distribución | Distribución | Distribution/sorting | Placeholder |
| ⑤ Despacho | Despacho y Ruteo | Dispatch and routing | Placeholder |
| ⑥ Última Milla | Última Milla | Last-mile delivery (Beetrack) | Placeholder |

---

## Loading Data Tab

### Purpose

Answers: **"What data came into the system, and what are we committed to deliver?"**

### Date Filter Bar

Shared across all sections within the tab. Sticky on scroll.

- **Quick buttons:** Hoy | Ayer | Esta Semana | Este Mes | Este Año
- **Custom date range:** Start/end date inputs inline
- **Style:** Pill-shaped buttons, gold fill (#e6c15c) on active, slate outline on inactive

### KPI Strip

5 headline cards in a row. Desktop: 5 columns. Mobile: wraps to 3+2 or 2+2+1.

| KPI | Label | Source | Logic |
|-----|-------|--------|-------|
| Orders Loaded | Órdenes Cargadas | `orders.created_at` | COUNT(*) in period |
| Packages Loaded | Bultos Cargados | `packages.created_at` | COUNT(*) in period. Subtitle: "Promedio: X.X por orden" |
| Orders Committed | Órdenes Comprometidas | `orders.delivery_date` | COUNT(*) where delivery_date in period |
| Active Clients | Clientes Activos | `orders.retailer_name` | COUNT(DISTINCT) in period |
| Comunas Covered | Comunas Cubiertas | `orders.comuna` | COUNT(DISTINCT) in period |

Each card: large bold number, label below, trend arrow vs previous equivalent period, optional subtitle.

### Charts Row

2 columns on desktop, stacked on mobile.

**Left: Evolución Diaria de Órdenes Cargadas**
- Stacked bar chart (Recharts)
- One bar per day, colored by retailer (Paris: sky blue #0ea5e9, Easy: emerald #10b981, future clients: purple, terracotta, etc.)
- X-axis: dates, Y-axis: order count
- Tooltip shows breakdown by retailer

**Right: Órdenes Comprometidas por Día**
- Line chart showing committed deliveries per day (by `delivery_date`)
- Overlays delivery window density
- Shows the "promise load" — what Musan is committed to deliver each day

### Breakdown Tables

2 columns on desktop, stacked on mobile.

**Left: Órdenes por Cliente**
- Table: Retailer | Órdenes | Bultos | % del Total
- Sorted by count descending
- Click a row to filter charts above

**Right: Órdenes por Región / Comuna**
- Dropdown to select region (from `recipient_region`)
- Table of comunas within selected region: Comuna | Órdenes | % del Total
- Sorted by count descending

---

## Visual Design

### Palette
- Existing system: dark slate text, white card backgrounds, gold (#e6c15c) accents
- Chart retailer colors: Paris #0ea5e9, Easy #10b981, future clients pull from existing palette

### Components
- Cards: `rounded-xl`, `shadow-sm`, hover `scale-1.01` — same as existing MetricsCard
- KPI strip: compact variant (no sparkline, just number + label + trend + subtitle)
- Charts: Recharts, consistent with existing FailedDeliveriesAnalysis
- Tables: same style as CustomerPerformanceTable — sortable, alternating rows

### Typography
- All Spanish labels
- Large numbers: `text-3xl font-bold`
- Labels: `text-sm text-slate-500`
- Trends: `text-xs` with green (#10b981) / red (#ef4444) color coding

### Responsive
- Pipeline nav: tabs on desktop, dropdown on mobile
- KPI strip: 5-col → flexible wrap on mobile
- Charts: 2-col → stacked on mobile
- Tables: 2-col → stacked on mobile
- Date filter bar: pills wrap naturally, custom range stacks inputs on mobile

---

## Data Sources

All queries filter by `operator_id` (RLS) and selected date range.

### Direct Queries (no pre-aggregation needed)

These metrics query the `orders` and `packages` tables directly:

```sql
-- Orders loaded (by created_at)
SELECT COUNT(*) FROM orders
WHERE operator_id = $1 AND created_at >= $2 AND created_at < $3 AND deleted_at IS NULL;

-- Packages loaded (by created_at)
SELECT COUNT(*) FROM packages p
JOIN orders o ON p.order_id = o.id
WHERE o.operator_id = $1 AND p.created_at >= $2 AND p.created_at < $3
AND o.deleted_at IS NULL AND p.deleted_at IS NULL;

-- Orders committed (by delivery_date)
SELECT COUNT(*) FROM orders
WHERE operator_id = $1 AND delivery_date >= $2 AND delivery_date <= $3 AND deleted_at IS NULL;

-- Daily evolution by retailer
SELECT DATE(created_at) as day, retailer_name, COUNT(*) as count
FROM orders
WHERE operator_id = $1 AND created_at >= $2 AND created_at < $3 AND deleted_at IS NULL
GROUP BY day, retailer_name ORDER BY day;

-- Orders by comuna
SELECT comuna, COUNT(*) as count
FROM orders
WHERE operator_id = $1 AND created_at >= $2 AND created_at < $3 AND deleted_at IS NULL
GROUP BY comuna ORDER BY count DESC;
```

### Performance Consideration

For MVP, direct queries are fine — the orders table has indexes on `operator_id`, `delivery_date`, and `created_at`. If performance becomes an issue with large datasets, we can add a pre-aggregated `loading_metrics` table similar to `performance_metrics`.

---

## Non-Goals

- No changes to existing Overview tab content (SLA, FADR, failures, customer performance)
- No implementation of tabs 2-6 (placeholders only)
- No new database tables or migrations (queries use existing orders/packages tables)
- No export functionality for this tab (can be added later)
