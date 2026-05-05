# spec-42 — Order Inspector

**Status:** backlog

## Goal

Give ops managers a single keyboard-summoned view of any order or package by ID, showing the order's full lifecycle on top of whatever page they were already on. Type `/`, type the ID, hit enter — a right-edge inspector slides in over the current page with the order's complete story (header, lifecycle ribbon, packages, events, route).

## Background

There is currently no way to look up an order or package by ID. To find one, an ops manager has to navigate to the relevant module (Pickup / Reception / Distribution / Dispatch) and scan a list. There is also no single place that shows an order's full history — the data is spread across `manifests`, `pickup_scans`, `hub_receptions`, `reception_scans`, `dock_scans`, `dispatches`, `routes`, and `delivery_attempts`. Ops managers ask "where is this order right now?" several times a day; today the answer requires multiple page hops.

This spec adds (a) a global keyboard-driven palette to look up orders and packages, and (b) a right-edge inspector drawer that slides over the current page with a unified, chronological view of the order's lifecycle.

## Scope

**In scope:**
- Global hotkey: `/` and `Ctrl/Cmd+K` open a palette modal from any page in `/app/*`.
- Palette searches `orders.order_number`, `packages.label`, and full UUIDs (`orders.id`, `packages.id`). Operator-scoped. Top 8 results, debounced 200 ms.
- Selecting a result opens the right-edge inspector. Searching by package opens the parent order with the package highlighted in the Paquetes tab.
- Right-edge inspector drawer: 640 px wide on `lg+`, full-width on `md` and below. Esc to close. Body scroll-locked while open.
- Inspector sections: header (ID + status + customer + chips), vertical lifecycle ribbon with timestamps and actors, failed-attempt branch cards, and a tab strip (Resumen / Paquetes / Eventos / Ruta).
- New RPC `get_order_inspector_snapshot(p_operator_id uuid, p_order_id uuid)` returns the entire payload in one round trip.
- New RPC `search_orders_packages(p_operator_id uuid, p_query text, p_limit int)` returns ranked results.
- A keyboard pill in the existing top header that triggers the palette.
- Permission: any role with `dashboard` access can use the inspector. Drivers (`pickup_crew`, `loading_crew`) — who don't see the desktop sidebar today — get nothing new.

**Out of scope:**
- Mutations from the inspector (reassign, cancel, edit). Action buttons in the footer are placeholders that link out to existing flows.
- URL-based deep-linking (`?inspect=<orderId>`). Deferred to follow-up.
- Mobile-specific UX (the inspector falls back to full-width drawer on small viewports; deep mobile polish is a later spec).
- Driver/customer-facing visibility — this is an internal ops tool.

## Data model

No new tables. One new RPC pair, one new index migration.

### `get_order_inspector_snapshot` — payload

Returned as `jsonb` with this shape (TypeScript mirror):

```ts
export interface OrderInspectorSnapshot {
  order: {
    id: string;
    operator_id: string;
    order_number: string;
    customer_name: string;
    customer_phone: string;
    delivery_address: string;
    comuna: string;
    delivery_date: string;          // ISO date
    delivery_window_start: string | null;
    delivery_window_end: string | null;
    retailer_name: string | null;
    imported_via: 'API' | 'EMAIL' | 'MANUAL' | 'CSV';
    imported_at: string;
    created_at: string;
  };
  packages: Array<{
    id: string;
    label: string;
    package_number: string | null;
    status: PackageStatus;
    status_updated_at: string | null;
    declared_weight_kg: number | null;
    declared_dimensions: { l: number; w: number; h: number } | null;
    dock_zone: { id: string; name: string; code: string } | null;
  }>;
  manifest: {
    id: string;
    external_load_id: string;
    pickup_location: string | null;
    started_at: string | null;
    completed_at: string | null;
  } | null;
  reception: {
    id: string;
    started_at: string | null;
    completed_at: string | null;
    received_by: { id: string; full_name: string } | null;
    expected_count: number;
    received_count: number;
  } | null;
  route: {
    id: string;
    external_route_id: string;
    driver_name: string | null;
    vehicle_plate: string | null;
    status: RouteStatus;
    planned_stops: number | null;
    completed_stops: number;
  } | null;
  current_dispatch: {
    id: string;
    status: DispatchStatus;
    planned_sequence: number | null;
    estimated_at: string | null;
    arrived_at: string | null;
    completed_at: string | null;
  } | null;
  failed_attempts: Array<{
    id: string;
    attempt_number: number;
    failure_reason: string | null;
    attempted_at: string;
    driver: { id: string; full_name: string } | null;
  }>;
  events: Array<{
    kind: 'pickup_scan' | 'reception_scan' | 'dock_scan' | 'status_change' | 'dispatch';
    occurred_at: string;
    actor: { id: string; full_name: string } | null;
    package_label: string | null;
    detail: string;                  // human-readable, Spanish, server-formatted
  }>;
  generated_at: string;
}
```

