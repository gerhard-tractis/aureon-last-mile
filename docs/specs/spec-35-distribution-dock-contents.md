# Spec 35 — Distribution: Per-Dock Pending Package Visibility

**Status:** in progress

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators visibility into *which specific packages* are pending sectorization on each dock while they work in **Modo Lote** and **Modo Rápido** — instead of only a count.

**Architecture:** Extend the existing `usePendingSectorization` hook to return richer package data. Introduce a shared `PendingPackageList` component used by both modes. Make each dock card in `BatchOverview` expandable in place. Render a collapsible pending list under the scanner in Modo Rápido. No backend / RPC changes.

**Tech Stack:** Next.js App Router, Supabase (client-side query), React Query, shadcn/ui, Lucide icons, Vitest + RTL.

---

## Context

Today, the Distribution surfaces show only counts per dock:

- `apps/frontend/src/app/app/distribution/batch/page.tsx` renders `BatchOverview` which shows each dock as a card with `{count} paquetes por sectorizar` and an **Iniciar lote** button — no list of individual packages.
- `apps/frontend/src/app/app/distribution/quicksort/page.tsx` renders only the `QuickSortScanner` — the operator cannot see what packages are still pending.

**User need:** At the moment of distributing, the operator wants to see each pending package together with the dock it should go to (or Consolidation, for comunas with no assigned dock).

- **Modo Lote** — per dock card, show only that dock's pending packages.
- **Modo Rápido** — show a single flat list of all pending packages, each annotated with its destination dock.

---

## Data Model — Extend `PendingPackage`

Current (in `apps/frontend/src/hooks/distribution/usePendingSectorization.ts`):

```ts
export interface PendingPackage {
  id: string;
  label: string;
  order_id: string;
  comunaId: string | null;
  delivery_date: string;
}
```

Extend to:

```ts
export interface PendingPackage {
  id: string;
  label: string;
  status: string;                        // from packages.status
  order_id: string;
  order_number: string | null;           // from orders.order_number
  customer_name: string | null;          // from orders.customer_name
  delivery_address: string | null;       // from orders.delivery_address
  comunaId: string | null;
  comuna_name: string | null;            // chile_comunas.nombre via FK; fallback to orders.comuna (legacy text)
  delivery_date: string;
  delivery_window_start: string | null;  // TIME as "HH:MM:SS" — format to "HH:MM" in the UI
  delivery_window_end: string | null;    // TIME as "HH:MM:SS" — format to "HH:MM" in the UI
  is_due_soon: boolean;                  // computed client-side: delivery_date === today
}
```

Keep `ZoneGroup` unchanged — it already carries `zone` and `matchResult`, which exposes the destination dock info.

**Supabase query update:**

```ts
.from('packages')
.select(`
  id, label, status, order_id,
  orders!inner(
    order_number, customer_name, delivery_address,
    comuna, comuna_id, delivery_date,
    delivery_window_start, delivery_window_end,
    chile_comunas ( nombre )
  )
`)
.eq('operator_id', operatorId!)
.eq('status', 'en_bodega')
.is('deleted_at', null)
.order('created_at', { ascending: true });
```

**Notes for the implementer:**

