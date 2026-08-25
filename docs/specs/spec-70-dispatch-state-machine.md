# Spec-70: Dispatch state machine — separating the plan from the load

> **Related:** [spec-15](spec-15-dispatch-module.md) (built the route builder and the scan flow),
> [spec-37](spec-37-pre-route.md) (built Pre-ruta and `create_seeded_route`),
> [spec-38](spec-38-route-activity-view.md) (En Ruta tab; documents the `useRoutePackages` type lie),
> [spec-43](spec-43-failed-delivery-return-flow.md) (`retorno_hub` — the re-delivery loop this unblocks),
> [spec-66](spec-66-ops-leader-role.md) (`ops_leader`, the floor role referenced below),
> [spec-68](spec-68-distribution-mobile.md) (`dock_zones.capacity` — the nullable-capacity pattern spec-73 will copy)

**Status:** in progress

_Date: 2026-08-25_

---

## Goal

Give Despacho one route lifecycle, with the **plan** (which orders are meant to go on this truck)
and the **load** (which packages were physically confirmed onto it) recorded as two different
things instead of one `dispatches` row meaning both.

This is the spine of the dispatch rework. It ships no new screen and needs no coordinates. Specs
71–73 (load positions, block sequencing, capacity) all depend on it and none of them depend on
each other.

## Non-Goals

- Load positions / the physical staging pass — **spec-71**.
- Delivery sequence, blocks, driver-actual capture — **spec-72**.
- Vehicle capacity, fill rate, top-up suggestions — **spec-73**.
- Any map, pin, geocode or drag-and-drop. Deliberately dropped from this line of work; see
  [spec-58](spec-58-geocoding-foundation.md), still `backlog`.
- Route optimisation. `sidecar/or-tools/` stays unwired.
- Changing the Pre-ruta cohort rule or `get_pre_route_snapshot`.
- Changing anything in Distribution, Reception or Pickup.

---

## The problem, with evidence

Pre-ruta and the route builder are two entry paths into the same table that do not agree on what
a `dispatches` row means. Pre-ruta writes one to mean *"planned onto this route"*; the builder
writes one to mean *"physically scanned onto this truck"*. Nothing distinguishes them, so:

| # | Breakage | Where |
|---|---|---|
| 1 | **A pre-routed order cannot be loaded.** `validateScan` step 4 rejects any order holding *any* non-deleted `dispatches` row and never filters by `route_id`. Pre-ruta creates exactly that row, so every scan on a seeded route returns *"Paquete ya asignado a otra ruta activa"*. | `lib/dispatch/scan-validator.ts` |
| 2 | **Seeded routes ship unverified.** `create_seeded_route` never touches `packages.status`; `/close` only advances rows already at `en_carga`; `/dispatch` checks no package status at all and blanket-sets `en_ruta`. A route can reach DispatchTrack with no package ever physically confirmed. | `20260423000003_create_seeded_route.sql`, `close/route.ts`, `dispatch/route.ts` |
| 3 | **"Cerrar ruta" is not a state.** `routeClosed` is `useState`. No column, no status change. Reload the page and the route is open again. `/dispatch` only requires `status='draft'`, so closing is decorative. | `RouteBuilder.tsx:25`, `close/route.ts` |
| 4 | **`planned_stops` drifts.** Seeding sets it to the order count, each scan does `+1`, removal never decrements. It is the `EMPTY_ROUTE` guard and the progress denominator. | `create_seeded_route.sql`, `scan/route.ts`, `packages/[pkgId]/route.ts` |
| 5 | **A dispatched route hides in "Abiertas".** `planned` (already at DT) lists beside `draft`; "En ruta" shows only `in_progress`. Worse, `DELETE /routes/[id]` accepts `planned` and soft-deletes locally with **no DT cancellation**. | `useDispatchRoutesByStatus`, `[id]/route.ts:29` |
| 6 | **Re-delivery is a dead end.** spec-43 returns failed packages to `en_bodega` "so the pipeline restarts", but the dispatch row on the old completed route is never deleted — so breakage #1 blocks the re-scan permanently. | spec-43 + `scan-validator.ts` |
| 7 | **Route date is always today.** `create_seeded_route` hardcodes `CURRENT_DATE`, ignoring Pre-ruta's date filter. Planning tomorrow's wave silently produces a route dated today. | `create_seeded_route.sql` |
| 8 | **Status vocabularies collide.** `useRoutePackages` reads `dispatches.status` (`pending`/`delivered`/`failed`/`partial`) into a field typed `PackageStatus`, and the UI labels the count "Paquetes escaneados" — while the rows are orders, and none were scanned. spec-38 named this and declined to fix it. | `useRoutePackages.ts` |
| 9 | **Reset-to-`asignado` is wrong.** Removals revert packages to `asignado`, but nothing writes that status any more — the dock-scan trigger writes `sectorizado`. `scan-validator.ts`'s own header comment says so. | `[id]/route.ts:58`, `packages/[pkgId]/route.ts` |
| 10 | **Assignment is ephemeral.** `routes.vehicle_id` and `routes.driver_name` **already exist** (`20260306000001:84-85`) and the dispatch flow never writes either — vehicle and driver live in React state and go straight to DT. No record of who drove. | `RouteBuilder.tsx`, `dispatch/route.ts` |