`events` is capped at 50 most-recent rows for performance; older events surfaceable via a future "ver más" action.

### `search_orders_packages` — return type

```ts
export interface OrderSearchHit {
  entity_type: 'order' | 'package';
  order_id: string;                  // for packages, the parent order
  order_number: string;
  package_id: string | null;         // null when entity_type='order'
  package_label: string | null;
  customer_name: string;
  comuna: string;
  status: string;                    // package status if hit was a package; else aggregated order status
  match_field: 'order_number' | 'package_label' | 'order_id' | 'package_id';
}
```

Scoring: exact UUID match > exact prefix on `order_number` / `label` > trigram similarity. Limit 8. Operator-scoped.

### Migrations

```
supabase/migrations/<timestamp>_order_inspector.sql
```

Adds:
- `pg_trgm` extension if not already enabled.
- GIN trigram indexes on `orders.order_number` and `packages.label` (operator-scoped via partial index where appropriate).
- The two RPC functions, both `SECURITY DEFINER` with `operator_id` enforced from the argument and validated against `auth.uid()`'s operator (matches existing `get_ops_control_snapshot` pattern).
- Verify FK indexes exist for snapshot performance: `dispatches(order_id)`, `delivery_attempts(order_id)`, `packages(order_id)`, `pickup_scans(package_id)`, `reception_scans(package_id)`, `dock_scans(package_id)`. Add any missing.

## Stage derivation

The lifecycle ribbon shows up to nine stages, each derived purely from the snapshot. The mapping is implemented in `inspectorStages.ts` as a pure function `deriveStages(snapshot): Stage[]`.

| # | Stage | Reached when | Timestamp | Actor |
|---|---|---|---|---|
| 1 | Importado | always (orders.id exists) | `order.imported_at` | `imported_via` literal |
| 2 | Pickup | any pickup_scan exists OR `manifest.completed_at` set | latest pickup_scan / `manifest.completed_at` | latest pickup_scan's user; manifest external_load_id as detail |
| 3 | Recepción | `reception.completed_at` set OR all packages have a `reception_scan` with `received` | `reception.completed_at` | `reception.received_by` |
| 4 | Sectorizado | every package has `dock_zone_id` OR all package statuses ≥ `sectorizado` | latest `packages.status_updated_at` where status crossed into `sectorizado` | dock_scans actor if available; else null |
| 5 | Asignado a ruta | `route` is not null AND `current_dispatch` exists | `current_dispatch.created_at` | `route.driver_name` + route external id |
| 6 | En carga | any package status in `en_carga` / `listo_para_despacho` | latest `status_updated_at` for those statuses | null |
| 7 | En ruta | `current_dispatch.status='pending'` AND `route.status='in_progress'` — OR — any package status `en_ruta` | `route` start time, falling back to `current_dispatch` updated_at | `route.driver_name` + parada N de M + ETA |
| 8 | Entregado | `current_dispatch.status='delivered'` AND `current_dispatch.completed_at` not null | `current_dispatch.completed_at` | driver + delivery_attempts winner |
| 9 | Cancelado / Devuelto | terminal package status `cancelado` / `devuelto` / `extraviado` / `dañado` | latest `status_updated_at` | null — only rendered when reached |

Each stage is in one of three states: `done` (filled circle, timestamp present), `now` (pulsing accent ring, timestamp + arrow), `pending` (hollow circle, "— pendiente"). Exactly one stage is `now`; if the order has reached terminal `Entregado`, none is `now`. The `Cancelado / Devuelto` stage replaces stages 6–8 when reached early — a single stage rendered with `pill-error`.

