# spec-39 — Distribution pending list & binary destination scan

**Status:** in progress

## Goal

Add a pending-packages list panel inside the two distribution scan screens (Modo Lote and Modo Rápido) and let the operator decide per-package between the auto-suggested anden and consolidación at scan time. Verification of packages is allowed via either scan or list-tap; final assignment to a destination remains scan-bound for users with the `distribution` permission, with a UI fallback restricted to managers.

## Background

The current Distribution scan screens are scanner-only:

- `apps/frontend/src/app/app/distribution/quicksort/page.tsx` renders only `QuickSortScanner` inside a `max-w-lg` container — wide screens have empty space and the operator has no visibility of which packages are pending.
- `apps/frontend/src/app/app/distribution/batch/[batchId]/page.tsx` renders `BatchScanner` plus the *post-scan* `BatchDetailList` (already-scanned packages) but never shows the *pending* set for the batch.

Two further limitations of the current behaviour:

1. **Forced destination.** `QuickSortScanner.handleAndenScan` rejects any code that doesn't match `destination.zone_code` — there is no way to redirect a package to consolidación when the dock fills up. `BatchScanner` similarly has no consolidación escape.
2. **Single-mode interaction.** Operators can only scan; tapping a row to mark eyes-on is impossible despite Reception/Pickup using exactly that pattern.

Operators need (a) visibility of the pending pile, (b) a verification step analogous to Reception/Pickup, and (c) the ability to redirect a package to consolidación at the destination scan when their primary dock is full.

## Scope

**In scope:**
- New `dock_verifications` table, RLS, hook, mutation, realtime channel.
- New `PendingDockList` component shared by both modes.
- New `ManualAssignMenu` component (manager-only fallback).
- Modifications to `QuickSortScanner` to drop the rigid match check and add binary destination validation (suggested anden OR consolidación).
- Modifications to `BatchScanner` page to accept a consolidación scan as a redirect of the most recent accepted package.
- Two new columns on `dock_scans`: `redirect_reason`, `manual_override`.
- Layout switch on both scan screens to a two-pane grid (`scanner | pending-list`).
- New explicit error message for incorrect dock scans.

**Out of scope:**
- Changes to the consolidación release flow (`useReleaseFromConsolidation` is untouched).
- Changes to `BatchOverview` (the zone-picker grid that runs *before* a batch is created).
- KPI changes on the main Distribution page.
- Changes to dock zone settings or comuna→zone mapping.
- Modo Lote auto-creation of batches via package scan (Quicksort already does this; Lote stays user-initiated).

## User stories

1. **Visibility (warehouse staff):** As a Distribución operator, I open Modo Rápido and immediately see the list of packages pending sectorisation grouped by suggested zone, so I can plan which dock to load next.
2. **Tap-verify (warehouse staff):** As a Distribución operator without a working scanner, I can tap a row in the pending list to mark a package as verified (eyes-on), the same way Reception/Pickup work, but without committing it to a destination.
3. **Consolidación redirect (warehouse staff):** As a Distribución operator, when the auto-suggested anden is full I can scan the consolidación zone code as the destination and the package is recorded with `redirect_reason = 'manual_consolidation'`.
4. **Wrong-dock feedback (warehouse staff):** As a Distribución operator, if I scan a dock that is neither the suggested one nor consolidación, I see an explicit error message — `"Asignación fallida: andén incorrecto. Esperado [Anden X] o Consolidación."` — and the scan input refocuses for retry.
5. **Manager UI fallback (operations manager / admin):** When the scanner is broken I can open a per-row `⋯` menu in the pending list, pick a destination zone (any anden or consolidación), and the assignment is recorded with `manual_override = true` for audit.
6. **Modo Lote redirect (warehouse staff):** While running a Lote for Anden A, if Anden A fills mid-batch I can scan the consolidación zone code; the most recently accepted package is moved out of the batch into consolidación, the batch's accepted total decrements, and the redirect is logged.

## Data model

### New table `dock_verifications`

Mirrors the Reception/Pickup verification pattern.