---

## Decisions

1. **`dispatches` gets a `stage`, and stage is the plan/load axis.** `status` stays exactly what it
   is — the provider's delivery outcome (`pending`/`delivered`/`failed`/`partial`), written by the
   DT webhooks. `stage` is ours. Overloading `status` with local lifecycle would put two writers
   with two vocabularies on one column, which is how we got here.

2. **A plan is a commitment.** A route cannot be sealed while any dispatch is still `planned`.
   Every one is either `staged` or **explicitly removed by a manager**. Nothing is short by
   accident, and there is no auto-release: a package the manager did not remove has to go on the
   truck.

3. **Removal is a manager action, never the scanner's.** Restricted to `admin` / `ops_leader`,
   requires a reason, soft-deletes the dispatch and writes `audit_logs`. The order returns to the
   unrouted pool and reappears in Pre-ruta.

4. **The gap is visible during loading, not discovered at the seal.** Decision 2 can otherwise stop
   the dock at the cutoff — the worst possible moment. The route shows a live *"faltan N por
   estibar"* count with the remove action inline on those rows, so the seal never surprises anyone.

5. **Counts are derived, never incremented.** `planned_stops` / `staged_stops` come from a view over
   `dispatches`. Breakage #4 is a class of bug, not an instance, and `+1` in a handler will
   reintroduce it.

6. **Release is a one-way door.** Once `dispatched`, local delete is refused. Undoing a released
   route requires a compensating cancel-at-DT, which this spec does **not** implement — it only
   stops the silent local divergence in breakage #5.

7. **Unplanned scans are adopted, not rejected.** A package scanned into a route it was not planned
   on joins as `adopted` with a reason. Refusing it would push operators back to paper; silently
   treating it as planned would erase the fact that the plan was wrong. Both are recorded.

---

## State machine

```
   draft ──► planned ──► loading ──► loaded ──► dispatched ──► in_transit ──► completed
     │          │           │           │
     └──────────┴───────────┴───────────┴──────► cancelled
                                                 (dispatched+ cannot be cancelled locally)
```