`failed_attempts` are rendered as branch cards interleaved between stages, anchored chronologically by `attempted_at`.

## Component architecture

All new component files live under `apps/frontend/src/components/order-inspector/`. Each file under 300 lines per the project rule.

```
apps/frontend/src/components/order-inspector/
  OrderInspectorPalette.tsx            (palette modal — Cmd+K / "/")
  OrderInspectorPalette.test.tsx
  OrderInspectorDrawer.tsx             (right-edge slide-in shell)
  OrderInspectorDrawer.test.tsx
  InspectorHeader.tsx                  (ID + status pill + customer + chips)
  InspectorHeader.test.tsx
  LifecycleRibbon.tsx                  (vertical timeline rendering Stage[])
  LifecycleRibbon.test.tsx
  RibbonStage.tsx                      (single stage node — done/now/pending)
  FailedAttemptBranch.tsx              (red branch card)
  InspectorTabs.tsx                    (tab strip + body switcher)
  PackagesTab.tsx
  EventsTab.tsx
  RouteTab.tsx
  inspectorStages.ts                   (pure deriveStages + status helpers)
  inspectorStages.test.ts
  index.ts                             (barrel export)
```

Hooks:

```
apps/frontend/src/hooks/order-inspector/
  useOrderInspector.ts                 (TanStack Query: get_order_inspector_snapshot)
  useOrderInspector.test.ts
  useOrderSearch.ts                    (TanStack Query: search_orders_packages, debounced)
  useOrderSearch.test.ts
  useOrderInspectorHotkey.ts           ("/" and Ctrl/Cmd+K listener — ignores when focus in input)
  useOrderInspectorHotkey.test.ts
```

Store:

```
apps/frontend/src/lib/stores/
  useOrderInspectorStore.ts            (Zustand: { openOrderId, highlightedPackageId, isPaletteOpen })
  useOrderInspectorStore.test.ts
```

Mounted once at `AppLayout`:

```tsx
// AppLayout.tsx (modification)
<TooltipProvider>
  {/* …existing layout… */}
  <main>{children}</main>
  <OrderInspectorPalette />     {/* portal'd modal */}
  <OrderInspectorDrawer />      {/* portal'd right-edge drawer */}
</TooltipProvider>
```

Plus `useOrderInspectorHotkey()` is invoked once inside `AppLayout`, and the existing top-right area gains a button that opens the palette.

### `OrderInspectorPalette` props

No props — reads `isPaletteOpen` and actions from `useOrderInspectorStore`. Uses `Dialog` from shadcn/ui for the modal shell. Search input wired to `useOrderSearch`. Result list rendered with `Command` from `cmdk` (already a shadcn dependency). Selecting a result calls `setOpenOrderId(hit.order_id, hit.package_id)` then closes the palette.

### `OrderInspectorDrawer` props

No props — reads `openOrderId` from store. Uses shadcn `Sheet` with `side="right"` and a custom `className="w-full sm:max-w-[640px]"`. Internally renders `<InspectorHeader />`, `<LifecycleRibbon />`, `<InspectorTabs />`. Closes via Esc, overlay click, or footer cancel — all dispatch `close()` which clears `openOrderId`. Loading state: skeleton header + skeleton ribbon. Error state: inline alert with retry; if RPC returns `not_found`, render an empty-state message and stay open.

### `LifecycleRibbon` props

```ts
interface LifecycleRibbonProps {
  stages: Stage[];                   // from deriveStages(snapshot)
  failedAttempts: FailedAttempt[];   // from snapshot.failed_attempts
}
```

Renders the vertical line, all stage nodes, branch cards interleaved by `attempted_at`, and the gradient fill clip computed from the position of the `now` (or terminal) stage.

### `RibbonStage` props

```ts
interface RibbonStageProps {
  stage: Stage;                      // { kind, name, state: 'done'|'now'|'pending', occurredAt, actor, detail }
}
```

Pure presentational. State drives the circle styling and timestamp formatting.

### `InspectorTabs` props

```ts
interface InspectorTabsProps {
  snapshot: OrderInspectorSnapshot;
  highlightedPackageId: string | null;
}
```

