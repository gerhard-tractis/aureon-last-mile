# Spec-13: Design Language & Visual Redesign

> **Status:** brainstorming
> **Depends on:** spec-11 (design system foundation — shipped)
> **Sub-specs:** 13a (foundation), 13b (dashboard), 13c (ops+audit), 13d (pickup+reception), 13e (capacity+admin+auth+cleanup)

## Overview

Replace the current ad-hoc frontend styling with a cohesive visual language built on spec-11's token system. This spec defines the component patterns, layout structure, and per-page redesign that every page and future module (including spec-10 agent suite) must follow.

**Aesthetic:** Command Center — high contrast, status-saturated, dense information hierarchy, Geist typography, Tractis gold accent.

---

## 1. Design Principles

1. **Density over whitespace** — maximize information above the fold. Scrolling is a cost.
2. **Monospace for data** — Geist Mono for all IDs, numbers, timestamps, percentages, codes.
3. **Status via color** — green/amber/red/blue pill badges. No ambiguous gray states.
4. **Consistent tokens** — use spec-11 semantic classes (`bg-surface`, `text-text-secondary`, `bg-accent`). Zero inline hex colors.
5. **Mobile = touch-optimized** — field worker flows (pickup, reception) get larger targets, not desktop-shrunk.
6. **Progressive disclosure** — summary on the page, details in a Sheet slide-out. No full-page navigations for drill-downs.

---

## 2. Typography Scale

| Usage | Font | Weight | Size | Tailwind |
|-------|------|--------|------|----------|
| Page title | Geist Sans | 700 | 20px | `text-xl font-bold` |
| Section heading | Geist Sans | 600 | 16px | `text-base font-semibold` |
| Body text | Geist Sans | 400 | 14px | `text-sm` |
| Secondary text | Geist Sans | 400 | 14px | `text-sm text-text-secondary` |
| Muted/caption | Geist Sans | 400 | 12px | `text-xs text-text-muted` |
| Table header | Geist Sans | 600 | 11px | `text-[11px] font-semibold uppercase tracking-wide` |
| Data values | Geist Mono | 500 | 14px | `font-mono text-sm font-medium` |
| KPI large | Geist Mono | 700 | 28px | `font-mono text-[28px] font-bold` |
| KPI small | Geist Mono | 600 | 20px | `font-mono text-xl font-semibold` |
| Badge text | Geist Sans | 500 | 11px | `text-[11px] font-medium` |

**Rule:** Any value that represents a measurement (count, percentage, time, ID, currency) uses Geist Mono. Everything else uses Geist Sans.

---

## 3. Component Pattern Library

### 3.1 New shadcn Components to Install (14)

```
Table, Tabs, Badge, DropdownMenu, Select, Tooltip, Sheet,
Separator, Command, Popover, Toggle, Progress, Calendar, Breadcrumb
```

Total after install: 22 shadcn primitives.

### 3.2 Compound Components (5 new)

#### `DataTable`

Reusable sortable, filterable, paginated data table.

**File:** `src/components/data-table/DataTable.tsx`

**Props:**
```typescript
interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  isLoading?: boolean;
  filterChips?: FilterChip[];
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  pagination?: { page: number; pageSize: number; total: number };
  onPageChange?: (page: number) => void;
  emptyMessage?: string;
}
```

**Visual spec:**
- Compact rows (32px height)
- Header: `bg-surface` background, `text-[11px] font-semibold uppercase tracking-wide text-text-muted`
- Rows: `border-b border-border-subtle`, no zebra striping
- Hover: `bg-surface-raised`
- Numbers/IDs: `font-mono`
- Filter chips toolbar above table: `bg-surface-raised rounded-md px-2 py-1 text-xs`
- Search input: right-aligned in toolbar
- Pagination: bottom bar with "Showing X-Y of Z" left, page buttons right

**Supporting files:**
- `src/components/data-table/DataTablePagination.tsx`
- `src/components/data-table/DataTableToolbar.tsx`
- `src/components/data-table/DataTableSkeleton.tsx`

#### `MetricCard`

KPI display card with value, trend, and optional sparkline.

**File:** `src/components/metrics/MetricCard.tsx`

**Props:**
```typescript
interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: { direction: 'up' | 'down' | 'flat'; value: string; favorable: boolean };
  sparklineData?: number[];
  icon?: LucideIcon;
  href?: string; // optional drill-down link
}
```