```sql
create table public.dock_verifications (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id),
  package_id uuid not null references public.packages(id),
  verified_by uuid not null references public.users(id),
  verified_at timestamptz not null default now(),
  source text not null check (source in ('scan', 'tap')),
  deleted_at timestamptz
);

create unique index dock_verifications_unique_active
  on public.dock_verifications (operator_id, package_id)
  where deleted_at is null;

create index dock_verifications_operator_date_idx
  on public.dock_verifications (operator_id, verified_at desc)
  where deleted_at is null;

alter table public.dock_verifications enable row level security;

create policy "dock_verifications operator isolation"
  on public.dock_verifications
  for all
  using (operator_id = (auth.jwt() -> 'app_metadata' ->> 'operator_id')::uuid)
  with check (operator_id = (auth.jwt() -> 'app_metadata' ->> 'operator_id')::uuid);

alter publication supabase_realtime add table public.dock_verifications;
```

Soft delete only (`deleted_at`), per architecture rules. Re-verifying a package is idempotent: insert with `on conflict (operator_id, package_id) where deleted_at is null do nothing`.

### `dock_scans` additions

```sql
alter table public.dock_scans
  add column redirect_reason text,
  add column manual_override boolean not null default false;

alter table public.dock_scans
  add constraint dock_scans_redirect_reason_chk
  check (redirect_reason is null or redirect_reason in ('manual_consolidation'));
```

Both columns are additive and backward-compatible.

### `packages.status` flow

No changes. Verification is its own table; assignment continues through `dock_scans` and existing status transitions on `packages`.

## Component architecture

```
distribution
├── PendingDockList              (new, shared)
│   ├── PendingDockListGroup     (new, internal — one per suggested zone)
│   └── ManualAssignMenu         (new, manager-only)
├── QuickSortScanner             (modified — drop strict match, add binary validation)
├── BatchScanner                 (unchanged surface; page wires new behaviour)
├── BatchDetailList              (unchanged)
└── BatchOverview                (unchanged — out of scope)

hooks/distribution
├── useDockVerifications         (new)
├── useDockVerificationMutation  (new)
├── useManualDockAssignment      (new — manager-only)
└── usePendingSectorization      (modified — also returns flat list view, exposes `verified` per package)

lib/distribution
└── dock-scan-validator          (modified — add binary destination rule + incorrect-dock message)
```

### `PendingDockList`

- File: `apps/frontend/src/components/distribution/PendingDockList.tsx`
- Props:
  ```ts
  interface PendingDockListProps {
    groups: ZoneGroup[];                       // from usePendingSectorization
    verifiedPackageIds: Set<string>;           // from useDockVerifications (today)
    onTapVerify: (packageId: string) => void;  // calls useDockVerificationMutation
    onManualAssign?: (packageId: string, zoneId: string) => void; // manager-only
    activeZones: DockZone[];                   // for ManualAssignMenu options
  }
  ```
- Renders one `PendingDockListGroup` per suggested zone. Each row shows: package label (mono), order number, comuna, "Sugerido: [zone code]" badge, ✓ verified indicator (when in `verifiedPackageIds`).
- When `onManualAssign` is provided, each row gets a `⋯` button that opens `ManualAssignMenu`.
- Tapping the row body (not the menu) calls `onTapVerify`. Tapping a row that is already verified is a no-op (idempotent).
- Empty state: "No hay paquetes pendientes en este momento."
- Target ≤ 200 lines (extract `PendingDockListGroup` if needed to stay under 300).

### `ManualAssignMenu`

- File: `apps/frontend/src/components/distribution/ManualAssignMenu.tsx`
- Props: `{ packageId, activeZones, onSelect: (zoneId) => void }`.
- Uses the existing `DropdownMenu` shadcn primitive.
- Lists every active zone (andens first, consolidación last with a separator). Selecting a zone calls `onSelect`. Visible only when caller passes `onManualAssign`.

### `QuickSortScanner` modifications

- Remove the `scannedCode.trim().toUpperCase() !== destination.zone_code.toUpperCase()` guard in `handleAndenScan`.
- Replace with `validateDockDestination(scannedCode, { suggestedZone, allZones })` which returns one of:
  - `{ kind: 'accepted_suggested' }`
  - `{ kind: 'accepted_consolidation', zoneId }`
  - `{ kind: 'rejected_wrong_dock', expectedCode }`
