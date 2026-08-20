# Spec-61: Pickup route crew — a leader opens the route, the crew is added to it

> **Related:** [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md) (route + vehicle model),
> [spec-56](spec-56-pickup-contract-phase.md) (per-vehicle uniqueness index),
> [spec-54](spec-54-ui-rebrand.md) (screens `3j` / `3h`)

**Status:** backlog

_Date: 2026-08-20_

---

## Problem

Several people work one pickup trip. Today the schema cannot express that.

A pickup route belongs to exactly one user — `pickup_routes.driver_id`, taken from
the JWT `sub` by `start_pickup_route` — and `uniq_pickup_routes_one_active_per_driver`
allows one active route per person. So when three pickers work the same van:

- the first opens a route;
- the other two see **no active route** (`useActivePickupRoute` filters
  `driver_id = auth.uid()`) and land on `3j`;
- `get_pending_manifests` does **not** exclude routed manifests, so they see the
  first picker's loads listed as available;
- each of them opens **their own route** for the same physical trip.

Reception then receives two or three routes for one van arriving. Nothing in the
system says they were the same trip.

**What already works:** scanning is not owner-restricted. The guard on
`/app/pickup/scan/[loadId]` checks only that the manifest is on *some*
`in_progress` route, and `pickup_scans.scanned_by_user_id` records each scanner.
So several people scanning one load is already supported and correctly attributed.
The gap is entirely in who may open a route and how anyone else gets onto it.

## Decision

**A leader opens the route and adds the crew. Crew cannot open a route.**

Both halves are load-bearing. Adding a crew list while leaving route creation open
to everyone does not solve the problem — a crew member the leader forgot can still
open their own route, and that failure is *silent*: two routes exist and nobody
notices until reception. This was raised and rejected during design.

With creation restricted, forgetting someone means that person is **blocked** and
says so immediately. A loud failure resolved in ten seconds beats a silent one
discovered at the hub.

### Rejected alternatives, and why

| Option | Why not |
|---|---|
| Crew list, anyone may still open a route | The forgotten crew member silently opens a second route. Fails invisibly. |
| Per-route leadership (whoever opens it leads) | Does not restrict creation, so it is the row above. |
| One active route per **vehicle** only | Necessary but insufficient — a picker can select a different available vehicle and fragment anyway. Still worth having: see spec-56. |
| Crew join by scanning the leader's route QR | Attractive (uses the existing `RouteQRView`, cannot join the wrong route) but rejected: the leader must own who is on the trip, not discover it after the fact. |
| Upstream assignment from the desk | `manifests.assigned_to_user_id` exists but has zero writers and is NULL everywhere. Would need an assignment surface nobody has asked for, and these operators are moving off paper — one more desk step is the wrong direction. |

### Relationship to spec-56

Spec-56 adds `uniq_pickup_routes_one_active_per_vehicle`. That is a **second,
independent barrier** and is already specced, gated and triggered on real usage —
this spec does not duplicate or depend on it. Together: crew cannot create at all,
and even a second leader cannot duplicate a van's trip.

## Data model

```sql
CREATE TABLE IF NOT EXISTS public.pickup_route_crew (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  pickup_route_id UUID NOT NULL REFERENCES public.pickup_routes(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id),
  added_by        UUID NOT NULL REFERENCES public.users(id),
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);
```

- `driver_id` on `pickup_routes` stays as-is and **means the leader**. No change to
  what a route is.
- A person on two active trips at once is the same error the per-driver index
  already prevents for leaders. It needs the equivalent for crew — a partial unique
  index on `(operator_id, user_id)` over rows whose route is still active. Confirm
  the predicate can be expressed without a subquery, or carry the route status on
  the crew row.
- `removed_at` rather than a hard delete: who was on the trip is audit-bearing, and
  this repo is soft-delete throughout.

### Capability, not a role

Restricting creation needs a capability difference. Do **not** add a `pickup_leader`
value to `user_role` — the enum drives permissions across the whole app, and the
same person leads on Tuesday and is crew on Wednesday. Use a permission
(`pickup.lead` or similar) on the existing vocabulary
(`20260811000001_align_permission_vocabulary.sql`), granted independently of role.

## Behaviour

- `start_pickup_route` gains a crew argument, or a companion
  `add_crew_to_route(p_route_id, p_user_id)` — decide during implementation, but the
  crew must be settable at creation because `3j` asks for it there.
- The RPC must reject a caller without the lead capability, with a message the UI
  can show as-is (the existing "El conductor ya tiene una ruta de retiro activa"
  is the precedent).
