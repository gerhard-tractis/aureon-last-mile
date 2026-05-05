# spec-41 — Pending list order grouping

**Status:** backlog

## Goal

Group packages by order within the pending-packages list (`PendingDockList`) in both Modo Rápido and Modo Lote. Packages from the same order are shown together under an order header, and managers can assign all packages in an order to a dock in one click.

## Background

`PendingDockList` currently renders a flat list of packages within each zone group. When a single order has multiple packages (bultos), they are scattered throughout the list ordered only by `created_at`. Operators cannot easily see which packages belong together, making it slow to handle multi-bulto orders.

## Scope

**In scope:**
- New `OrderGroup` type grouping `PendingPackage[]` by `order_id` within each `ZoneGroup`.
- Order groups sorted by `delivery_date` ascending (most urgent first) within each zone.
- Order header row showing order number, bulto count, commune, and delivery date badge.
- Manager-only "⋯ Asignar todo" button on the order header that assigns every package in the order to the selected dock in one action.
- Per-package "⋯" button retained (unchanged behaviour).
- Extraction of `PendingDockListOrderGroup` into its own file (current `PendingDockList.tsx` is already at 320 lines).

**Out of scope:**
- Collapsible/expandable order groups.
- Any DB schema changes.
- Changes to the barcode scan flow (QuickSortScanner, BatchScanner).
- Tap-verify at the order level (verification stays per-package).

## Data model

No DB changes. All required fields (`order_id`, `orderNumber`, `delivery_date`, `comunaName`) are already fetched by `usePendingSectorization`.

### New type `OrderGroup`

```ts
// apps/frontend/src/hooks/distribution/usePendingSectorization.ts
export interface OrderGroup {
  orderId: string;
  orderNumber: string;
  deliveryDate: string;        // ISO date string, same for all packages in the order
  comunaName: string | null;
  packages: PendingPackage[];  // sorted by label ASC
}
```

### Updated `ZoneGroup`

```ts
export interface ZoneGroup {
  zone: DockZone;
  matchResult: ZoneMatchResult;
  orders: OrderGroup[];        // replaces packages: PendingPackage[]
}
```

`packages` is removed. All consumers updated accordingly.

## Component architecture

```
PendingDockList.tsx               (modified — renders OrderGroup[] per zone)
PendingDockListOrderGroup.tsx     (new — order header + indented package rows)
PendingDockList.test.tsx          (modified — updated fixture shape)
PendingDockListOrderGroup.test.tsx(new)
BatchOverview.tsx                 (modified — ZoneGroup.packages removed; update count expression)
BatchOverview.test.tsx            (modified — update fixtures from packages:[...] to orders:[...])
```

### `PendingDockList` prop additions

```ts
interface PendingDockListProps {
  groups: ZoneGroup[];
  verifiedPackageIds: Set<string>;
  onTapVerify: (packageId: string) => void;
  onManualAssign?:    (packageId:  string,   zoneId: string) => void;  // unchanged
  onManualAssignAll?: (packageIds: string[], zoneId: string) => void;  // new — order-level
  activeZones: DockZone[];
}
```

### `PendingDockListOrderGroup`

- File: `apps/frontend/src/components/distribution/PendingDockListOrderGroup.tsx`
- Props:
  ```ts
  interface PendingDockListOrderGroupProps {
    order: OrderGroup;
    zoneId: string;   // UUID of the zone (used in onManualAssignAll callback)
    zoneCode: string; // display code e.g. "A1" (shown in UI)
    verifiedPackageIds: Set<string>;
    onTapVerify: (packageId: string) => void;
    onManualAssign?:    (packageId:  string,   zoneId: string) => void;
    onManualAssignAll?: (packageIds: string[], zoneId: string) => void;
    activeZones: DockZone[];
    density: 'detallado' | 'compacto';
    today: string;
  }
  ```
