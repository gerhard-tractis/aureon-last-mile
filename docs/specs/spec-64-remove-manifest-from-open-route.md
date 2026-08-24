# Spec-64: Remove an unscanned carga from an open pickup route

> **Related:** [spec-47](spec-47-pickup-route-and-consolidated-reception.md) (`add_manifest_to_route`,
> the operation this undoes), [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md)
> (package state engine, and the route-lock trigger discussed below),
> [spec-56](spec-56-pickup-contract-phase.md) (plans to remove `close_pickup_route` — still
> `backlog`, and that function is very much live), [spec-61](spec-61-pickup-route-crew.md)
> (leader/crew model), [spec-66](spec-66-ops-leader-role.md) (`ops_leader`, which will need
> adding to this function's role list if it lands)

**Status:** in progress

_Date: 2026-08-21. Reworked 2026-08-24 after review — see Revision history._

---

## Problem

A carga can be added to an open pickup route and never taken off it. `add_manifest_to_route`
has no counterpart: no RPC, no UI, nothing.

Found in QA on 2026-08-21. Route `PR-2026-0003` carried `CARGA-EASY-001` (4/4 verified) and
`CARGA-EASY-002` (0 verified, one stray `not_found` scan). The second carga was not on the
truck. There was no way to say so.

The consequences are not cosmetic. `close_pickup_route` requires only that **the route** has
at least one verified scan, so it closes happily with a carga at 0/3.
`trg_route_receptions_status_sync` then marks **every** linked manifest `received` *and*
`completed` when reception finishes — a carga that never left the client's warehouse is
recorded as received, with its packages still `ingresado`.

> The latest definition of that trigger is in `20260812000006_spec52_unexpected_count.sql`
> (PART 4), **not** the spec-47 original — spec-52 added `status = 'completed'` and
> `completed_at` to the `completed` branch because 15/15 production manifests had been stuck
> at `in_progress` forever. A review of this spec flagged the sentence above as overstated on
> the strength of the spec-47 text; it was checked against the deployed function and the
> sentence is correct. Do not "fix" it.

The only existing exit is `cancel_pickup_route`, which detaches *all* manifests and kills the
route. Spec-61 Task 5 gave it a button (`CancelRouteButton.tsx`), so it is reachable — but
using it to drop one carga means the driver re-opens a route and re-adds the rest.

The `X` labelled `Quitar … de la ruta` in `PickupRouteDraftPanel.tsx` is not this feature —
it edits client-side selection state before the route exists and never touches an attached
manifest.

## Decision

**A carga may be removed from an open route while it has zero verified scans. One verified
scan and it is on the truck — removal is refused.**

Removal returns the manifest to the pending tab with no route, no reception state and no
half-open scan session: `pickup_route_id`, `reception_status` and `started_at` to NULL,
`status` back to `pending`. It is *not* a restore to factory condition, and the spec should
not claim otherwise — `total_orders` / `total_packages` (written by `openPendingManifest`),
`labels_printed_at` / `labels_printed_by` (spec-53), and the `pickup_scans` and
`discrepancy_notes` rows all survive. Keeping the scans and notes is deliberate: what happened
is audit-bearing even when the carga comes off the route.

**Authorisation mirrors `add_manifest_to_route` as it stands today** — the route's own
`driver_id`, **or an active `pickup_route_crew` member of that route**, or an
`operations_manager` / `admin` / `super_admin` of the same operator, with the role read from
`public.users` rather than the JWT claim. Copy the authorisation block from
`20260822000001_fix_add_manifest_to_route_authz.sql` (the `-- ── AUTHORISATION (new) ──`
section) and adapt only the message.

This reverses an earlier draft of this spec, which proposed copying `cancel_pickup_route`'s
narrower driver-or-manager list. That was written when `add_manifest_to_route` had no caller
check at all; `20260822000001` has since given it one, and deliberately chose the **wider**
list, because spec-61's `get_my_active_pickup_route` returns the route to leader **or active
crew** precisely so crew reach `/app/pickup/route/active` and its `AddManifestSheet`. Under
the narrower rule a crew member could attach a carga to the truck and then be unable to
detach the one they had just mis-attached. Add and remove must agree.

Removal is also a far smaller act than cancellation, which is why cancel's caution does not
transfer: it is refused the moment a single package is verified, so the blast radius is one
never-scanned carga, against cancel's "detach every manifest and end the shift".

> **This is not a security perimeter, and the spec must not pretend it is.**
> `20260310100000_create_pickup_verification_tables.sql` grants
> `SELECT, INSERT, UPDATE, DELETE ON public.manifests TO authenticated`, and the only policy is
> `manifests_tenant_isolation FOR ALL USING (operator_id = get_operator_id())`. Any
> authenticated user of the tenant can `PATCH /manifests` with `{pickup_route_id: null}` and
> bypass every guard below — and the app itself writes manifests directly this way
> (`lib/pickup/openPendingManifest.ts`). The same caveat applies to the gates on
> `add_manifest_to_route` and `cancel_pickup_route`. These guards make the *supported* path
> correct; they do not make the table safe. A real perimeter is a column-level
> `REVOKE UPDATE (pickup_route_id) ON public.manifests FROM authenticated` plus an audit of
> every direct writer, and that is its own spec — see Out of scope.

### Rejected alternatives, and why

| Option | Why not |
|---|---|
| Copy `cancel_pickup_route`'s list (driver + managers, crew excluded) | The earlier draft's choice. Crew can already ADD to the route they ride; letting them add but not un-add strands them. Cancel's caution is about ending someone else's shift, which removal is not. |
| Gate on `ROUTE_LEADER_ROLES` / `start_pickup_route`'s list | That list answers "who may OPEN a route", which spec-61 spells out is a different question from "who may act on THIS one". It contains `pickup_leader`, which would let one leader strip another leader's route. |
| No caller check at all, since the table is writable anyway | The direct-`UPDATE` hole is a reason to fix the table, not to ship a second unguarded path. The RPC is what the UI calls and what a future `REVOKE` would leave standing. |
| Any `pickup_scan` row blocks removal | A stray `not_found` scan has no `package_id` and advanced nothing. It would have blocked exactly the QA case this spec exists for. |
| Leave the manifest at `in_progress`, only clear `pickup_route_id` | The carga reappears on the pending tab as a half-open scan session with a stale `started_at`. Whoever picks it up next cannot tell it was never started. (Note this is exactly what `cancel_pickup_route` does today — see Known divergences.) |
| Reuse `cancel_pickup_route` | Kills the route and detaches every carga to remove one. |
| Put the action on the desk-side Recogida screen | The person who knows the carga is not on the truck is standing at the truck. |
| Hard-delete the `pickup_scans` rows on removal | Soft deletes only (CLAUDE.md). A `not_found` scan is evidence that someone tried. |

## API

```sql
CREATE OR REPLACE FUNCTION public.remove_manifest_from_route(
  p_route_id UUID, p_manifest_id UUID
) RETURNS public.manifests
```

Wrap the migration in `BEGIN;` / `COMMIT;`, as its neighbours do.

Guards, in order:

1. `get_operator_id()` non-null, else `42501`
2. route exists, own operator, `deleted_at IS NULL`
3. route `status = 'in_progress'`
4. **caller** is `v_route.driver_id`, or an active `pickup_route_crew` member of this route
   (`removed_at IS NULL AND deleted_at IS NULL`), or holds `operations_manager` / `admin` /
   `super_admin` in `public.users` — the `20260822000001` block, message in Spanish because
   the hook rethrows RPC messages verbatim and the UI toasts `err.message`
5. manifest row selected **`FOR UPDATE`**, own operator — see the race below
6. manifest `pickup_route_id = p_route_id`, else raise — removing from a route it is not on
   is a caller bug, not a no-op
7. no verified scan —
   `EXISTS (SELECT 1 FROM pickup_scans WHERE manifest_id = p_manifest_id AND scan_result = 'verified' AND package_id IS NOT NULL AND deleted_at IS NULL)`
   raises `manifest % has verified scans and cannot be removed`

Then `UPDATE manifests SET pickup_route_id = NULL, reception_status = NULL, status = 'pending', started_at = NULL`.
`GRANT EXECUTE ON FUNCTION public.remove_manifest_from_route(UUID, UUID) TO authenticated;`

### The race, and why guard 5 takes a lock

`usePickupScans` inserts into `pickup_scans` **directly from the browser** — no RPC, no route
check. The only server-side gate is `trg_pickup_scans_enforce_route_lock`
(`20260812000005`), whose documented and deliberate rule is **"NO ROUTE → ALLOW"**: most
manifests are scanned before being attached to a route, so a NULL `pickup_route_id` must not
reject the ordinary flow.

Two consequences:

- **Within the transaction:** a scan committing between the guard-7 `EXISTS` and the `UPDATE`
  defeats the guard entirely. `SELECT … FOR UPDATE` on the manifest row before guard 7 closes
  that window.
- **Outside it, and NOT closed by this spec:** someone sitting on `/app/pickup/scan/[loadId]`
  when the carga is removed keeps scanning successfully, because the removed manifest now has
  no route and the lock trigger allows it. Their scans advance packages to `verificado`,
  leaving a route-less `pending` manifest carrying verified scans — which
  `get_pending_manifests` then sorts first as "in progress", and which can never be removed
  from a route again. This is accepted for now and recorded here rather than hidden; closing
  it means teaching the route-lock trigger about detached manifests, which is a change to a
  function this spec does not otherwise touch.

### Known divergences

`cancel_pickup_route`'s detach (`trg_pickup_routes_set_manifest_reception_status`, the
`cancelled` branch) clears only `pickup_route_id` and `reception_status` — `status` stays
`in_progress` and `started_at` stays stamped. That is precisely the state the rejected
alternatives table calls unacceptable, so after this spec the two exits leave manifests in
different shapes. Aligning them is a follow-up, not a prerequisite.

