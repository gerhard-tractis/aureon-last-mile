# Spec-56: Pickup Route Contract Phase — remove the spec-52 compatibility layer

> **Completes:** [spec-52-pickup-route-vehicle-and-state-engine.md](spec-52-pickup-route-vehicle-and-state-engine.md)

**Status:** backlog

_Date: 2026-08-14_

---

## Why this exists as its own spec

Spec-52 shipped as an **expand/contract** release. The database chunk deployed ahead of the frontend, and merge to `main` auto-deploys, so every path the then-current frontend called had to keep working. Those compatibility paths are still in production and are now dead weight.

This is not a hotfix. Two properties disqualify it:

1. **One step can abort a production deploy on data, not on code.** Adding `uniq_pickup_routes_one_active_per_vehicle` builds a unique index over live rows. After spec-52's backfill an operator's historical routes share the `SIN-REGISTRO` placeholder, so if any operator holds two `in_progress` routes the index build fails and rolls back the whole push. It passes CI and dies on production data. See the pre-flight gate below.
2. **It has a prerequisite no hotfix has** — it must not run until the new flow has real usage behind it.

It equally does **not** need brainstorming. Every decision is already made and reasoned in spec-52's "Expand/contract release plan" section; re-deriving them would restate that document. This spec exists to carry the checklist, the gates, and the ordering.

## Trigger — do not start before this is true

- The spec-52 flow has been used by real drivers and receptionists for at least one full operating week, with at least one route completed end to end in production (`pickup_routes.status = 'received'` with a non-placeholder vehicle).
- Confirm with:
```sql
SELECT code, status, started_at, received_at
  FROM public.pickup_routes pr
  JOIN public.vehicles v ON v.id = pr.vehicle_id
 WHERE v.plate <> 'SIN-REGISTRO'
   AND pr.status = 'received'
 ORDER BY pr.received_at DESC;
```
Zero rows means nobody has completed a route on the new flow. Do not remove the fallbacks.

## Gate 1 — the per-vehicle index pre-flight (run against production FIRST)

```sql
SELECT operator_id, COUNT(*) AS active_routes
  FROM public.pickup_routes
 WHERE status = 'in_progress' AND deleted_at IS NULL
 GROUP BY operator_id
HAVING COUNT(*) > 1;
```

**Any row means the index cannot be built.** Those routes share a `vehicle_id` (the placeholder, or a plate resolved by the deprecated TEXT wrapper). Reconcile them first — cancel abandoned ones via `cancel_pickup_route`, or assign real distinct vehicles — then re-run until it returns empty.

Historical note: spec-52 deliberately deferred this index for exactly this reason. During expand, blank and free-text labels ("Camión 1", "Ana") legitimately resolve to one shared vehicle row, and enforcing one-active-route-per-vehicle then would have blocked a second driver.

## Gate 2 — audit `vehicle_label` readers before dropping the column

```
grep -rn "vehicle_label" apps/ packages/ --include=*.ts --include=*.tsx --include=*.sql
```

Spec-52 moved every UI read to `vehicles.plate`, but `start_pickup_route` still **writes** `vehicle_label` so the column stays truthful during expand. Confirm nothing outside spec-52's own migrations reads it — including QA scripts, the worker, and `apps/agents` — before dropping.

## The checklist

Ordered. Each step is independently deployable; do not batch them into one migration.

| # | Change | Notes |
|---|---|---|
| 1 | `DROP FUNCTION public.start_pickup_route(TEXT)` and its `_get_or_create_unregistered_vehicle` helper | Nothing calls it — `useStartPickupRoute` sends `p_vehicle_id` since spec-52 Task 8 |
| 2 | Remove the `SIN-REGISTRO` exemption inside `start_pickup_route(UUID)` | During expand it accepts that one inactive vehicle so the blank-label path could delegate. With (1) gone, nothing needs it |
| 3 | `DROP FUNCTION public.close_pickup_route` and remove the `→ in_transit` branch of `trg_pickup_routes_status_sync` | **Only after** the reception UI is confirmed calling `open_route_reception` in production. Removing this while anything still uses the old path makes routes unable to reach reception at all |
| 4 | Delete `CloseRouteButton` + `useClosePickupRoute`, and rewrite the four spec47 tests that reach `in_transit` via a raw status flip | Those tests depend on the trigger branch removed in (3) |
| 5 | Add `uniq_pickup_routes_one_active_per_vehicle ON (operator_id, vehicle_id) WHERE status='in_progress' AND deleted_at IS NULL` | **Gate 1 must be empty first** |
| 6 | Stop writing `vehicle_label` in `start_pickup_route(UUID)`, then drop the column | **Gate 2 must be clean first**. Two separate deploys — stop writing, verify, then drop |
| 7 | Tighten `complete_route_reception` to the offsetting rule | `matched := received_count - unexpected_count`; require notes when `matched <> expected_count OR unexpected_count > 0`. Deferred from spec-52 migration 6 because the then-shipped UI could not see `unexpected_count` and a reception with an unexpected package would have been unfinishable. `FinalizeReceptionButton` has mirrored this rule since Task 11, so it is now safe |
| 8 | Flip cases 4-5 of `packages/database/supabase/tests/spec52_unexpected_count.sql` | They currently assert today's permissive behaviour and are marked `TASK 8:` in-file |

## Guard rails already in place

`20260812000005_spec52_receptionist_trigger.sql` carries deploy-time post-conditions that **abort the migration** if `close_pickup_route` or the trigger's `route_receptions` insert has already been removed. That tripwire exists to catch steps landing out of order — expect it to fire if you do (3) before its dependants are ready, and read it rather than working around it.

`scripts/check-migration-versions.sh` (CI) fails on duplicate migration version prefixes. Two collisions happened on 2026-08-13, one of which blocked production deploys for 43 minutes. Check the guard locally before choosing a number, and check `origin/main`, not just your branch — `ls | tail` shows the highest number on *your* branch, not the highest about to exist.

## Verification

- pgTAP suite green (29/29 at time of writing) after each step
- Frontend suite green; run with `--maxWorkers=4` — at default parallelism on some machines vitest workers die and files report "passed" with **zero** tests
- `apps/frontend/e2e/spec52-pickup-reception-end-to-end.spec.ts` must still pass. It is the only artifact that exercises the real screens against a real database, and it caught a production defect on its first run
- After (3): confirm in production that a route can still reach `received`

## Non-goals

- Any change to the pickup or reception UX. This spec only removes scaffolding
- Signed QR tokens — the payload is still a raw UUID with a sequential `PR-YYYY-NNNN` fallback. Real, worth its own spec
- The `drivers` ↔ `users` split — `pickup_routes.driver_id` still points at `users`
- Making the forward-only guard table-wide. `spec52_may_advance_status` protects the two scan paths only; seven other code paths write `packages.status` directly. Listed in spec-52's follow-ups; needs its own audit