- Renders an order header row followed by indented `PendingDockListRow` components.
- Order header contains:
  - `Pedido #XXXX` (monospace, blue)
  - `N bulto(s)` count
  - Delivery date badge (reuses `formatRelativeDeliveryDate` tone logic)
  - `comunaName`
  - `⋯ Asignar todo` button — visible only when `onManualAssignAll` is provided; renders as:
    ```tsx
    <ManualAssignMenu
      activeZones={activeZones}
      onSelect={(selectedZoneId) => onManualAssignAll(order.packages.map(p => p.id), selectedZoneId)}
    />
    ```
- `PendingDockListRow` components are rendered slightly indented (`pl-6`) to show hierarchy.
- `PendingDockList` threads `onManualAssignAll` down to each `PendingDockListOrderGroup` instance it renders.
- **`ManualAssignMenu` change:** Make `packageId` optional (`packageId?: string`) in `ManualAssignMenu.tsx`. The component never uses this prop internally; making it optional lets the order-header button reuse it without a package ID. Existing call sites that pass `packageId={pkg.id}` remain valid and do not need to change.
- **`data-testid` attributes:**
  - `data-testid={`order-group-${order.orderId}`}` on the section root element
  - `data-testid="assign-all-btn"` on the "Asignar todo" trigger button

## Hook contracts

### `usePendingSectorization` (modified)

The `queryFn` second pass after building `groupMap`:

```
for each ZoneGroup:
  group packages by order_id into an orderMap
  for each OrderGroup, sort packages by label ASC
  sort OrderGroups by deliveryDate ASC
  replace zone.packages with zone.orders
```

No additional DB fetch. Pure in-memory transformation.

### Pages

Both `quicksort/page.tsx` and `batch/[batchId]/page.tsx` add:

```ts
const onManualAssignAll = manualAssign.canUse
  ? async (packageIds: string[], zoneId: string) => {
      const target = (zones ?? []).find(z => z.id === zoneId);
      // mutateAsync calls are all started before any settles (parallel, independent)
      // Promise.allSettled ensures every mutation is awaited, even if one rejects,
      // avoiding a race with query invalidation that fires in each onSuccess handler.
      await Promise.allSettled(
        packageIds.map(packageId =>
          manualAssign.mutateAsync({
            packageId,
            zoneId,
            barcode: packageId, // consistent with existing onManualAssign pattern
            isConsolidation: !!target?.is_consolidation,
          })
        )
      );
    }
  : undefined;
```

`Promise.allSettled` (not `Promise.all`) ensures all mutations are awaited to completion regardless of individual failures; no try/catch is needed because `allSettled` never rejects. Each failed mutation fires `useManualDockAssignment.onError`'s Sonner toast independently.

> Note: `(zones ?? [])` is required in `batch/[batchId]/page.tsx` because `zones` is `DockZone[] | undefined` at that scope and is not covered by the early-return guard. In `quicksort/page.tsx`, `zones` is already guarded, but the `?? []` form is safe there too and should be used for consistency.
> `mutateAsync` is available on the `useManualDockAssignment` return value via the `...mutation` spread (standard TanStack Query `useMutation` return shape).

Passed as `onManualAssignAll` to `<PendingDockList>`.

## Permission rules

| Control | `WAREHOUSE_STAFF` | `OPERATIONS_MANAGER` / `ADMIN` |
|---|---|---|
| Order header (visual grouper) | ✓ visible | ✓ visible |
| `⋯ Asignar todo` on order header | ✗ hidden | ✓ |
| `⋯` on package row | ✗ hidden | ✓ (unchanged) |

## Testing (TDD)

### `usePendingSectorization` (modified tests)

- Returns `orders: OrderGroup[]` within each `ZoneGroup` — no `packages` field.
- Packages from the same `order_id` are grouped under one `OrderGroup`.
- `OrderGroup.packages` sorted by `label` ASC.
- `ZoneGroup.orders` sorted by `deliveryDate` ASC (most urgent first).
- Packages from different orders in the same zone each get their own `OrderGroup`.