**Visual spec:**
- `bg-surface border border-border rounded-md p-3`
- Label: `text-xs text-text-muted uppercase tracking-wide`
- Value: `font-mono text-xl font-semibold`
- Trend: `text-xs` with green arrow up (favorable) or red arrow down (unfavorable)
- Sparkline: 60px wide inline SVG, `stroke: var(--color-accent)`

#### `StatusBadge`

Consistent status pill badge.

**File:** `src/components/StatusBadge.tsx`

**Props:**
```typescript
type OrderStatus = 'pending' | 'picked_up' | 'in_transit' | 'delivered' | 'failed' | 'returned';
type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusBadgeProps {
  status: OrderStatus | string;
  variant?: BadgeVariant; // auto-derived from status if not provided
  size?: 'sm' | 'md';
}
```

**Status → variant mapping:**
| Status | Variant | Label (ES) | Colors |
|--------|---------|------------|--------|
| `delivered` | success | Entregado | `bg-status-success-bg text-status-success border-status-success-border` |
| `in_transit` | warning | En Ruta | `bg-status-warning-bg text-status-warning border-status-warning-border` |
| `failed` | error | Fallido | `bg-status-error-bg text-status-error border-status-error-border` |
| `picked_up` | info | Recogido | `bg-status-info-bg text-status-info border-status-info-border` |
| `pending` | neutral | Pendiente | `bg-surface-raised text-text-secondary` |
| `returned` | error | Devuelto | `bg-status-error-bg text-status-error border-status-error-border` |

**Visual:** `inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border`

#### `PageShell`

Standard page wrapper providing consistent layout.

**File:** `src/components/PageShell.tsx`

**Props:**
```typescript
interface PageShellProps {
  title: string;
  breadcrumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode; // buttons, date picker, export
  children: React.ReactNode;
}
```

**Layout:**
```
[Breadcrumb: Dashboard > Operaciones]         [Actions: Export, Filter]
[Page Title - text-xl font-bold]
────────────────────────────────────────────────────────────────────────
[children]
```

- Top row: breadcrumb left, actions right — `flex justify-between items-center mb-1`
- Title: `text-xl font-bold text-text mb-4`
- Separator: `border-b border-border mb-4`

#### `EmptyState`

Zero-data placeholder for list/table pages.

**File:** `src/components/EmptyState.tsx`

**Props:**
```typescript
interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void } | { label: string; href: string };
}
```

**Visual:**
- Centered vertically in parent
- Icon: `h-12 w-12 text-text-muted mb-4`
- Title: `text-base font-semibold text-text mb-1`
- Description: `text-sm text-text-secondary mb-4 max-w-sm text-center`
- CTA button: `bg-accent text-accent-foreground`

---

## 4. Navigation & Layout Shell

### 4.1 Icon Rail Sidebar

**Default state:** 56px wide icon rail
**Pinned state:** 200px wide with labels
**Persistence:** `localStorage` key `aureon-sidebar-pinned`

**Structure:**
```
┌──────────────────────┐
│ [Logo: 32px gold]    │  ← always visible
│                      │
│ ── Operaciones ──    │  ← section label (pinned only)
│ [■] Dashboard        │  ← active: gold left border + gold icon
│ [⚙] Ops Control     │
│ [✓] Pickup           │
│ [⇅] Recepcion        │
│                      │
│ ── Planificacion ──  │
│ [☷] Capacidad        │
│ [☰] Auditoria        │
│                      │
│        ⋮             │  ← spacer
│ ── ── ── ── ── ──   │  ← separator
│ [⚙] Settings         │
│ [◑] Theme Toggle     │
│ [GN] gerhard         │  ← avatar + name (pinned), just avatar (rail)
│ [«] Pin/unpin        │  ← toggle button
└──────────────────────┘
```

**Colors (always dark regardless of theme mode):**

The sidebar is exempt from the zero-hex rule because it maintains a fixed dark appearance across all three modes. Define these as sidebar-specific tokens in `globals.css` at `:root`:

```css
:root {
  --color-sidebar-bg: #0f172a;
  --color-sidebar-text: #94a3b8;
  --color-sidebar-text-active: #ca9a04;
  --color-sidebar-hover: rgba(255,255,255,0.05);
  --color-sidebar-section: #64748b;
  --color-sidebar-border: #1e293b;
}
```