Tab IDs: `resumen` | `paquetes` | `eventos` | `ruta`. Default tab is `resumen` unless `highlightedPackageId` is set, in which case it opens on `paquetes` and scrolls the highlighted row into view (using `scrollIntoView({ block: 'center' })` on mount).

## Hook contracts

### `useOrderInspector(orderId: string | null)`

```ts
{ data: OrderInspectorSnapshot | undefined, isLoading, isError, refetch }
```

- Disabled when `orderId` is null.
- `staleTime: 30_000`, `refetchInterval: 60_000` (matches project caching rules in `docs/architecture.md`).
- Calls Supabase RPC `get_order_inspector_snapshot` with `p_operator_id` from `useOperatorId()`.
- Realtime: subscribes to `dispatches` and `packages` rows where `order_id = orderId` (Supabase Realtime channel) and invalidates the query on any UPDATE so timestamps reflect live changes.

### `useOrderSearch(query: string)`

```ts
{ hits: OrderSearchHit[], isLoading }
```

- 200 ms debounce; query disabled when input length < 2.
- Operator-scoped via `useOperatorId()`.
- `staleTime: 10_000`. No refetchInterval (one-shot per query).

### `useOrderInspectorHotkey()`

- Listens at `document` level for `keydown`.
- Triggers palette open on `/` (no modifier) and `Ctrl/Cmd+K`.
- **Suppresses** when the active element is an `<input>`, `<textarea>`, `[contenteditable]`, or has `data-no-inspector-hotkey`. This prevents stomping on form input.
- Closes palette/drawer on `Escape` (drawer takes priority if both open).

### `useOrderInspectorStore` (Zustand)

```ts
interface OrderInspectorState {
  isPaletteOpen: boolean;
  openOrderId: string | null;
  highlightedPackageId: string | null;
  openPalette: () => void;
  closePalette: () => void;
  openOrder: (orderId: string, highlightedPackageId?: string | null) => void;
  close: () => void;                       // closes drawer (palette stays untouched)
}
```

## Permission rules

| Role | Palette + drawer |
|---|---|
| `admin` | ✓ |
| `operations_manager` | ✓ |
| `warehouse_staff` | ✓ |
| `pickup_crew`, `loading_crew` | ✗ (mobile-first roles, not the audience) |

The hotkey hook and the header pill are gated by `role !== 'pickup_crew' && role !== 'loading_crew'`. Server side, both RPCs filter by `operator_id` from `auth.uid()` and reject calls from any operator other than the authenticated user's. RLS on the underlying tables already enforces this.

## Testing (TDD)

### `inspectorStages.test.ts`

- Pure-function tests on `deriveStages(snapshot)`:
  - Snapshot with only `order` → stages 1 done, rest pending.
  - Snapshot with manifest completed but no reception → stages 1–2 done, 3+ pending.
  - Snapshot with a current dispatch in `pending` and route `in_progress` → stage 7 is `now`.
  - Snapshot with `current_dispatch.status='delivered'` → stage 8 done, none `now`.
  - Snapshot with all packages `cancelado` → stage 9 (Cancelado) done, stages 6–8 hidden.
  - `failedAttempts` interleave correctly between stages by `attempted_at`.

### `useOrderSearch.test.ts`

- Returns no hits when query is empty or < 2 chars.
- Debounce: types `O`, then `R`, then `D` within 100 ms — only one RPC call after 200 ms idle.
- Returns hits sorted by score (UUID exact > prefix > trigram).

### `useOrderInspectorHotkey.test.ts`

- Pressing `/` opens palette.
- Pressing `Ctrl+K` opens palette.
- Pressing `/` while focused inside an `<input>` does NOT open palette.
- Pressing `Escape` closes drawer when drawer is open.
- Pressing `Escape` closes palette when only palette is open.

### `OrderInspectorPalette.test.tsx`

- Renders nothing when `isPaletteOpen` is false.
- Renders modal with input when open.
- Typing populates results from `useOrderSearch`.
- Clicking a result calls `openOrder` with correct `orderId` and `package_id` (when hit is a package).
- Clicking a package result sets `highlightedPackageId` and switches focus to drawer.

### `OrderInspectorDrawer.test.tsx`