### `PendingDockListOrderGroup.test.tsx` (new)

- Renders order number, bulto count, commune, date badge.
- `⋯ Asignar todo` button absent when `onManualAssignAll` is `undefined`.
- `⋯ Asignar todo` button present when `onManualAssignAll` is provided.
- Selecting a zone in the "Asignar todo" menu calls `onManualAssignAll` with all package IDs in the order and the selected zone ID.
- Each package row's `⋯` calls `onManualAssign` with that package's ID only.

### `PendingDockList.test.tsx` (modified)

- Update fixture from `packages: PendingPackage[]` to `orders: OrderGroup[]`. Minimal fixture shape:
  ```ts
  const baseGroup: ZoneGroup = {
    zone: { id: 'zone-a', code: 'A1', name: 'Andén A', ... },
    matchResult: 'matched',
    orders: [
      {
        orderId: 'order-1', orderNumber: '1001',
        deliveryDate: '2026-05-05', comunaName: 'La Florida',
        packages: [
          { id: 'pkg-1', label: 'PKG-0041', order_id: 'order-1', ... },
          { id: 'pkg-2', label: 'PKG-0042', order_id: 'order-1', ... },
        ],
      },
      {
        orderId: 'order-2', orderNumber: '1002',
        deliveryDate: '2026-05-06', comunaName: 'Maipú',
        packages: [{ id: 'pkg-3', label: 'PKG-0055', order_id: 'order-2', ... }],
      },
    ],
  };
  ```
- Grouping renders one order header (`data-testid="order-group-order-1"` etc.) per distinct `orderId`.
- The existing `data-testid="pending-rows-zone-a"` wrapper (on the `PendingDockListGroup` `<ul>`) is removed along with `PendingDockListGroup`; update or remove test assertions that reference it.
- Existing tap-verify and density tests pass unchanged.

### `onManualAssignAll` partial-failure test (pages)

Add to each page's test file (quicksort and batch):
- Stub `mutateAsync` so the first call resolves and the second rejects.
- Call `onManualAssignAll(['pkg-a', 'pkg-b'], 'zone-1')`.
- Verify: both mutations were called (`mutateAsync` invoked twice), the function resolves without throwing (`Promise.allSettled` guarantees this), and `toast.error` was fired once for the failed mutation (from the hook's own `onError`).

## Implementation plan

### Step 1 — Data layer
- Write failing tests for `usePendingSectorization` (order grouping shape).
- Add `OrderGroup` interface; update `ZoneGroup`; update `queryFn` second pass.
- Update `batch/[batchId]/page.tsx` filter (uses `g.zone.id`; no change needed beyond type update).

### Step 2 — `PendingDockListOrderGroup` component
- Write failing tests.
- Implement `PendingDockListOrderGroup.tsx`.

### Step 3 — `PendingDockList` wiring + `BatchOverview`
- Update `PendingDockList.tsx` to render `group.orders` via `PendingDockListOrderGroup` (replacing the existing `PendingDockListGroup` internal component, which accesses `group.packages` and must be removed entirely).
- Pass both `zoneId={group.zone.id}` and `zoneCode={group.zone.code}` to `PendingDockListOrderGroup`.
- Add `onManualAssignAll` prop.
- Update the zone package-count label from `group.packages.length` to `group.orders.reduce((n, o) => n + o.packages.length, 0)`.
- Update `BatchOverview.tsx`: destructure `{ zone, orders }` instead of `{ zone, packages }`; replace `packages.length` with `orders.reduce((n, o) => n + o.packages.length, 0)`.
- Update existing `PendingDockList.test.tsx` fixtures.
- Update `BatchOverview.test.tsx` fixtures from `packages: [...]` to `orders: [...]`.

### Step 4 — Pages
- Add `onManualAssignAll` to `quicksort/page.tsx` and `batch/[batchId]/page.tsx`.