- On `rejected_wrong_dock`, set `error` to `"Asignación fallida: andén incorrecto. Esperado ${expectedCode} o Consolidación."`, play `not_found` audio, refocus input.
- On `accepted_consolidation`, call `useDockScanMutation` against the consolidación zone id with `redirect_reason: 'manual_consolidation'`.
- Layout: wrap the existing scanner JSX in a two-column grid; mount `PendingDockList` in the right column. Mobile (`< lg`) stacks vertically.

### `BatchScanner` page modifications

- File: `apps/frontend/src/app/app/distribution/batch/[batchId]/page.tsx`
- After each `scanMutation` accept, store the most recent `package_id` in local state (`lastAcceptedPackageId`).
- Detect a consolidación scan: if the scanned barcode matches a `dock_zones` row with `is_consolidation = true`, call a new mutation `useRedirectBatchScanToConsolidation({ scanId, packageId, consolidationZoneId })` which updates the existing `dock_scans` row's `redirect_reason` and `dock_zone_id`. Decrements the accepted count via the existing query invalidation.
- Add the "incorrect dock" rejection: when scanned barcode matches an active dock zone code that is *not* this batch's zone and not consolidación, show `"Asignación fallida: andén incorrecto. Esperado ${batchZoneCode} o Consolidación."`.
- Layout: same two-column grid. `PendingDockList` filtered to packages whose suggested zone matches `batch.dock_zone_id`. Already-scanned `BatchDetailList` stays in the left column under the scanner.

### `dock-scan-validator`

- File: `apps/frontend/src/lib/distribution/dock-scan-validator.ts`
- Add `validateDockDestination` exported pure function:
  ```ts
  type DestinationOutcome =
    | { kind: 'accepted_suggested' }
    | { kind: 'accepted_consolidation'; zoneId: string }
    | { kind: 'rejected_wrong_dock'; expectedCode: string };

  function validateDockDestination(
    scannedCode: string,
    ctx: { suggestedZoneCode: string; zones: DockZone[] }
  ): DestinationOutcome
  ```

## Hook contracts

### `useDockVerifications(operatorId, dateISO)`

- Query key: `['distribution', 'dock-verifications', operatorId, dateISO]`.
- Returns `Set<string>` of `package_id`s verified on the given local date.
- Subscribes to realtime `dock_verifications` channel scoped by `operator_id`; on insert/update/delete it invalidates the query.

### `useDockVerificationMutation(operatorId, userId)`

- `mutateAsync({ packageId, source: 'scan' | 'tap' })`.
- Performs upsert with `on conflict do nothing` so taps and scans are idempotent.
- On success invalidates the verifications query.

### `useManualDockAssignment(operatorId, userId)`

- Reads `useGlobal().user.role`; exposes `canUse: boolean` (true only for `OPERATIONS_MANAGER` and `ADMIN`).
- `mutateAsync({ packageId, zoneId, reason })`:
  - Inserts a `dock_scans` row with `manual_override = true`.
  - If `zoneId` is consolidación → also sets `redirect_reason = 'manual_consolidation'`.
  - Triggers the same downstream package status transitions as a scanned assignment (reuses the existing RPC/path).
- Invalidates `dock-zones` sectorized counts, `pending-sectorization`, and the consolidación list.

## Permission rules

| Action | `WAREHOUSE_STAFF` (`distribution` perm) | `OPERATIONS_MANAGER` / `ADMIN` |
|---|---|---|
| Scan package or tap row to verify | ✓ | ✓ |
| Scan dock or consolidación to assign | ✓ | ✓ |
| `⋯` menu → "Asignar manualmente" | ✗ (hidden) | ✓ (`manual_override = true`) |

`PendingDockList` chooses whether to pass `onManualAssign` based on `useGlobal().user.role`.

## Error / feedback table