- Renders nothing when `openOrderId` is null.
- Renders skeleton when loading.
- Renders error state with retry when RPC errors.
- Renders not-found state when RPC returns 404 shape.
- Esc keypress dispatches `close()`.
- Renders header, ribbon, tabs once data loads.

### `LifecycleRibbon.test.tsx`

- Renders one node per stage in `Stage[]`.
- Pulsing class applied only to the `now` stage.
- Branch cards rendered between stages by `attempted_at`.
- Ribbon-fill height matches percentage to `now` stage position.

### `RibbonStage.test.tsx`

- `done` → filled circle + formatted timestamp.
- `now` → pulsing accent + "→" suffix on timestamp.
- `pending` → hollow circle + "— pendiente" placeholder.

### `InspectorTabs.test.tsx`

- Default open tab is `resumen` when `highlightedPackageId` is null.
- Default open tab is `paquetes` when `highlightedPackageId` is set, and that row gets `scrollIntoView`.
- Switching tabs swaps body without re-fetching.

### Integration: `AppLayout` + inspector

- New `AppLayout` test mounts the layout, fires `keydown /`, asserts palette opens.
- Asserts palette + drawer mount as portals (don't disturb existing children).

### RPC tests

- `get_order_inspector_snapshot.test.sql` (pgTAP-style or vitest harness already used by spec-37):
  - Returns full snapshot for a known seeded order.
  - Returns `not_found` shape for an unknown UUID.
  - Returns nothing across operators (operator isolation).
- `search_orders_packages.test.sql`:
  - Exact UUID match returns single high-scored hit.
  - Prefix on `order_number` returns expected ordering.
  - Operator isolation enforced.

## Implementation plan

### Step 1 — Migrations and RPCs
- Write failing pgTAP tests for both RPCs.
- Add `<timestamp>_order_inspector.sql` migration: trigram extension, indexes, both functions.
- Confirm `supabase db reset` / migration runs locally in green.

### Step 2 — `inspectorStages.ts` (pure)
- Write failing tests covering all stage transitions.
- Implement `deriveStages(snapshot)`.

### Step 3 — `useOrderInspectorStore` and hotkey
- Write tests for store + hotkey hook.
- Implement Zustand store and `useOrderInspectorHotkey`.

### Step 4 — Search
- Write tests for `useOrderSearch`.
- Implement hook calling the RPC.
- Implement `OrderInspectorPalette` with `cmdk`.

### Step 5 — Snapshot fetcher and drawer shell
- Write tests for `useOrderInspector`.
- Implement hook with TanStack Query + Realtime invalidation.
- Implement `OrderInspectorDrawer` shell (loading, error, not-found, success → renders children).

### Step 6 — Inspector internals
- Implement `InspectorHeader`, `LifecycleRibbon`, `RibbonStage`, `FailedAttemptBranch` per tests.

### Step 7 — Tabs and bodies
- Implement `InspectorTabs`, `PackagesTab`, `EventsTab`, `RouteTab` per tests. `Resumen` tab reuses content already in the header + ribbon — its body shows just a couple of placeholder action buttons that link out to existing flows (open route, open manifest).

### Step 8 — `AppLayout` integration
- Add palette pill button in the header (matches the `palette-pill` style from the mockup, gated by role).
- Mount `<OrderInspectorPalette />` and `<OrderInspectorDrawer />` once at `AppLayout`.
- Invoke `useOrderInspectorHotkey()` once at `AppLayout`.
- Update `AppLayout.test.tsx` for the new mounted nodes and hotkey behavior.

### Step 9 — E2E
- Playwright spec at `apps/frontend/e2e/order-inspector.spec.ts`:
  - Log in as ops manager.
  - Press `/`, type a known order number, press Enter.
  - Assert drawer opens with that order's header.
  - Click Paquetes tab; assert package list rendered.
  - Press Esc; assert drawer closes.

## Visual reference

The aesthetic mockup that drove this spec lives at `.superpowers/brainstorm/1909-1777999834/content/inspector-v2.html`. It uses the project's actual tokens (warm-dark palette, gold accent, Fraunces + Geist + IBM Plex Mono) and shows the right-edge inspector with the lifecycle ribbon, a failed-attempt branch, the chips row, and the tab strip. Implementation should match its visual structure; theme tokens come from `globals.css` so light mode auto-derives.