- `useActivePickupRoute` resolves *my route* as **I lead it OR I am active crew on it**.
- `3j` is what a **leader without a route** sees: vehicle + crew + start.
- A **crew member without a route** does not see `3j`. They see that no route is
  open and who to ask. They must not be shown a start control they cannot use.
- A crew member on a route sees `3h`, the same as the leader.
- `3h` shows who is on the trip.

## Open questions — answer before implementing

1. **Can the crew change mid-route?** Someone joins late, someone goes home. If yes,
   `3h` needs an edit path and `removed_at` carries real meaning.
2. **Can crew scan without the leader present?** Today yes — nothing checks. Keep it?
3. **Who may close the route** — leader only, or anyone on it?
4. **A picker already on another trip** — refuse, or move them? Refusing is safer and
   matches the leader constraint.
5. **Who grants the lead capability**, and through which surface? There is no admin UI
   for permissions today.

## Also fix, independent of the model

`get_pending_manifests` does not exclude manifests already attached to a route, so a
routed load still appears available to everyone. Two people can try to claim the same
load and the second gets a raw rejection from `add_manifest_to_route`. This is wrong
under any of the options above and should be corrected regardless.

---

## Implementation plan

Ordered. Each task is independently reviewable; later tasks depend on earlier ones,
so do not parallelise. TDD throughout — tests first, and the DB tasks carry pgTAP or
an equivalent assertion of the constraint they add.

- [ ] **1 — Migration: role and crew table.**
  Add `pickup_leader` to `user_role`. Map its permissions in the vocabulary migration:
  everything `pickup_crew` has, plus whatever marks route creation. Create
  `pickup_route_crew` as sketched above, with RLS matching the sibling pickup tables and
  a partial unique index preventing one person from being active crew on two routes.
  A new enum value cannot be added and used in the same transaction in older Postgres —
  check the target version and split the migration if required. Adding an enum value is
  irreversible; say so in the file header.

- [ ] **2 — RPCs.**
  `start_pickup_route` refuses a caller without the leader capability, with a Spanish
  message the UI shows as-is (`'El conductor ya tiene una ruta de retiro activa'` is the
  precedent). It accepts the crew and inserts the rows in the same transaction as the
  route, so a route can never exist without its crew. A picker already active on another
  route is refused, naming that route. Decide whether a companion `add_crew_to_route`
  is needed at all given the crew is fixed at creation — if it is not, do not build it.

- [ ] **3 — Frontend role plumbing.**
  `pickup_leader` added to: `lib/types/auth.types.ts`, `lib/permissions.ts`,
  the two zod enums in `app/api/users/**`, `components/admin/UserForm.tsx`, and
  `MOBILE_TAB_ROLES` / `isOperationsRole` in `components/sidebar/navigation.ts`.
  **The navigation one is the trap:** a `pickup_leader` missing from that set gets no
  mobile tab bar at all. Add a test that every operations role appears there.

- [ ] **4 — `useActivePickupRoute` resolves crew membership.**
  "My route" becomes *I am the leader* OR *I am active crew*. Today it filters
  `driver_id = auth.uid()`. Keep one query; do not introduce an N+1.

- [ ] **5 — `3j` for leaders, and what crew see instead.**
  Leaders pick vehicle + crew and start. A crew member with no active route must NOT see
  `3j` — no vehicle selector, no start button they cannot use. They see that no route is
  open and who to ask. Decide that copy with the artboard in hand.

- [ ] **6 — `3h` shows the crew.**
  Who is on this trip. No edit path: the crew is fixed once the route opens.

- [ ] **7 — `get_pending_manifests` excludes routed manifests.**
  Independent of the crew model and wrong today under any of them: a routed load still
  appears available to everyone, so two people can claim it and the second gets a raw
  rejection from `add_manifest_to_route`. Adding `pickup_route_id IS NULL` to the
  predicate changes what several existing screens list — check every caller before
  changing it.

### Risks to carry

- **The enum change touches auth.** Eight migrations reference `user_role`, and RLS
  policies read it. A mistake here does not fail a test, it locks people out.
- **Deploy aborts on data, not code** — the lesson spec-56 records. Any constraint added
  over live rows needs a pre-flight query against production first.
- **QA has no `pickup_leader` user.** `create-qa-users.sh` seeds five roles; none of them
  will be able to start a route once task 2 lands. That script must gain a leader before
  the QA flow can be walked at all, or QA breaks the moment this deploys.

## Non-goals

- The per-vehicle uniqueness index (spec-56 owns it).
- Assignment of manifests to individual users (`assigned_to_user_id` stays dead).
- Any change to how scanning or attribution works — both already support several
  people on one load.
