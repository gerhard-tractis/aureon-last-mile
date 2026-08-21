# Spec-64: Remove an unscanned carga from an open pickup route

> **Related:** [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (`add_manifest_to_route`,
> the operation this undoes), [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md)
> (package state engine), [spec-56](spec-56-pickup-contract-phase.md) (removes `close_pickup_route`),
> [spec-61](spec-61-pickup-route-crew.md) (leader/crew model and the authorisation rule this reuses)

**Status:** backlog

_Date: 2026-08-21_

---

## Problem

A carga can be added to an open pickup route and never taken off it. `add_manifest_to_route`
has no counterpart: no RPC, no UI, nothing.

Found in QA on 2026-08-21. Route `PR-2026-0003` carried `CARGA-EASY-001` (4/4 verified) and
`CARGA-EASY-002` (0 verified, one stray `not_found` scan). The second carga was not on the
truck. There was no way to say so.

The consequences are not cosmetic. `close_pickup_route` requires only that **the route** has
at least one verified scan (`20260625000001:436`), so it closes happily with a carga at 0/3.
`trg_route_receptions_status_sync` then marks **every** linked manifest `received` /
`completed` when reception finishes — a carga that never left the client's warehouse is
recorded as received, with its packages still `ingresado`.

The only existing exit is `cancel_pickup_route`, which detaches *all* manifests and kills the
route. Spec-61 Task 5 gave it a button (`CancelRouteButton.tsx`), so it is reachable — but
using it to drop one carga means the driver re-opens a route and re-adds the rest.

The `X` labelled `Quitar … de la ruta` in `PickupRouteDraftPanel.tsx:140` is not this feature —
it edits client-side selection state before the route exists and never touches an attached
manifest.

## Decision

**A carga may be removed from an open route while it has zero verified scans. One verified
scan and it is on the truck — removal is refused.**

Removal resets the manifest to how it looked before anyone touched it: `pickup_route_id`,
`reception_status` and `started_at` to NULL, `status` back to `pending`, so it returns to the
pending tab looking untouched. `pickup_scans` rows (including `not_found`) and
`discrepancy_notes` are **kept** — what happened is audit-bearing even when the carga comes
off the route.

**Authorisation follows `cancel_pickup_route`, not `add_manifest_to_route`:** the route's own
`driver_id`, or an `operations_manager` / `admin` / `super_admin` of the same operator, with
the role read from `public.users` rather than the JWT claim. Copy the block at
`20260821000001_spec61_cancel_pickup_route_authz.sql:102-137` and its reasoning verbatim.

This reverses the first instinct, which was to mirror `add_manifest_to_route` for symmetry.
Spec-61 shipped that migration on 2026-08-21 precisely because `cancel_pickup_route` was
`GRANT ... TO authenticated` with no caller check, and that is a security bug: "a pickup_crew
member could cancel their own leader's route mid-shift, detaching every manifest on it."
Detaching one manifest from someone else's route is the same operation in miniature.
Mirroring `add_manifest_to_route` would reintroduce, one day later, the hole spec-61 just
closed.

> **Known gap, deliberately out of scope.** `add_manifest_to_route` still has no caller check
> (`20260625000001:354-397`, `GRANT ... TO authenticated` at `:608`). Any authenticated user
> of the operator can push a manifest onto anyone's open route. It is the mirror image of the
> bug spec-61 fixed and it should be fixed the same way — but doing it here means re-issuing
> a function this spec does not otherwise touch. Track it separately.

### Rejected alternatives, and why

| Option | Why not |
|---|---|
| Mirror `add_manifest_to_route`: own operator only, no caller check | Reintroduces the exact hole spec-61 closed the day before. See above. |
| Gate on `ROUTE_LEADER_ROLES` / `start_pickup_route`'s list | That list answers "who may OPEN a route", which spec-61 spells out is a different question from "who may act on THIS one". It contains `pickup_leader`, which would let one leader strip another leader's route. |
| Any `pickup_scan` row blocks removal | A stray `not_found` scan has no `package_id` and advanced nothing. It would have blocked exactly the QA case this spec exists for. |
| Leave the manifest at `in_progress`, only clear `pickup_route_id` | The carga reappears on the pending tab as a half-open scan session with a stale `started_at`. Whoever picks it up next cannot tell it was never started. |
| Reuse `cancel_pickup_route` | Kills the route and detaches every carga to remove one. |
| Put the action on the desk-side Recogida screen | The person who knows the carga is not on the truck is standing at the truck. |
| Hard-delete the `pickup_scans` rows on removal | Soft deletes only (CLAUDE.md). A `not_found` scan is evidence that someone tried. |

## API

```sql
CREATE OR REPLACE FUNCTION public.remove_manifest_from_route(
  p_route_id UUID, p_manifest_id UUID
) RETURNS public.manifests
```

Guards, in order:

1. `get_operator_id()` non-null, else `42501`
2. route exists, own operator, `deleted_at IS NULL`
3. route `status = 'in_progress'`
4. **caller** is `v_route.driver_id`, or holds `operations_manager` / `admin` / `super_admin`
   in `public.users` — the spec-61 block, message in Spanish because the hook rethrows RPC
   messages verbatim
5. manifest exists, own operator
6. manifest `pickup_route_id = p_route_id`, else raise — removing from a route it is not on
   is a caller bug, not a no-op
7. no verified scan —
   `EXISTS (SELECT 1 FROM pickup_scans WHERE manifest_id = p_manifest_id AND scan_result = 'verified' AND package_id IS NOT NULL AND deleted_at IS NULL)`
   raises `manifest % has verified scans and cannot be removed`

Then `UPDATE manifests SET pickup_route_id = NULL, reception_status = NULL, status = 'pending', started_at = NULL`.
`GRANT EXECUTE ON FUNCTION public.remove_manifest_from_route(UUID, UUID) TO authenticated;`

Guards 4 and 7 are server-side and load-bearing. The UI hiding the button is defence in depth,
not the control — `authenticated` can call the RPC directly.

## Files

| File | Change |
|---|---|
| `packages/database/supabase/migrations/2026XXXXXXXXXX_spec64_remove_manifest_from_route.sql` | **Create.** The function, its `COMMENT`, the grant, and a post-condition asserting the authz block is present (mirroring `20260821000001`'s own post-condition). |
| `packages/database/supabase/tests/spec64_remove_manifest_from_route.sql` | **Create.** Cases below. |
| `apps/frontend/src/hooks/pickup/useRemoveManifestFromRoute.ts` | **Create.** Mutation; invalidates `['pickup','route-manifests']`, `['pickup','unassigned-manifests']`, and the pending-manifests key. Rethrows the RPC message unchanged, as `useCancelPickupRoute` does. |
| `apps/frontend/src/components/pickup/RouteManifestList.tsx` | **Modify.** `X` per row when `verified_count === 0`, `aria-label` reading `Quitar {external_load_id} de la ruta`, inside an `AlertDialog`. The row is a `<button>` (line 75) — it becomes a `<div>` with an inner button for the scan-flow nav, so the remove control is not nested inside an interactive element. Add an optional `onRemove?: (manifestId: string) => void`; when absent the control does not render, so existing callers are unaffected. |
| `apps/frontend/src/components/pickup/RouteManifestList.test.tsx` | **Modify.** Cases below. |
| `apps/frontend/src/app/app/pickup/route/active/page.tsx` | **Modify.** Wire the hook; pass `onRemove` only when `route.driver_id === userId`, matching how `CancelRouteButton` is gated there. Toast on failure. |

Every file stays under 300 lines; `RouteManifestList.tsx` is 116 today.

## Tests (TDD — write first)

SQL:
- removal at zero verified scans clears all four columns and sets `status = 'pending'`
- a manifest with one verified scan is refused, and stays attached
- a `not_found`-only manifest is **removable** — the QA case
- refused when the route is not `in_progress`
- refused for a crew member who is not the route's driver and holds no manager role
- allowed for an `operations_manager` who is not the driver
- refused cross-tenant (another operator's route or manifest)
- `pickup_scans` and `discrepancy_notes` rows survive removal

Component:
- `X` renders at `verified_count === 0`, absent at `1`
- confirming the dialog calls `onRemove` with the manifest id; dismissing does not
- the row still navigates to the scan flow when the row body is clicked
- no remove control when `onRemove` is not supplied

## Out of scope

- Fixing `add_manifest_to_route`'s missing caller check — real, noted above, needs its own change
- Any change to who may open a route or join its crew (spec-61)
- Removing `close_pickup_route` (spec-56)
- Removing a carga that has verified scans — that is an unload, a different operation with a
  different physical meaning, and nobody has asked for it
- The Recogida package-count fix, shipped separately as `20260821000003`