| Situation | Message | Audio | Effect |
|---|---|---|---|
| Scan a dock that is the suggested zone | (success banner) | `verified` | Assignment recorded |
| Scan consolidación on any package | (success banner) "Redirigido a Consolidación" | `verified` | Assignment recorded with `redirect_reason = 'manual_consolidation'` |
| Scan a dock that is not suggested and not consolidación | `"Asignación fallida: andén incorrecto. Esperado [Anden X] o Consolidación."` | `not_found` | No write; input refocuses |
| Scan an unknown code | `"Código no encontrado"` | `not_found` | No write; input refocuses |
| Tap a verified row | (no-op) | none | No-op |
| Tap an unverified row | (✓ appears) | `verified` | Verification row created |
| Manager picks zone in `⋯` menu | (success toast) "Asignado manualmente a [zone]" | none | `dock_scans` row with `manual_override = true` |

## Layout

Both `quicksort/page.tsx` and `batch/[batchId]/page.tsx` switch from a single-column container to:

```
grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6
```

- Left column (smaller): scanner UI + per-mode auxiliary content (counter for Rápido; `BatchDetailList` for Lote).
- Right column (larger): `PendingDockList`.

Mobile / narrow screens stack with the scanner first.

## Testing (TDD)

Tests are written before implementation, per `architecture.md`.

### Database

- `dock_verifications` table — RLS enforces `operator_id` isolation.
- Unique partial index — second insert for same `(operator_id, package_id)` while first is undeleted fails.
- Soft delete then re-insert succeeds (verification can be revoked then redone).

### `dock-scan-validator` (`apps/frontend/src/lib/distribution/dock-scan-validator.test.ts`)

- `validateDockDestination` returns `accepted_suggested` when the scanned code equals the suggested zone code, case-insensitive.
- Returns `accepted_consolidation` with the consolidación zone id when scanning the consolidación code.
- Returns `rejected_wrong_dock` with the expected code when scanning any other active dock.
- Returns `rejected_wrong_dock` for an unknown / non-matching code (the page-level handler distinguishes "wrong dock" from "code not found" using zone lookup).

### Hooks

- `useDockVerificationMutation` — second mutate for the same `packageId` is a no-op (idempotent); both `source` values are recorded correctly.
- `useDockVerifications` — returns a `Set` of package ids; realtime insert via the channel mock invalidates and updates the set.
- `useManualDockAssignment.canUse` — `false` for `WAREHOUSE_STAFF`/`PICKUP_CREW`/`LOADING_CREW`, `true` for `OPERATIONS_MANAGER`/`ADMIN`.
- `useManualDockAssignment.mutateAsync` — writes `dock_scans` row with `manual_override = true`; sets `redirect_reason` only when target is consolidación.

### Components

- `PendingDockList` — empty state renders when `groups` is empty; rows show ✓ when in `verifiedPackageIds`; tapping body calls `onTapVerify`; `⋯` menu hidden when `onManualAssign` is undefined; visible when defined.
- `ManualAssignMenu` — selecting a zone calls `onSelect(zoneId)`; consolidación rendered after a separator and last.
- `QuickSortScanner` — scanning the consolidación code on a non-flagged package fires `useDockScanMutation` with the consolidación zone id and `redirect_reason: 'manual_consolidation'`; scanning a third-party dock shows the exact error message string from the table above.

### Pages

- `quicksort/page.tsx` — renders both scanner and `PendingDockList` at `lg` breakpoint; passes `onManualAssign` only when role is manager/admin.
- `batch/[batchId]/page.tsx` — scanning the consolidación code redirects the most recent accepted package; accepted count decrements; new test for "incorrect dock" rejection message.

## Migrations & rollout

- New migration: `<timestamp>_add_dock_verifications_and_dock_scans_redirect.sql`.
  - Creates `dock_verifications` + indexes + RLS + realtime publication add.
  - Adds `redirect_reason` and `manual_override` columns to `dock_scans` with the check constraint.
- Backfill not required — both additions default to safe values (`null` / `false`).
- No feature flag — the changes are purely additive at the data layer; UI ships behind a route the operators already use.

## Open questions

None — all design choices were resolved in brainstorming (binary destination decision, scan-bound assignment, manager UI fallback, consolidación as scan target in both modes, explicit "incorrect dock" message).
