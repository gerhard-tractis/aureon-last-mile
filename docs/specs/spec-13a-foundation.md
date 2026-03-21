# Spec-13a: Design Foundation — Components & Layout Shell

> **Status:** brainstorming
> **Parent:** spec-13 (design language)
> **Phase:** 1 of 5

## Goal

Install all shadcn primitives, build 5 compound components, and rewrite the app layout with the icon rail sidebar. No existing page visuals change yet — this phase builds the toolkit.

## Deliverables

### 1. Install 14 shadcn components

```bash
npx shadcn@latest add table tabs badge dropdown-menu select tooltip sheet separator command popover toggle progress calendar breadcrumb
```

### 2. Build `DataTable` compound component

**Files:**
- `src/components/data-table/DataTable.tsx`
- `src/components/data-table/DataTableToolbar.tsx`
- `src/components/data-table/DataTablePagination.tsx`
- `src/components/data-table/DataTableSkeleton.tsx`
- `src/components/data-table/DataTable.test.tsx`

**API:** See spec-13 §3.2 for full props interface.

**Requirements:**
- Built on shadcn `Table` primitive
- Compact 32px rows, monospace numbers, pill badges via `StatusBadge`
- Filter chips toolbar with search
- Sortable column headers (click to sort asc/desc/none)
- Pagination bar: "Showing X-Y of Z" + page buttons
- Loading state via `DataTableSkeleton`
- Empty state via `EmptyState` component
- `onRowClick` for drill-down navigation

### 3. Build `MetricCard` compound component

**Files:**
- `src/components/metrics/MetricCard.tsx`
- `src/components/metrics/MetricCard.test.tsx`

**API:** See spec-13 §3.2.

**Requirements:**
- Label + value + trend + optional sparkline
- Value always in Geist Mono
- Trend arrow: green up (favorable), red down (unfavorable)
- Sparkline: inline SVG, 60px wide, `stroke: var(--color-accent)`

### 4. Build `StatusBadge` component

**Files:**
- `src/components/StatusBadge.tsx`
- `src/components/StatusBadge.test.tsx`

**API:** See spec-13 §3.2.

**Requirements:**
- Maps order status → variant → colors automatically
- Pill shape: `rounded-full px-2 py-0.5 text-[11px] font-medium border`
- Uses status tokens from spec-11 (never raw hex)
- `sm` and `md` sizes

### 5. Build `PageShell` component

**Files:**
- `src/components/PageShell.tsx`
- `src/components/PageShell.test.tsx`

**API:** See spec-13 §3.2.

**Requirements:**
- Breadcrumb (shadcn `Breadcrumb`) + page title + action slot
- Consistent spacing: breadcrumb/actions top row, title below, separator, children

### 6. Build `EmptyState` component

**Files:**
- `src/components/EmptyState.tsx`
- `src/components/EmptyState.test.tsx`

**API:** See spec-13 §3.2.

### 7. Rewrite `AppLayout` — Icon Rail Sidebar

**Files:**
- `src/components/AppLayout.tsx` (rewrite)
- `src/components/sidebar/SidebarRail.tsx` (new)
- `src/components/sidebar/SidebarExpanded.tsx` (new)
- `src/components/sidebar/SidebarNavItem.tsx` (new)
- `src/components/sidebar/SidebarUserMenu.tsx` (new)
- `src/components/sidebar/useSidebarPin.ts` (new hook)
- `src/components/AppLayout.test.tsx` (update)

**Requirements:**
- 56px icon rail (default) / 200px pinned with labels
- Pin/unpin persisted to `localStorage` key `aureon-sidebar-pinned`
- Always dark background using sidebar-specific tokens (see spec-13 §4.1) — add sidebar tokens to `globals.css` `:root` and `tailwind.config.ts`
- Active item: gold left border + gold icon/text
- Tooltip on hover in icon-only mode
- Section dividers (Operaciones, Planificacion)
- User avatar + theme toggle + sign out at bottom
- Mobile: Sheet overlay triggered by hamburger, always shows labels
- Remove top header bar entirely
- Capacity alert bell → floating badge top-right of main content area (only when alerts exist)

## Acceptance Criteria

- [ ] All 22 shadcn components installed and importable
- [ ] `DataTable` renders with sorting, filtering, pagination, skeleton, empty state
- [ ] `MetricCard` renders with value, trend, sparkline
- [ ] `StatusBadge` correctly maps all 6 order statuses to colored pills
- [ ] `PageShell` renders breadcrumb + title + actions + children
- [ ] `EmptyState` renders icon + title + description + CTA
- [ ] Sidebar: icon rail mode works, pinned mode works, pin persists across reload
- [ ] Sidebar: mobile sheet overlay works with hamburger trigger
- [ ] All new components use spec-11 semantic tokens (zero inline hex)
- [ ] All files under 300 lines
- [ ] All Vitest tests pass
- [ ] Build succeeds
