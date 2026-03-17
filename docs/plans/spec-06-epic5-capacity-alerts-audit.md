# Epic 5 — Capacity Calendar, Alerts & Audit Log Viewer

**Date:** 2026-03-13
**Status:** completed
**Epic:** 5 — Operations Control Center
**Stories:** 5.6, 5.7
**Depends on:** spec-03 (DB Foundation — retailer_daily_capacities table, capacity RPCs)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

## Problem

Operations managers need to: (1) set and visualize negotiated delivery capacities per retailer per day, receive alerts when approaching/exceeding capacity, and (2) search and filter audit logs to troubleshoot operational issues.

## Solution

Build two new pages:
1. **`/app/capacity-planning`** — calendar-based capacity management with utilization comparison and alerting
2. **`/app/audit-logs`** — searchable, filterable audit log viewer with expandable detail rows and CSV export

### Key Design Decisions

1. **Calendar UI for capacity** — one cell per day, editable. Bulk fill for patterns (Mon-Fri, Sat).
2. **Alerts stored in DB** — `capacity_alerts` table with deduplication. Surface via notification bell in AppLayout + Slack via existing n8n workflow.
3. **Audit log CSV export** — client-side generation initially (option A). Server-side added later if >10K rows becomes common.
4. **Non-admin audit filtering** — non-admin users automatically see only their own actions (filtered by `user_id`).

---

## Part 1: Capacity Calendar

### Route

`/app/capacity-planning` — new top-level page.

**Nav item:** "Capacidad" in sidebar, below Ops Control. Icon: `Calendar` from Lucide. Visible to `operations_manager` and `admin`.

### Page Layout

```
┌─────────────────────────────────────────────────────┐
│ Header: "Planificación de Capacidad"                 │
│ [Retailer selector ▼]          [◀ Marzo 2026 ▶]     │
│─────────────────────────────────────────────────────│
│  Lun    Mar    Mié    Jue    Vie    Sáb    Dom      │
│ ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐  │
│ │  300 │  300 │  300 │  300 │  300 │  150 │   -  │  │
│ │  278 │  312 │  290 │      │      │      │      │  │
│ │  93% │ 104% │  97% │      │      │      │      │  │
│ └──────┴──────┴──────┴──────┴──────┴──────┴──────┘  │
│  ... more weeks ...                                  │
│─────────────────────────────────────────────────────│
│  Bulk Fill: [Lun-Vie: ___] [Sáb: ___] [Aplicar]     │
│─────────────────────────────────────────────────────│
│  Utilization Summary Table (all retailers for month) │
└─────────────────────────────────────────────────────┘
```

### Calendar Cell

Each cell shows three rows:
- **Top:** Negotiated capacity (editable — click to change, Enter to save, Esc to cancel)
- **Middle:** Actual orders count (from `orders` grouped by `delivery_date` for this retailer)
- **Bottom:** Utilization % — color coded:
  - Green: <80%
  - Yellow: 80–100%
  - Orange: 100–120%
  - Red: >120%
- Future dates with no capacity: dashed border, "—"
- Past dates with no capacity: gray, "N/A"

### Bulk Fill

Select day-of-week pattern + capacity number → generates individual rows for the visible month:
- Fields: Mon-Fri capacity, Sat capacity (Sun defaults to 0/closed)
- "Aplicar" button inserts rows with `source = 'rule'`
- Overwrites existing values for the month with confirmation dialog

### Utilization Summary Table

Below the calendar, shows all retailers for the selected month:

| Retailer | Promedio Diario | Capacidad Promedio | Utilización | Días >100% |
|----------|----------------|-------------------|-------------|------------|
| Falabella | 287 | 300 | 96% | 3 |
| Ripley | 145 | 200 | 73% | 0 |

---

## Part 2: Capacity Alerts

### Alerts Table