| Status | Meaning | Entered by |
|---|---|---|
| `draft` | Empty shell, no orders yet | `POST /routes` with no body |
| `planned` | Orders assigned. Intent, fully reversible | `POST /routes {order_ids}` (Pre-ruta) |
| `loading` | Staging has begun — first package staged | first successful stage scan |
| `loaded` | Manifest sealed. Zero dispatches at `planned` | `POST /routes/[id]/seal` |
| `dispatched` | Accepted by DispatchTrack. One-way door | `POST /routes/[id]/dispatch` |
| `in_transit` | Driver started | DT webhook (today's `in_progress`) |
| `completed` / `cancelled` | Terminal | DT webhook / manager |

**`in_progress` is kept and mapped, not renamed.** It is what the DT webhook and
`dispatchtrack-route-poll` already write. `in_transit` is added as its alias for the new machine and
the webhook writers are pointed at it in one place; `in_progress` stays in the enum so no deployed
writer breaks mid-migration.

**Enum ordering trap:** `route_status_enum` was created as
`('planned','in_progress','completed','cancelled')` and spec-15's migration added `draft` with a
bare `ADD VALUE IF NOT EXISTS` — **no `BEFORE 'planned'`**, contrary to what spec-15's text claims.
So `draft` currently sorts *last*. Any new value added here inherits the same hazard. Never
`ORDER BY status`; order by an explicit `CASE` or a lookup. The suite asserts the current
(non-lifecycle) ordering so that anyone who "fixes" it finds out in tests rather than in production.

### Dispatch stages

| Stage | Meaning | Set by |
|---|---|---|
| `planned` | On the plan, not yet physically confirmed | Pre-ruta seeding |
| `staged` | Physically confirmed onto this route | stage scan |
| `adopted` | Physically present but never planned | stage scan, with reason |

Removal is not a stage — it is a soft-delete plus `removal_reason`, so a removed row leaves the
plan entirely rather than lingering in a state that has to be filtered everywhere.

---

## Data model

No new tables.

```sql
-- dispatches: the plan/load axis
ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS stage           TEXT NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS staged_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS staged_by       UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS adopted_reason  TEXT,
  ADD COLUMN IF NOT EXISTS removal_reason  TEXT;

ALTER TABLE public.dispatches
  ADD CONSTRAINT dispatches_stage_check CHECK (stage IN ('planned','staged','adopted')),
  ADD CONSTRAINT dispatches_staged_at_check
    CHECK ((stage = 'planned') = (staged_at IS NULL));

-- route lifecycle
ALTER TYPE public.route_status_enum ADD VALUE IF NOT EXISTS 'loading';
ALTER TYPE public.route_status_enum ADD VALUE IF NOT EXISTS 'loaded';
ALTER TYPE public.route_status_enum ADD VALUE IF NOT EXISTS 'dispatched';
ALTER TYPE public.route_status_enum ADD VALUE IF NOT EXISTS 'in_transit';
```

`stage` is `TEXT` + `CHECK`, not an enum: `ALTER TYPE ... ADD VALUE` cannot run inside a
transaction with other DDL in this project's migration runner, and the value set here is expected
to move (spec-72 may add a block-level stage). The project already uses this shape for
`orders.geocode_status` in spec-58.

**Two migration files, not one.** PostgreSQL refuses to *use* an enum value in the transaction that
added it (`unsafe use of new value ... of enum type`), and the Supabase CLI wraps each migration
file in its own transaction. So `20260825000001` adds the four labels and does nothing else, and
`20260825000002` — which remaps rows onto them — runs afterwards. Merging them back into one file
fails at deploy time, not at review time. Both files say so in their headers.

**Backfill.** Every pre-existing `dispatches` row predates the distinction and cannot be classified
retroactively, so all of them go to `staged` with `staged_at = created_at`. That is the safe
direction: it reads history as already confirmed rather than leaving rows at `planned`, which would
make the phase-3 seal guard refuse to close routes nobody can now go and verify. Soft-deleted rows
are backfilled too — they are off every plan already, and leaving them at the column default would
make them the only rows in the table whose `stage` means something different from every other row's.

**Enum remap.** Existing `planned` routes mean *"sent to DT"* under the old vocabulary — it is what
`/dispatch` writes after DT returns, and it is also the table default the DT webhooks land on — and
`dispatched` under the new one. This is the one irreversible step in the spec. The migration logs
the count before and after and **raises if any row is left behind**; that assertion lives in the
migration rather than the test suite, because it is meaningful exactly once, against the
pre-migration population. Once phase 2 ships, `planned` is a legitimate local state again and a
standing "no routes at planned" test would be wrong.

### New view — `route_stop_counts`

```sql
CREATE OR REPLACE VIEW public.route_stop_counts AS
SELECT route_id,
       operator_id,
       COUNT(*)                                  AS total_stops,
       COUNT(*) FILTER (WHERE stage = 'planned') AS pending_stops,
       COUNT(*) FILTER (WHERE stage = 'staged')  AS staged_stops,
       COUNT(*) FILTER (WHERE stage = 'adopted') AS adopted_stops
FROM public.dispatches
WHERE deleted_at IS NULL AND route_id IS NOT NULL
GROUP BY route_id, operator_id;
```

`routes.planned_stops` stays on the table — the DT webhooks write it from the provider's own
figure and that is a different number. Nothing local reads it any more; a comment says so.

### `transition_route_status(p_route_id, p_operator_id, p_to_status)`

One `SECURITY INVOKER` function owning every legal edge, rejecting anything else with a typed
error. Handlers call it instead of `UPDATE routes SET status`. Per the project rule, any future
`CREATE OR REPLACE` uses the **latest** migration's definition as its template.

---

## API changes

| Endpoint | Change |
|---|---|
| `POST /routes` | `{order_ids}` → status `planned` (was `draft`). Accepts `route_date` from the Pre-ruta filter — fixes #7. No body → `draft`, unchanged. |
| `POST /routes/[id]/scan` | Becomes the **stage** scan. Flips the planned row to `staged`; an unplanned code inserts `adopted`. Drops the `+1`. First success moves the route to `loading`. |
| `POST /routes/[id]/close` | Renamed **`/seal`**. Refuses with `UNSEALED_STOPS` + the pending list while any dispatch is `planned`. Idempotent. Sets `loaded`. `/close` kept as a deprecated alias for one release. |
| `DELETE /routes/[id]/packages/[pkgId]` | Manager-only. Requires `removal_reason`. Soft-deletes + audits. Reverts packages to `sectorizado`, not `asignado` — fixes #9. |
| `POST /routes/[id]/dispatch` | Requires `loaded` (was `draft`). Persists `vehicle_id` + `driver_name` — fixes #10. Sets `dispatched`. |
| `DELETE /routes/[id]` | Refuses at `dispatched` and beyond — fixes #5. |

`validateScan`'s core question changes from *"does a dispatch row exist for this order?"* to
*"is this order planned on **this** route and not yet staged?"* — which is what fixes #1 and #6
together. Its existing `retenido` / consolidation branch is kept verbatim.

`useRoutePackages` is corrected while it is being touched anyway: it returns `stage`, and the UI
label becomes "Órdenes en la ruta" with a separate staged counter. Closes #8.

---

## Testing

TDD throughout. Vitest for handlers and hooks; for the database, the repo's own SQL suite style —
`BEGIN`, fixtures, `DO $$` blocks that `RAISE` on failure, `ROLLBACK` — matching
`pre_route_snapshot.test.sql`. Not literal pgTAP: nothing in this repo uses `plan()`/`ok()`, and
these files run two ways, via `npx supabase test db` locally and as an **advisory** post-check on
every QA deploy (`sql_tests_check` in `infra/supabase-qa/deploy-qa.sh`). Advisory means they report
but cannot fail the deploy — CI never runs them at all.

**SQL suite** — `packages/database/supabase/tests/spec70_dispatch_stage.test.sql`
- every legal transition succeeds; a representative illegal set is rejected with the typed error
- seal refuses while any dispatch is `planned`; succeeds at zero; is idempotent
- `route_stop_counts` matches hand-built fixtures including soft-deleted and adopted rows
- the `staged_at` CHECK rejects `stage='staged'` with a NULL timestamp
- backfill: a `draft` route's rows land at `staged`; a `planned` route remaps to `dispatched`
- `operator_id` isolation on the view and the function
- the enum sort order is not relied upon

**Vitest**
- stage scan on a planned order succeeds — **the regression test for #1**, and the one that would
  have caught it
- stage scan of an unplanned code creates `adopted` with a reason
- re-scan of an already-`staged` order is rejected, not duplicated
- an order returning via `retorno_hub` can be planned and staged onto a new route — **#6**
- seal returns `UNSEALED_STOPS` with the pending list
- dispatch refused at `planned`/`loading`; accepted at `loaded`; persists vehicle and driver
- delete refused at `dispatched`
- removal refused for a non-manager role

---

## Implementation phases

Each phase is one PR with auto-merge, per `CLAUDE.md`.

- **Phase 1 — Database.** Migration (columns, CHECKs, enum values, backfill, remap), the view,
  `transition_route_status`, SQL suite. Nothing reads it yet; ships green on its own.
- **Phase 2 — Scan and stage.** Rewrite `validateScan` and the scan handler. Adoption path. This is
  the phase that makes Pre-ruta output loadable.
- **Phase 3 — Seal, dispatch, delete.** `/seal`, the guarded `/dispatch` and `DELETE`, manager-only
  removal with audit.
- **Phase 4 — UI truth.** Tab statuses corrected (`Abiertas` = `planned`+`loading`+`loaded`,
  `En ruta` = `dispatched`+`in_transit`), the live "faltan N por estibar" counter, `routeClosed`
  local state deleted, `useRoutePackages` corrected.

Phase 1 is the only irreversible one. Phases 2–4 are ordinary code.

**Deploy note:** per `project_deploy_path_filter_masks_db_failures`, green PR checks do not mean the
migration ran — `deploy.yml`'s path filter can skip the DB job entirely. Phase 1 must be verified
applied against QA by querying the enum and the new columns directly before Phase 2 merges.