- The join table is `public.chile_comunas` (not `comunas`), and the name column is `nombre` (not `name`). The FK `orders.comuna_id → chile_comunas.id` is defined in migration `20260321000001`; PostgREST detects it automatically.
- When mapping to `PendingPackage.comuna_name`, prefer `orders.chile_comunas.nombre`; if `comuna_id` is null, fall back to the legacy `orders.comuna` text column. Never show both.
- The address column is `orders.delivery_address` — not `orders.address`. There is also a newer `destination_address` JSONB; **use `delivery_address`** for this spec (it's the plain-text field rendered on all current screens).
- `delivery_window_start` / `_end` come back as `HH:MM:SS` strings (Postgres `TIME`). In the UI, slice to `HH:MM` (`value.slice(0, 5)`). Render as `09:00–13:00`; when either side is null, show a dash.
- **Soft-delete scoping:** the filter `.is('deleted_at', null)` already applies to `packages`. `orders` also has `deleted_at`, but by business rule a live `en_bodega` package always has a live order, so no extra filter is needed. If this ever changes, add `.is('orders.deleted_at', null)`.
- **Operator scoping:** `packages.operator_id = operatorId` is the single explicit scope. The embedded `orders` and `chile_comunas` rows are scoped by RLS on those tables (same pattern as every other query in this file and in sibling distribution hooks).

---

## Component Architecture

### New: `PendingPackageList`

`apps/frontend/src/components/distribution/PendingPackageList.tsx`

**Purpose:** Render a list of pending packages. Each row collapses to a primary line and expands to show secondary fields. Reused by both modes.

**Props:**

```ts
interface PendingPackageListProps {
  packages: PendingPackage[];
  /** Map of zoneId → { code, name, flagged } so each row can show its dock chip.
   *  Required for Modo Rápido; omitted/undefined for Modo Lote (all rows go to the same dock). */
  destinationByPackageId?: Record<string, { zone_code: string; zone_name: string; flagged: boolean }>;
  /** When true, hide the destination dock chip on every row (used inside a Modo Lote dock card). */
  hideDestination?: boolean;
  /** Optional empty-state override. */
  emptyMessage?: string;
}
```

**Row anatomy:**

```
▸  P-001 · ORD-9123 · Providencia · hoy          [AN]
     └─ (on expand)
        Cliente: María Gómez
        Dirección: Av. Providencia 1234, Dpto 301
        Ventana: 09:00–13:00
        Estado: próximo a despachar ⚠
```

- Primary line is a button (accessible) that toggles the secondary block.
- Destination chip on the right. `CONS` (consolidation / flagged) uses `bg-status-warning-bg border-status-warning-border text-status-warning`.
- `is_due_soon` packages get a small warning tint on the row (or on the delivery-date text).
- No virtualization (YAGNI). If perf becomes an issue, add `@tanstack/react-virtual` later.
- Keep the file under 300 lines.

### Changed: `BatchOverview`

`apps/frontend/src/components/distribution/BatchOverview.tsx`

- Add per-card local state `expanded: boolean` (default `false`).
- Card header becomes a clickable area that toggles `expanded`. Chevron (▸ / ▾) appears next to the count.
- **Iniciar lote** button unchanged — keep it at the bottom of the card, still works when collapsed OR expanded.
- When `expanded`, render `<PendingPackageList packages={packages} hideDestination />` inside the card body.
- Stop propagation on the **Iniciar lote** button so clicking it does not toggle the expand state.

### Changed: `apps/frontend/src/app/app/distribution/quicksort/page.tsx`

- Continue to render `<QuickSortScanner/>` at the top.
- Below the scanner, render a collapsible **Pendientes (N)** section:
  - Default `open` on `sm+` breakpoints, default `closed` on mobile (use `useMediaQuery` helper if present — otherwise Tailwind `hidden sm:block` for the open-by-default variant is fine, but we want user-togglable, so a local `useState` + a button works everywhere).
  - Fetch data by calling `usePendingSectorization(operatorId)` — **flatten** `ZoneGroup[]` into a single array of packages and build `destinationByPackageId` from each group's `matchResult`.
  - Pass the flat list and the map into `<PendingPackageList/>`.
- React Query already invalidates `['distribution', 'pending-sectorization', operatorId]` on relevant mutations — verify `useCreateDockBatch` / `useCloseDockBatch` / `useDockScanMutation` invalidate this key; if not, add it (small, in-scope).

---

## Stories / Acceptance Criteria

1. **Lote — expand dock to see its packages.** In Modo Lote, clicking a dock card header toggles an inline list of that dock's pending packages. The **Iniciar lote** button keeps working.
2. **Lote — no destination chip inside a dock card.** Rows rendered inside a Modo Lote dock card do not show the destination chip (redundant).
3. **Rápido — flat pending list.** In Modo Rápido, below the scanner, a collapsible **Pendientes (N)** section lists every pending package, each row showing its destination dock chip (or `CONS` for flagged).
4. **Row expansion.** Clicking any row reveals customer name, address, delivery window, status. Clicking again collapses.
5. **Due-soon highlighting.** Packages where `delivery_date === today` are visually flagged ("próximo a despachar" in the expanded row; accent style on the primary line).
6. **Live refresh.** After a scan in Modo Rápido completes, the list decrements — the scanned package disappears within one React Query invalidation cycle.
7. **Empty state.** When there are no pending packages, each surface shows a friendly empty message — Lote keeps its current `BatchOverview` empty state; Rápido shows "No hay paquetes pendientes" under the scanner.

---

## Chunk 1: Data Layer

### Task 1: Extend `PendingPackage` and the Supabase query

**Files:**
- Modify: `apps/frontend/src/hooks/distribution/usePendingSectorization.ts`
- Modify or create: `apps/frontend/src/hooks/distribution/usePendingSectorization.test.ts` (if none exists, create one)

- [ ] **Step 1 (TDD — red):** Write a unit test that mocks `createSPAClient` and `useDockZones`, returns a canned package + orders + comunas payload, and asserts the resulting `ZoneGroup[]` exposes `order_number`, `customer_name`, `address`, `comuna_name`, `delivery_window_start`, `delivery_window_end`, `status`, and `is_due_soon`.
- [ ] **Step 2 (green):** Extend the `PendingPackage` interface and the `.select(...)` string. Compute `is_due_soon` from the query's `today` variable. Keep the function under 300 lines.
- [ ] **Step 3:** Run `npm -w apps/frontend test -- usePendingSectorization` — green.

### Task 2: Verify / wire React Query invalidation for Modo Rápido

**Files:**
- Read: `apps/frontend/src/hooks/distribution/useDockBatches.ts`
- Read: `apps/frontend/src/hooks/distribution/useDockScans.ts`

- [ ] **Step 1:** Confirm these mutations invalidate `['distribution', 'pending-sectorization', operatorId]` on success. If not, add `queryClient.invalidateQueries({ queryKey: ['distribution', 'pending-sectorization', operatorId] })`.
- [ ] **Step 2:** Add / extend a hook test asserting the invalidation.

---

## Chunk 2: Shared `PendingPackageList` Component

### Task 3: Build the component (TDD)

**Files:**
- Create: `apps/frontend/src/components/distribution/PendingPackageList.tsx`
- Create: `apps/frontend/src/components/distribution/PendingPackageList.test.tsx`

- [ ] **Step 1 (red):** Tests covering:
  - Renders one row per package with label, order number, comuna, delivery date.
  - Destination chip visible when `destinationByPackageId` is passed; hidden when `hideDestination` is true; hidden when no map and no `hideDestination`.
  - Clicking a row expands to show customer, address, delivery window, status.
  - `is_due_soon` packages get the "próximo a despachar" accent.
  - Empty state uses `emptyMessage` when provided.
- [ ] **Step 2 (green):** Implement the component. Use existing shadcn primitives where appropriate; Lucide `ChevronRight` / `ChevronDown` for the row toggle. Keep under 300 lines.
- [ ] **Step 3:** Run `npm -w apps/frontend test -- PendingPackageList` — green.

---

## Chunk 3: Modo Lote — Expandable Dock Cards

### Task 4: Make `BatchOverview` cards expandable

**Files:**
- Modify: `apps/frontend/src/components/distribution/BatchOverview.tsx`
- Modify: `apps/frontend/src/components/distribution/BatchOverview.test.tsx`

- [ ] **Step 1 (red):** Extend the test — clicking the card header toggles expand; expanded card renders rows matching `packages.length`; clicking **Iniciar lote** still calls `onStartBatch` and does not toggle expand.
- [ ] **Step 2 (green):** Add `expanded` state + chevron indicator in the card header; render `<PendingPackageList packages={packages} hideDestination />` inside the card body when `expanded`. `stopPropagation` on the start-batch button.
- [ ] **Step 3:** Run `npm -w apps/frontend test -- BatchOverview` — green.

---

## Chunk 4: Modo Rápido — Flat Pending List Under Scanner

### Task 5: Add the pending list to the quicksort page

**Files:**
- Modify: `apps/frontend/src/app/app/distribution/quicksort/page.tsx`
- Create: `apps/frontend/src/app/app/distribution/quicksort/page.test.tsx` (if absent — otherwise extend)

- [ ] **Step 1 (red):** Test the page — with canned `usePendingSectorization` data, the **Pendientes (N)** section shows the correct count and rows; each row shows a destination dock chip derived from the group's `matchResult`; a flagged (consolidation) group shows the `CONS` chip style.
- [ ] **Step 2 (green):** In the page component, call `usePendingSectorization(operatorId)`. Flatten into a single `PendingPackage[]` and build the `destinationByPackageId` map from each group's `matchResult`. Render a collapsible section titled **Pendientes (N)** below the `<QuickSortScanner/>`, default closed on mobile (use a local `useState` toggle — start `false`, user can open).
- [ ] **Step 3:** Run the page test — green.

---

## Chunk 5: Verification

### Task 6: Manual + automated verification

- [ ] **Step 1:** `npm -w apps/frontend test` — all tests green.
- [ ] **Step 2:** `npm -w apps/frontend run lint` and `npm -w apps/frontend run typecheck` — green.
- [ ] **Step 3:** Spin up dev server, navigate to `/app/distribution/batch` — expand cards, verify correct packages listed per dock, verify row expand reveals all secondary fields.
- [ ] **Step 4:** Navigate to `/app/distribution/quicksort` — verify **Pendientes (N)** list appears, scan a package, verify the list decrements.
- [ ] **Step 5:** Test a mobile viewport (e.g. 375px) — Rápido list should remain usable, collapsed by default.

---

## Non-Goals (explicit YAGNI)

- No virtualization of long lists — defer until a single dock exceeds ~200 pending.
- No search / filter input inside the list — defer until user asks.
- No bulk-select / bulk-action on rows — separate spec.
- No changes to sectorization logic, scanner behavior, or consolidation rules.
- No backend migrations or RPC changes.

---

## Risks & Mitigations

- **Schema drift** — column names assumed above (`customer_name`, `delivery_address`, `delivery_window_start/end`) and the join table (`chile_comunas(nombre)`) were verified against the latest migrations at spec time, but migrations evolve. **Mitigation:** at Task 1 implementation time, re-read the most recent `orders` migration and confirm; update this spec if corrections are needed.
- **Query weight** increases because we join `comunas` and pull more columns. **Mitigation:** query runs only on distribution pages, with 15s `staleTime`. If it degrades UX, move to an RPC with a projection.
- **Test brittleness** around React Query mocking — reuse the patterns already used in sibling `.test.tsx` files in the same directory.