Map in tailwind.config.ts as `sidebar.*` tokens. This keeps the sidebar dark while still using token classes (not inline hex).

**Icon-only mode:**
- Icons centered, 40x40px hit target
- Tooltip on hover (shadcn Tooltip) showing label
- No section labels visible

**Mobile (< 1024px):**
- Sidebar hidden by default
- Hamburger button (top-left) opens sidebar as Sheet overlay
- Always shows full labels when open on mobile

### 4.2 Top Header — Removed

The current sticky h-16 header is eliminated. Its contents move to:
- Theme toggle → sidebar bottom
- Capacity alert bell → floating badge top-right of main content (only when alerts exist)
- User dropdown → sidebar bottom avatar
- Mobile hamburger → floating top-left button

### 4.3 Main Content Area

```css
/* Icon rail mode */
.main-content { margin-left: 56px; }

/* Pinned sidebar mode */
.main-content { margin-left: 200px; }

/* Mobile */
.main-content { margin-left: 0; }
```

- Background: `bg-background`
- Padding: `p-4 lg:p-6`
- Max-width: none (full-width utilization for command center density)

---

## 5. Page Redesigns

### 5.1 Dashboard (Phase 2 — highest priority)

**Route:** `/app/dashboard`, `/app/dashboard/operaciones`, `/app/dashboard/analitica`

**Layout — Dense Command Center:**
```
┌─────────────────────────────────────────────────────────────┐
│ [PageShell: breadcrumb + date filter]                       │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ Hero SLA │ Pedidos  │Entregados│ Fallidos │   En Ruta       │ ← KPI strip
│  94.2%   │  1,247   │  1,089   │    23    │    135          │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│ [Orders by Hour chart]         │ [SLA Trend 7d chart]       │ ← side-by-side
├────────────────────────────────┴────────────────────────────┤
│ [Tab bar: Operaciones | Analitica]                          │
├─────────────────────────────────────────────────────────────┤
│ [DataTable: Client Performance]                             │ ← below fold
└─────────────────────────────────────────────────────────────┘
```

**Hero SLA card:** `bg-accent text-white` (always white text, not `text-accent-foreground`, because the gold background is consistent across modes) with large monospace value, trend, and inline sparkline.

**KPI cards:** 4 cards inline, `bg-surface border border-border`. Value in monospace. Trend arrow colored (green up = good, red down = bad).

**Charts:** Restyle existing charts with spec-11 tokens. Gold bars for primary data, `text-text-muted` for labels, `border-border-subtle` for gridlines.

### 5.2 Operations Control (Phase 3)

**Route:** `/app/operations-control`

**Layout:**
```
┌──────────────────────────────────────────────────┐
│ [PageShell + search + filter chips]               │
├───────┬────────┬───────────┬────────┬────────────┤
│Recogido│En Ruta│En Entrega │Entregado│  Fallido  │ ← pipeline cards
│   45   │  135  │    82     │ 1,089  │    23     │
├───────┴────────┴───────────┴────────┴────────────┤
│ [DataTable: all orders, compact, filterable]      │
│ [Row click → Sheet with order detail + timeline]  │
└──────────────────────────────────────────────────┘
```

**Pipeline cards:** Horizontal strip, each card shows count + mini progress bar. Click to filter table.

**Order detail Sheet:** Slide-out from right. Shows order timeline (StatusTimeline), package breakdown, customer info, delivery notes.

### 5.3 Audit Logs (Phase 3)

**Route:** `/app/audit-logs`

Pure DataTable page. Filter chips for event type, user, date range. Expandable detail row for payload/diff.

### 5.4 Pickup Flow (Phase 4 — mobile-first)

**Routes:** `/app/pickup`, `/app/pickup/scan/[loadId]`, `/app/pickup/review/[loadId]`, `/app/pickup/handoff/[loadId]`, `/app/pickup/complete/[loadId]`

**Mobile (touch-optimized):**
- Breadcrumb step indicator: `Pickup > Scan > Review > Handoff > Complete`
- Gold header bar with progress (X/Y scanned, progress bar)
- Large scan button: `bg-accent rounded-lg p-3 text-center text-base`
- Package cards: `bg-surface rounded-lg p-3`, 48px touch targets, chunky circle checkmarks
- Verified: green border + green circle checkmark
- Pending: default border + gray circle dash