```sql
CREATE TABLE capacity_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES tenant_clients(id) ON DELETE CASCADE,
  alert_date DATE NOT NULL,
  threshold_pct INT NOT NULL,
  actual_orders INT NOT NULL,
  daily_capacity INT NOT NULL,
  utilization_pct NUMERIC NOT NULL,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT unique_alert_per_threshold
    UNIQUE (operator_id, client_id, alert_date, threshold_pct)
);

CREATE INDEX idx_capacity_alerts_operator_active
  ON capacity_alerts(operator_id, dismissed_at)
  WHERE dismissed_at IS NULL AND deleted_at IS NULL;

-- Updated_at trigger
CREATE TRIGGER set_capacity_alerts_updated_at
  BEFORE UPDATE ON capacity_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE capacity_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "capacity_alerts_tenant_isolation" ON capacity_alerts
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

CREATE POLICY "capacity_alerts_tenant_select" ON capacity_alerts
  FOR SELECT
  USING (operator_id = public.get_operator_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON capacity_alerts TO authenticated;
REVOKE ALL ON capacity_alerts FROM anon;

-- Audit trigger
CREATE TRIGGER audit_capacity_alerts_changes
  AFTER INSERT OR UPDATE OR DELETE ON capacity_alerts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
```

### Alert Thresholds

**Alert trigger mechanism:**
- `≥100%` and `≥120%`: **DB trigger on orders INSERT** — immediate, actionable alerts. A trigger function checks utilization after each order insert and upserts into `capacity_alerts` if threshold crossed.
- `≥80%`: **Periodic check via n8n** (added to existing Operational Alerting workflow, runs every 15 min) — informational, slight delay acceptable.

**Thresholds:**
- `≥80%` utilization → info alert (yellow)
- `≥100%` utilization → warning alert (orange)
- `≥120%` utilization → critical alert (red)

**Notification channels:**
- In-app notification bell (all thresholds)
- Slack via existing n8n workflow (all thresholds)
- Email and SMS: **deferred** — requires Twilio/SMTP integration. Will be added when Aureon scales to multiple operators. Currently Slack covers the alerting need.

**Cross-tenant DevOps alerting:** Deferred (Story 5.8 is deferred). Currently alerts are operator-scoped via RLS.

Unique constraint prevents duplicate alerts for the same retailer/date/threshold.

### In-App Notification Bell

**Component:** `CapacityAlertBell.tsx` — added to AppLayout header.
- Bell icon (`Bell` from Lucide) with badge count of active (non-dismissed) alerts
- Click opens `CapacityAlertPanel.tsx` — dropdown panel listing recent alerts
- Each alert shows: timestamp, severity color, retailer name, utilization %, "Ver" and "Descartar" buttons
- "Ver" navigates to capacity calendar for that retailer/date
- "Descartar" sets `dismissed_at = NOW()`

### Slack Notification

Reuse existing Operational Alerting n8n workflow (`LCAdyXxLSeyMQk8d`):
- Add a new trigger path for capacity alerts
- Posts to `#aureon-alerts` channel via existing Slack webhook
- Message format: "⚠️ [Retailer] at [X]% capacity ([actual]/[negotiated] orders) for [date]"

---

## Part 3: Audit Log Viewer

### Route

`/app/audit-logs` — new top-level page.

**Nav item:** "Auditoría" in sidebar, near bottom. Icon: `ScrollText` from Lucide. Visible to `admin` and `operations_manager`.

### Access Control

- `admin`: sees all audit logs for the operator
- `operations_manager`: sees all audit logs for the operator
- Other roles: sees only logs where `user_id` matches their own (filtered automatically)

### Page Layout

