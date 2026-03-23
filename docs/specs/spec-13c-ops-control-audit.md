# Spec-13c: Operations Control & Audit Logs Redesign

> **Status:** in progress
> **Parent:** spec-13 (design language)
> **Depends on:** spec-13a (foundation components)
> **Phase:** 3 of 5

## Goal

Redesign operations control as a pipeline + table command view, and audit logs as a pure DataTable page. Both use the compound components from spec-13a.

---

## Part 1: Operations Control

**Route:** `/app/operations-control`

### Layout

```
┌──────────────────────────────────────────────────┐
│ PageShell: [Ops Control]  [Search + filter chips] │
├───────┬────────┬───────────┬────────┬────────────┤
│Recogido│En Ruta│En Entrega │Entregado│  Fallido  │
│   45   │  135  │    82     │ 1,089  │    23     │
├───────┴────────┴───────────┴────────┴────────────┤
│ [DataTable: all orders, compact, filterable]      │
│ [Row click → Sheet with order detail + timeline]  │
└──────────────────────────────────────────────────┘
```

### Deliverables

#### 1. Pipeline Overview Strip

**Existing:** `PipelineOverview.tsx`, `PipelineCard.tsx`
**Action:** Restyle

- Horizontal strip: `grid grid-cols-5 gap-2`
- Each card: `bg-surface border border-border rounded-md p-3 cursor-pointer`
- Active/filtered card: `border-accent bg-accent/5`
- Stage label: `text-xs text-text-muted uppercase`
- Count: `font-mono text-lg font-semibold`
- Mini progress bar under count: colored by status variant
- Click to filter DataTable below

#### 2. Orders DataTable

**Existing:** `OrdersTable.tsx`, `OrdersTableRow.tsx`, `OrdersFilterToolbar.tsx`
**Action:** Replace with `DataTable`

- Columns: Orden (mono), Cliente, Comuna, Estado (StatusBadge), Pkgs (mono), Hora (mono)
- Filter chips: status, client, comuna, date
- Search: by order ID or client name
- `onRowClick` → opens order detail Sheet

#### 3. Order Detail Sheet

**Existing:** `OrderDetailModal.tsx`
**Action:** Convert from Dialog to Sheet (slide-out from right)

- Width: `max-w-lg`
- Content: order header + StatusTimeline + PackageStatusBreakdown + delivery notes
- `StatusTimeline.tsx`: restyle with token colors, gold connecting line
- Close: X button or click outside

#### 4. Real-time Status Indicator

**Existing:** `RealtimeStatusIndicator.tsx`
**Action:** Simplify to subtle dot in PageShell title area

- Live: green pulsing dot + "En vivo"
- Stale: amber dot + "Actualizando..."
- Offline: red dot + "Sin conexion"

#### 5. Urgent Orders Banner

**Existing:** `UrgentOrdersBanner.tsx`
**Action:** Restyle with status error tokens, move above pipeline strip

#### 6. Mobile Operations Control

**Existing:** `MobileOCC.tsx` suite (7 components)
**Action:** Restyle with spec-11 tokens + touch-optimized cards

- Pipeline cards stack vertically as swipeable horizontal strip
- Order cards: touch-friendly (48px min target), `StatusBadge` prominent
- Pull-to-refresh: keep existing, restyle spinner
- Bottom tab bar: restyle with accent color for active tab

---

## Part 2: Audit Logs

**Route:** `/app/audit-logs`

### Layout

```
┌──────────────────────────────────────────────────┐
│ PageShell: [Auditoria]        [Export button]     │
├──────────────────────────────────────────────────┤
│ [DataTable: audit events, filter chips, search]   │
│ [Expandable detail row: payload/diff JSON]        │
└──────────────────────────────────────────────────┘
```

### Deliverables

#### 1. Audit DataTable

**Existing:** `AuditLogTable.tsx`, `AuditLogFilters.tsx`, `AuditLogDetailRow.tsx`
**Action:** Replace with `DataTable` + expandable row

- Columns: Timestamp (mono), Event Type (Badge), User, Entity, Description
- Filter chips: event type, user, date range
- Expandable row: click chevron to reveal JSON payload with `font-mono text-xs` formatting
- Export: `AuditLogExport.tsx` restyled, moved to PageShell actions

## Acceptance Criteria

- [ ] Pipeline cards filter the DataTable on click
- [ ] Order detail opens in a Sheet (not modal)
- [ ] StatusTimeline uses spec-11 token colors
- [ ] Real-time indicator shows in PageShell title area
- [ ] Audit logs use DataTable with expandable detail rows
- [ ] Mobile ops control is touch-optimized (48px targets)
- [ ] All Vitest tests pass
- [ ] Build succeeds