**Desktop:**
- Same flow but wider layout, packages in a narrower DataTable format
- Scan input as text field (not full-screen button)

### 5.5 Reception (Phase 4 — mobile-first)

**Routes:** `/app/reception`, `/app/reception/scan/[receptionId]`, `/app/reception/complete/[receptionId]`

Same touch-optimized patterns as pickup. QR scanner gets full-viewport treatment on mobile.

### 5.6 Capacity Planning (Phase 5)

**Route:** `/app/capacity-planning`

- Restyle calendar with spec-11 tokens
- Capacity cells: colored by utilization (green < 80%, amber 80-95%, red > 95%)
- Alert panel → Sheet slide-out
- Bulk fill form stays as modal (Dialog)

### 5.7 Admin Users (Phase 5)

**Route:** `/admin/users`

DataTable with user list. Create/edit user → Sheet slide-out form. Delete → AlertDialog confirmation.

### 5.8 Auth Pages (Phase 5)

**Routes:** `/auth/login`, `/auth/register`, `/auth/2fa`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`

- Standalone layout (no sidebar)
- Centered card: `max-w-sm mx-auto mt-20 bg-surface border border-border rounded-lg p-8`
- Logo at top center
- Gold primary button: `bg-accent text-accent-foreground`
- Geist Sans typography throughout

### 5.9 Orders Pages (Phase 5)

**Routes:** `/app/orders/import`, `/app/orders/new`

- Wrap in `PageShell` with breadcrumb
- Import: restyle file upload form with spec-11 tokens, validation errors with `text-status-error`
- New order: restyle `ManualOrderForm` inputs with spec-11 tokens

### 5.10 User Settings (Phase 5)

**Route:** `/app/user-settings`

- Wrap in `PageShell`
- Form sections with `Separator` between them
- Toggle switches for preferences (shadcn `Toggle`)

### 5.11 Out-of-Scope Pages

These pages are debug/utility and excluded from the redesign:

- `/app/table` — debug/demo table page
- `/app/storage` — debug/storage page
- `/offline` — PWA offline fallback (minimal styling, keep as-is)
- `/legal`, `/legal/[document]` — legal document renderer (content-focused, keep as-is)

---

## 6. Migration Strategy

| Phase | Spec | Scope | Estimated Files |
|-------|------|-------|-----------------|
| 1 | spec-13a | Foundation: shadcn installs, compound components, sidebar rewrite | ~20 new + 5 modified |
| 2 | spec-13b | Dashboard redesign | ~15 modified |
| 3 | spec-13c | Operations Control + Audit Logs | ~15 modified |
| 4 | spec-13d | Pickup + Reception (mobile-first) | ~20 modified |
| 5 | spec-13e | Capacity, Admin, Auth, cleanup | ~15 modified |

**Rules:**
- Each phase is its own branch + PR
- No phase depends on a later phase (can ship incrementally)
- Every compound component built in Phase 1 must be used by at least one page in Phases 2-5
- All inline hex colors (`text-[#hex]`, `bg-[#hex]`) replaced with semantic tokens
- All new components follow spec-11 token system exclusively
- Files stay under 300 lines

---

## 7. Token Usage Cheat Sheet

**Backgrounds:**
- Page: `bg-background`
- Cards/panels: `bg-surface`
- Elevated cards: `bg-surface-raised`
- Active sidebar item: `bg-accent/10`

**Text:**
- Primary: `text-text`
- Secondary: `text-text-secondary`
- Muted/caption: `text-text-muted`
- On accent: `text-accent-foreground`

**Borders:**
- Default: `border-border`
- Subtle (inside cards): `border-border-subtle`

**Accent:**
- Buttons, active states: `bg-accent text-accent-foreground`
- Links, highlights: `text-accent`
- Hover: `bg-accent/90` or `hover:opacity-90`

**Status (never use raw hex — always use tokens):**
- Success: `bg-status-success-bg text-status-success border-status-success-border`
- Warning: `bg-status-warning-bg text-status-warning border-status-warning-border`
- Error: `bg-status-error-bg text-status-error border-status-error-border`
- Info: `bg-status-info-bg text-status-info border-status-info-border`