## Files

| File | Change |
|---|---|
| `packages/database/supabase/migrations/2026XXXXXXXXXX_spec64_remove_manifest_from_route.sql` | **Create.** The function, its `COMMENT`, the grant, and a post-condition asserting the authz block is present (mirroring `20260822000001`'s own post-condition). |
| `packages/database/supabase/tests/spec64_remove_manifest_from_route.sql` | **Create.** Cases below. |
| `apps/frontend/src/lib/types.ts` | **Modify.** Add the generated `remove_manifest_from_route` entry alongside `add_manifest_to_route` and `cancel_pickup_route`. Without it the new hook does not typecheck. |
| `apps/frontend/src/hooks/pickup/useRemoveManifestFromRoute.ts` | **Create.** Mutation; invalidates `['pickup','route-manifests']`, `['pickup','unassigned-manifests']`, and the pending-manifests key. Rethrows the RPC message unchanged, as `useCancelPickupRoute` does. |
| `apps/frontend/src/components/pickup/RouteManifestList.tsx` | **Modify.** `X` per row when `verified_count === 0`, inside an `AlertDialog`. The row is a `<button>` — it becomes a `<div>` with an inner button for the scan-flow nav, so the remove control is not nested inside an interactive element. Add an optional `onRemove?: (manifestId: string) => void`; when absent the control does not render, so existing callers are unaffected. The `aria-label` must **not** reuse `PickupRouteDraftPanel`'s `Quitar … de la ruta`: that string already names a purely client-side deselect, and two very different operations must not be indistinguishable to a screen reader or a test query. Use `Quitar {external_load_id} de la ruta en curso`. |
| `apps/frontend/src/components/pickup/RouteManifestList.test.tsx` | **Modify.** Cases below. |
| `apps/frontend/src/app/app/pickup/route/active/page.tsx` | **Modify.** Wire the hook and toast on failure. Pass `onRemove` **unconditionally** — do not copy `CancelRouteButton`'s `route.driver_id === userId` gate, which would hide removal from the same crew who can add through the ungated `AddManifestSheet`. The server decides. |

`RouteManifestList.tsx` is 116 lines today; every file stays under 300.

### Discoverability caveat, to decide during implementation

`RouteManifestList` only renders when `manifestListVisible = routeManifests.length === 0 || showAll`, and `showAll` defaults to `false`. So on a route that already has manifests, the
remove control sits two taps deep behind "Ver los N manifiestos", while the mis-added carga is
visible on `NextManifestCard` with no way to act on it. Either accept that (the mistake is
rare and the expand is one tap) or surface removal on the card too. **Decide explicitly rather
than discovering it in QA.**

**Decided 2026-08-24 during implementation: accepted as-is.** The control lives only in the
expandable list; `manifestListVisible` is unchanged. Surfacing removal on `NextManifestCard`
would have widened the change past the Files table, and the mis-add it recovers from is rare
while the expand is one tap. Revisit if QA says otherwise — this is a placement decision, not
a constraint.

## Tests (TDD — write first)

> **These SQL tests do not gate CI.** `infra/supabase-qa/deploy-qa.sh` runs
> `packages/database/supabase/tests/*.sql` as an **advisory** post-check on QA deploy — they
> report pass/fail and can never fail the deploy. The authorisation and guard behaviour below
> is therefore covered by tests that nothing enforces. Write them anyway (they are how you
> verify locally against QA in a rolled-back transaction), but do not read "tests exist" as
> "regressions are caught". Anything that must be enforced needs a component test or a
> migration post-condition.

SQL:
- removal at zero verified scans clears all four columns and sets `status = 'pending'`
- a manifest with one verified scan is refused, and stays attached
- a `not_found`-only manifest is **removable** — the QA case
- refused when the route is not `in_progress`
- **an active crew member of the route CAN remove** — the decision this rework turns on
- refused for a crew member seated on a *different* route, and for one whose `removed_at` is set
- refused for a `pickup_leader` who is neither this route's driver nor its crew
- allowed for an `operations_manager` who is neither
- refused cross-tenant (another operator's route or manifest), and refused by the
  operator-scoped lookup *before* the role check, so the message is `not found`
- `pickup_scans` and `discrepancy_notes` rows survive removal
- a second concurrent remove hits guard 6 rather than silently succeeding twice
- the `manifests` audit trigger records the detach

Component:
- `X` renders at `verified_count === 0`, absent at `1`
- confirming the dialog calls `onRemove` with the manifest id; dismissing does not
- the row still navigates to the scan flow when the row body is clicked
- no remove control when `onRemove` is not supplied
- a failing RPC surfaces its message in a toast — the only enforced coverage of the refusal path
- removing the last manifest leaves the list's `EmptyState`, not a broken `routeComplete`

## Out of scope

- **The direct-`UPDATE` perimeter on `manifests`** — real and larger than this spec: a
  column-level `REVOKE UPDATE (pickup_route_id)` plus an audit of every direct writer,
  including `openPendingManifest`. Needs its own spec.
- Teaching `trg_pickup_scans_enforce_route_lock` about detached manifests (see The race)
- Aligning `cancel_pickup_route`'s detach with this reset (see Known divergences)
- **Stale verified scans across routes:** `pickup_scans` is manifest-scoped, not route-scoped,
  so a carga verified on route A, detached, then re-added to route B carries its old scans and
  can never be removed from B. Not a bypass — an over-strict refusal. Scoping the `EXISTS` by
  route or scan time is a follow-up.
- Any change to who may open a route or join its crew (spec-61)
- Removing `close_pickup_route` (spec-56, `backlog`)
- Removing a carga that has verified scans — that is an unload, a different operation with a
  different physical meaning, and nobody has asked for it
- The Recogida package-count fix, shipped separately as `20260821000003`

## Revision history

**2026-08-24 — reworked after an Opus spec review.** What changed:

- **Authorisation flipped** to mirror `add_manifest_to_route`'s current list (crew included).
  The original rationale — "mirroring add would reintroduce the hole spec-61 closed" — died
  when `20260822000001` landed and chose the wider list on purpose.
- **Deleted the "Known gap" block** claiming `add_manifest_to_route` has no caller check. It
  has had one since `20260822000001`, a migration whose own header credits this spec for
  finding it.
- **Added the security-perimeter disclaimer.** The guards are not a boundary; `authenticated`
  holds direct `UPDATE` on `manifests`. The original text called guards 4 and 7
  "load-bearing", which overstated them.
- **Added guard 5's `FOR UPDATE`** and documented the browser-side scan race that the
  route-lock trigger's "NO ROUTE → ALLOW" rule leaves open.
- **Added `lib/types.ts`** to the Files table; the hook would not have compiled.
- **Removed the `driver_id === userId` UI gate**, which contradicted the new authz rule.
- **Recorded the advisory-only reality of the SQL tests**, added the crew/lock/audit/toast
  cases, and noted the `showAll` discoverability problem.
- **Softened "resets to how it looked before anyone touched it"** — several columns survive.
- **Rejected one review finding:** that the Problem section overstates
  `trg_route_receptions_status_sync` by saying it marks manifests `completed`. The review read
  the spec-47 definition; `20260812000006` supersedes it and does set `status = 'completed'`.
  Verified against the deployed function before declining. The original wording stands.