```
┌─────────────────────────────────────────────────────┐
│ Header: "Registro de Auditoría"        [Exportar CSV]│
│─────────────────────────────────────────────────────│
│ [Fecha: Últimos 7 días ▼] [Usuario ▼] [Acción ▼]    │
│ [Recurso ▼] [Buscar...]                             │
│─────────────────────────────────────────────────────│
│ Fecha/Hora    │ Usuario  │ Acción  │ Recurso   │ ▶  │
│ 13/03 14:23   │ G.Neum   │ UPDATE  │ Order #12 │ ▶  │
│   └─ Before: {status: "ingresado"}                   │
│   └─ After:  {status: "verificado"}                  │
│ 13/03 14:20   │ Sistema  │ INSERT  │ Package   │ ▶  │
│ ... 50 rows per page ...                             │
│─────────────────────────────────────────────────────│
│ ◀ Página 1 de 23 ▶                                   │
└─────────────────────────────────────────────────────┘
```

### Table Columns

| Column | Content | Sortable |
|--------|---------|----------|
| Fecha/Hora | `timestamp` formatted | Yes (default: desc) |
| Usuario | Full name + role badge | Yes |
| Acción | INSERT/UPDATE/DELETE + table name | Yes |
| Recurso | Resource type + ID (clickable link) | Yes |
| IP | `ip_address` (hidden by default on narrow screens) | No |
| Detalle | Expand arrow `▶` | No |

### Expandable Detail Row

Click `▶` to expand:
- Shows full `changes_json` formatted
- UPDATE actions: before/after side-by-side with changed fields highlighted
- INSERT: shows `after` object
- DELETE: shows `before` object
- JSON syntax highlighting
- If `changes_json` >100KB: truncated display with "Ver JSON completo" button opening a modal

### Filters

- **Date range:** Default last 7 days. Presets: Hoy, Últimos 7 días, Últimos 30 días, Custom range
- **User dropdown:** All users in operator (fetched from `users` table)
- **Action type:** Todos, INSERT, UPDATE, DELETE
- **Resource type:** Todos, orders, packages, manifests, users, fleet_vehicles, routes, dispatches
- **Search:** Searches `resource_id` and action details

### CSV Export

Client-side generation:
- Includes all visible columns with current filters applied
- Date range in filename: `audit-logs-YYYY-MM-DD.csv`
- If >10K rows: show warning "Rango de fechas amplio. Considere reducir filtros." but allow export
- Uses `Blob` + `URL.createObjectURL` for download

### Pagination

50 rows per page. Standard page navigation (not infinite scroll — audit logs benefit from explicit pagination for investigation workflows). Story 5.7 mentions virtual scrolling for >500 logs — pagination is deliberately chosen instead as it better suits investigation workflows where users need to navigate to specific time ranges.

---

## Part 4: Forecast Accuracy Tracking

Story 5.6 requires forecast accuracy metrics. This is included as a section on the `/app/capacity-planning` page, below the utilization summary table.

### Accuracy Calculation

```sql
CREATE OR REPLACE FUNCTION get_forecast_accuracy(
  p_operator_id UUID,
  p_date_from DATE,
  p_date_to DATE
) RETURNS TABLE (
  client_id UUID,
  retailer_name VARCHAR,
  avg_variance_pct NUMERIC,
  accuracy_score NUMERIC,
  days_measured BIGINT
) AS $$
  SELECT
    rdc.client_id,
    tc.name AS retailer_name,
    ROUND(AVG(ABS(
      COUNT(o.id)::NUMERIC - rdc.daily_capacity
    ) / NULLIF(rdc.daily_capacity, 0) * 100), 1) AS avg_variance_pct,
    ROUND(100 - AVG(ABS(
      COUNT(o.id)::NUMERIC - rdc.daily_capacity
    ) / NULLIF(rdc.daily_capacity, 0) * 100), 1) AS accuracy_score,
    COUNT(DISTINCT rdc.capacity_date) AS days_measured
  FROM retailer_daily_capacities rdc
  JOIN tenant_clients tc ON tc.id = rdc.client_id
  LEFT JOIN orders o ON o.operator_id = rdc.operator_id
    AND o.tenant_client_id = rdc.client_id
    AND o.delivery_date = rdc.capacity_date
    AND o.deleted_at IS NULL
  WHERE rdc.operator_id = p_operator_id
    AND rdc.capacity_date BETWEEN p_date_from AND p_date_to
    AND rdc.deleted_at IS NULL
    AND rdc.capacity_date <= CURRENT_DATE  -- only past dates
  GROUP BY rdc.client_id, tc.name, rdc.capacity_date, rdc.daily_capacity;
$$ LANGUAGE sql STABLE;
```

### UI: Forecast Accuracy Section

Below the utilization summary on `/app/capacity-planning`:
- **Retailer accuracy ranking table:** Retailer name, accuracy score (%), avg variance, days measured. Sorted by accuracy descending (best forecasters first).
- **Trend chart (deferred):** Line chart showing 30-day accuracy trend per retailer. Deferred to a follow-up — the table provides the core insight. Chart can be added with a charting library (Recharts) when needed.

---

## Components File Map

```
src/app/app/capacity-planning/
  page.tsx                              ← route entry

src/components/capacity/
  CapacityCalendar.tsx                  ← month grid view
  CapacityCell.tsx                      ← single day cell (editable)
  CapacityBulkFill.tsx                  ← bulk fill controls
  CapacityUtilizationSummary.tsx        ← all-retailers summary table
  CapacityAccuracyRanking.tsx           ← forecast accuracy ranking table
  CapacityAlertBell.tsx                 ← notification bell (in AppLayout)
  CapacityAlertPanel.tsx                ← dropdown alert list

src/app/app/audit-logs/
  page.tsx                              ← route entry

src/components/audit/
  AuditLogTable.tsx                     ← main table with expandable rows
  AuditLogFilters.tsx                   ← filter toolbar
  AuditLogDetailRow.tsx                 ← expandable before/after diff view
  AuditLogExport.tsx                    ← CSV export button + logic
```

## Hooks

| Hook | Purpose |
|------|---------|
| `useCapacityCalendar(operatorId, clientId, month)` | Fetch capacities + actual orders for a retailer/month |
| `useCapacityUtilization(operatorId, dateFrom, dateTo)` | RPC `get_capacity_utilization` for summary table |
| `useForecastAccuracy(operatorId, dateFrom, dateTo)` | RPC `get_forecast_accuracy` for accuracy ranking |
| `useCapacityAlerts(operatorId)` | Active (non-dismissed) alerts |
| `useBulkFillCapacity()` | Mutation: bulk insert capacity rows |
| `useUpdateCapacity()` | Mutation: update single cell |
| `useDismissAlert()` | Mutation: set dismissed_at |
| `useAuditLogs(operatorId, filters)` | Paginated audit logs with filters |
| `useAuditLogUsers(operatorId)` | User list for filter dropdown |

---

## Edge Cases

### Capacity
- **No forecast set for retailer/day:** No alerts triggered, calendar shows "—"
- **Capacity = 0:** Treat as closed day, no utilization calculated
- **Bulk fill overwrites existing:** Confirmation dialog before applying
- **Alert fatigue:** Unique constraint deduplicates. One alert per retailer/date/threshold.

### Audit Logs
- **>10K logs in date range:** Warning message, client-side export still works
- **changes_json >100KB:** Truncated display with "Ver JSON completo" modal
- **Search no results:** Empty state: "No se encontraron registros"
- **Non-admin user:** RLS + application filter ensures they only see their own actions

---

## AppLayout Changes

Add two nav items to sidebar:
1. **"Capacidad"** — Position: after Ops Control. Icon: `Calendar`. Route: `/app/capacity-planning`. Roles: `operations_manager`, `admin`.
2. **"Auditoría"** — Position: near bottom, before Settings. Icon: `ScrollText`. Route: `/app/audit-logs`. Roles: `operations_manager`, `admin`.

Add `CapacityAlertBell` component to AppLayout header (next to existing user avatar area).

---

## Dependencies

- **Requires:** spec-03 (`retailer_daily_capacities` table, `get_capacity_utilization` RPC, `audit_logs` table already exists)
- **Independent of:** spec-04/05 (OCC pages) — can be built in parallel after spec-03
