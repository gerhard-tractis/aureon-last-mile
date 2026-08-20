# Spec-61: Pickup route crew — a leader opens the route, the crew is added to it

> **Related:** [spec-52](spec-52-pickup-route-vehicle-and-state-engine.md) (route + vehicle model),
> [spec-56](spec-56-pickup-contract-phase.md) (per-vehicle uniqueness index),
> [spec-54](spec-54-ui-rebrand.md) (screens `3j` / `3h`)

**Status:** in progress

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

### The lead capability is a role

`pickup_leader`: every `pickup_crew` permission, plus route creation.

I recommended a permission on the existing vocabulary rather than a new value in
`user_role`, because that enum drives access across the whole app and the same person
may lead one shift and not the next. That was considered and overruled. It is a role.

Implementing it means touching `user_role`, the permission mapping in
`20260811000001_align_permission_vocabulary.sql`, and every place that switches on
role — including `isOperationsRole` in `components/sidebar/navigation.ts`, which
decides who gets the mobile tab bar. `pickup_leader` must be an operations role there,
or a leader loses mobile navigation entirely.

**How the grant happens — resolved.** An earlier draft claimed there was no admin
surface for roles. There is: `/admin` → `components/admin/UserForm.tsx`, which renders
`roleOptions` from `lib/validation/userSchema.ts:62-68`. Adding `pickup_leader` is an
option on an existing form, not a new screen.

Note the promoted user must re-login before the JWT claim refreshes — an operational
instruction, not an aside.

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

## Decided

All five open questions were answered on 2026-08-20. They are settled, not
suggestions.

1. **The crew cannot change once the route is open.** No joining late, no leaving.
   `removed_at` on the crew row therefore exists for correction and audit, not for
   an edit path in the UI — `3h` gets no crew editor.
2. **Crew can scan for as long as they are on the route.** This already works:
   the scan guard checks only that the manifest is on an `in_progress` route, and
   `pickup_scans.scanned_by_user_id` attributes every scan. No change needed.
3. **The driver still marks the end of collecting; the hub ends the route.**
   `close_pickup_route` stays as it is — it requires `in_progress` plus at least one
   verified scan and moves the route to `in_transit`, meaning "collected, on the way".
   Only reception takes it to `received`. This is the existing state machine and the
   design's `3h` / `3o`; nothing changes.
4. **A picker already on an active route cannot be added to another.** Refuse, with a
   message naming the route they are already on. Same rule the per-driver index
   already enforces for leaders.
5. **A new role, `pickup_leader`** — every `pickup_crew` permission plus route
   creation. I argued for a permission instead of a role, on the grounds that the
   enum drives access app-wide and the same person may lead one day and not the next.
   That was considered and overruled: it is a role. Implement it as one.

### What this makes measurable — already, with no new columns

The reason the hub ends the route is measurement: route length is only real once
reception actually starts. That timestamp already exists and already means the right
thing.

`route_receptions.started_at` is set when the reception status flips to `in_progress`,
or on the first `received` scan (`started_at = COALESCE(started_at, NOW())`). It is
**not** set when the driver closes — the row is created at close with `status='pending'`
and `started_at` NULL.

| Interval | Expression |
|---|---|
| Collecting | `pickup_routes.in_transit_at − pickup_routes.started_at` |
| In transit | `route_receptions.started_at − pickup_routes.in_transit_at` |
| Trip total | `route_receptions.started_at − pickup_routes.started_at` |
| Full cycle | `route_receptions.completed_at − pickup_routes.started_at` |

No migration is required for any of these. If route duration is to be *reported*, that
is a query over existing columns, not new state.

## Also fix, independent of the model

`get_pending_manifests` does not exclude manifests already attached to a route, so a
routed load still appears available to everyone. Two people can try to claim the same
load and the second gets a raw rejection from `add_manifest_to_route`. This is wrong
under any of the options above and should be corrected regardless.

## Implementation plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to
> implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**On the role, up front.** An earlier draft of this spec argued for a `pickup.lead`
permission token rather than a new `user_role` value, on the grounds that the enum drives
access app-wide and the same person may lead one shift and not the next. That was put to
the product owner and **overruled**: it is a role. See *The lead capability is a role*
above.

A separate correction landed with it: that draft also claimed there was no admin surface
for granting roles. There is — `/admin` → `UserForm` → `roleOptions`
(`lib/validation/userSchema.ts:62-68`) — so granting `pickup_leader` is an option on an
existing form, not a new screen. This plan implements the role.

### Verified against the code — cite these, do not re-derive

| Fact | Where |
|---|---|
| Live `start_pickup_route` takes `p_vehicle_id UUID`, is `SECURITY DEFINER`, and is the latest definition (no later migration redefines it) | `packages/database/supabase/migrations/20260812000003_spec52_pickup_routes_vehicle.sql:138-237` |
| The deprecated `start_pickup_route(p_vehicle_label TEXT DEFAULT NULL)` wrapper is still live (spec-56 drops it, and spec-56 is `backlog`) and delegates by calling the UUID form | same file, `:301-360` |
| `uniq_pickup_routes_one_active_per_driver` = `ON pickup_routes(operator_id, driver_id) WHERE status = 'in_progress' AND deleted_at IS NULL` — narrowed from spec-47's `status IN ('draft','in_progress')` | `20260812000003…:107-111`; original at `20260625000001_spec47_pickup_routes_consolidated_reception.sql:58-60` |
| The permission vocabulary migration maps role → permissions in **one place**: the `CASE v_role::text` inside `handle_new_user`. It is not a table, and no later migration redefines `handle_new_user` | `20260811000001_align_permission_vocabulary.sql:100-107` (grep for `handle_new_user` across migrations returns `20260209000002`, `20260209000003`, `20260216170542`, `20260616000002`, `20260811000001`; the last is newest) |
| Its frontend twin, which must move in the same commit | `apps/frontend/src/lib/permissions.ts:38-45` — its comment already says "change both together" |
| **Adding an enum value and using it in the same transaction is refused.** QA Postgres is 17.6.1 (`infra/supabase-qa/docker-compose.yml:400`), the local pgTAP image is 15.8 (`scripts/pgtap-local.sh:14`); the restriction (`unsafe use of new value … of enum type`) holds in both, and the Supabase CLI wraps each migration file in one transaction. **The migration must be split.** Precedents that already do: `20260616000001_spec45_user_role_super_admin.sql` (one `ALTER TYPE`, nothing else in the file) and `20260512000001_spec43_return_flow_enums.sql:3-8`, whose header states the rule | see cited files |
| `get_pending_manifests()` latest definition: `LANGUAGE sql STABLE SECURITY INVOKER`, returning `(id, external_load_id, retailer_name, order_count, package_count, created_at, pickup_point, verified_count, labels_printed_at, labels_printed_by_name)`; exclusion predicate is `o.external_load_id NOT IN (SELECT … WHERE m.status = 'completed' OR m.reception_status IS NOT NULL)` | `20260813000001_spec53_package_labels.sql:151-229`, predicate at `:182-187` |
| Its **only** caller is `usePendingManifests` → `app/app/pickup/page.tsx:79`, feeding `pendingRows` (desktop `1l` "Manifiestos" tab and mobile `3j`'s grouped list). No other hook, route, agent or worker calls it | `apps/frontend/src/hooks/pickup/useManifests.ts:53-67`; repo-wide grep for `get_pending_manifests` hits only that hook, its test, and doc/seed comments |
| Sibling pickup RLS shape — `FOR ALL USING (operator_id = get_operator_id()) WITH CHECK (…)` wrapped in `DO $$ … EXCEPTION WHEN duplicate_object`, plus `GRANT … TO authenticated`, `REVOKE ALL … FROM anon`, `GRANT ALL … TO service_role`, and an `audit_trigger_func` trigger | `20260812000001_spec52_vehicles_table.sql:33-49`; the `pickup_routes` equivalent at `20260625000001…:106-126` |
| `public.users` is SELECT-able by any authenticated user of the same operator, so the crew picker needs no new RPC | `20260216170542_create_users_table_with_rbac.sql:77-96` |
| The client's `role` comes from the JWT claim, not a query — **a role change only takes effect once the token refreshes (re-login)** | `apps/frontend/src/lib/context/GlobalContext.tsx:52-55`, read through `useOperatorId()` |
| `MOBILE_TAB_ROLES` is a literal `Set` of three strings; `isOperationsRole` is its only reader and `buildMobileTabs` returns `[]` for anything else — a role missing here gets **no mobile tab bar at all** | `apps/frontend/src/components/sidebar/navigation.ts:178-181, 209` |
| There are **four** role zod enums, not two: `app/api/users/route.ts:38`, `app/api/users/[id]/route.ts:10`, and `lib/validation/userSchema.ts:30` and `:42`. `UserForm.tsx` holds no role list of its own — it renders `roleOptions` (`lib/validation/userSchema.ts:62-68`) | see cited files |
| `Database` types are **hand-maintained**, not generated: `start_pickup_route` is typed `Args: { p_vehicle_id: string }` | `apps/frontend/src/lib/types.ts:1924-1930` |
| `create-qa-users.sh` seeds six roles from a `ROLE_ROWS` table with fixed UUIDs (`…0201`–`…0206`) | `infra/supabase-qa/create-qa-users.sh:99-104` |
| **`create-qa-users.sh` does NOT run on deploy** — `deploy-qa.sh:175` deliberately leaves it in `setup-qa.sh:195`, the one-time bootstrap. Adding a row to the script does not create the user in QA; someone must run it on the VPS | cited files, plus `docs/qa-environment.md:196, 270` |
| QA's whole pickup scenario is built around `qa-pickup-crew@qa.test` (`…0201`) having **no** active route so it lands on `3j` — that is precisely the account this spec blocks | `packages/database/supabase/seed-qa.sql:326-340, 688-693`; login table at `docs/qa-environment.md:131-140` |
| The nav badge counts pickup work from `manifests.status IN ('pending','in_progress')` and never calls `get_pending_manifests` — Task 7 does not move it | `20260817000001_spec54_nav_counts.sql:43-49` |
| CI runs no SQL. DB assertions run through the local docker harness; its `run` marks a test failed when the output contains `ERROR` | `scripts/pgtap-local.sh:2-4, 118-133` |
| Migration version prefixes must be unique or every deploy aborts | `scripts/check-migration-versions.sh` |

### Decisions this plan makes

Items 1-5 restate what `## Decided` above settles, kept here so a task can be
read without scrolling. Items 6-9 are implementation choices this plan makes.

1. **Crew is fixed at creation.** No `add_crew_to_route`, no edit path on `3h` (Task 6 says
   so). `removed_at` is therefore written by exactly one thing — the route-status trigger in
   Task 1.2 — which is what makes the partial unique index expressible without a subquery.
2. **Crew may scan without the leader.** Unchanged: nothing checks today, and the spec's
   *What already works* paragraph is explicit that multi-person scanning is already correct.
3. **Anyone on the route may close it.** Unchanged: `close_pickup_route`
   (`20260625000001…:402`) is not owner-restricted today and this spec does not touch it.
   Crew who reach `3h` inherit the same footer actions the leader has — that is the point of
   putting them on the route.
4. **A picker already on another trip is refused, naming that route** (Task 2), matching the
   leader constraint. Never silently moved.
5. **`pickup_leader` is granted through `/admin` → `UserForm`**, the surface that already
   exists for roles. No new screen.
6. **Who else may open a route:** `pickup_leader`, `operations_manager`, `admin`,
   `super_admin`. Today anyone holding the `pickup` permission can, and managers and admins
   hold it (`permissions.ts:42-44`) — narrowing the gate to `pickup_leader` alone would lock
   working accounts out of a flow they have today. Only `pickup_crew`, `warehouse_staff` and
   `loading_crew` lose it, and `pickup_crew` losing it *is* the spec.
7. **The leader is not a crew row.** `pickup_routes.driver_id` means the leader (spec's Data
   model). Consequence: the partial unique index cannot see leader/crew overlap across the
   two tables, so the RPC checks both. Stated as a residual gap in Task 2 rather than papered
   over.
8. **"My route" is resolved by a new RPC**, `get_my_active_pickup_route()`, not by a
   PostgREST query. `useActivePickupRoute` today filters `driver_id = auth.uid()`
   (`useActivePickupRoute.ts:48`); "leader OR active crew" is an `OR` across a join, and
   PostgREST's `.or()` cannot express a parent filter that depends on an embedded table
   without either two round-trips or an `!inner` join that silently drops leader-only routes.
   One RPC keeps it to one query — and it carries the crew list `3h` needs (Task 6) in the
   same payload.
9. **The nav badge and the Recogida list will disagree after Task 7** — the badge counts every
   `pending`/`in_progress` manifest for the operator, the list stops showing routed ones. Both
   are right: the badge is the operator's outstanding workload, the list is what *you* can
   still claim. Not changed here; noted so the next reader does not "fix" it.

### Environment and commands

```
Frontend tests   cd apps/frontend && npx vitest run <path> --maxWorkers=2
Types            cd apps/frontend && npx tsc --noEmit
Lint             cd apps/frontend && npx eslint <path>
DB (local only)  ./scripts/pgtap-local.sh up            # first time only, ~2 min
                 ./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh apply
                 ./scripts/pgtap-local.sh run <test-basename>
```

`--maxWorkers=2` is not optional — full-parallel vitest flakes on this machine. CI runs the
frontend suite; **CI runs no SQL at all**, so every DB task's proof is the local harness, and
the QA VPS replaying the migration ledger on merge (`deploy.yml`, job `deploy-qa`) is the only
automated check that these migrations apply to a real database.

### File structure

**Database** — `packages/database/supabase/migrations/`

| File | Responsibility |
|---|---|
| `20260820000001_spec61_user_role_pickup_leader.sql` | **Create.** One statement: `ALTER TYPE public.user_role ADD VALUE`. Nothing else may go in this file. |
| `20260820000002_spec61_pickup_route_crew.sql` | **Create.** `pickup_route_crew` table, indexes, the partial unique index, RLS/grants/audit trigger, the route-status → `removed_at` trigger, and `handle_new_user` re-templated with the `pickup_leader` branch. |
| `20260820000003_spec61_start_pickup_route_crew.sql` | **Create.** `DROP FUNCTION start_pickup_route(UUID)` and recreate it as `(p_vehicle_id UUID, p_crew_user_ids UUID[] DEFAULT '{}')` with the leader gate and the crew insert. |
| `20260820000004_spec61_my_active_pickup_route.sql` | **Create.** `get_my_active_pickup_route()` — the route I lead or am active crew on, with plate, leader name and crew, in one round trip. |
| `20260820000005_spec61_pending_manifests_exclude_routed.sql` | **Create.** `get_pending_manifests()` re-templated with routed loads excluded. |

**Database tests** — `packages/database/supabase/tests/` (all **create**)

`spec61_user_role_pickup_leader.sql` · `spec61_pickup_route_crew.sql` ·
`spec61_start_route_leader_gate.sql` · `spec61_my_active_route.sql` ·
`spec61_pending_excludes_routed.sql`

**Frontend** — `apps/frontend/src/`

| File | Responsibility |
|---|---|
| `lib/types/auth.types.ts` | **Modify** `:15-33` (enum member) and `:198-207` — `getRoleDisplayName`'s `Record<UserRole, string>` fails to compile until updated, which is Task 3's first test. |
| `lib/permissions.ts` | **Modify** `:38-45`; **add** `ROUTE_LEADER_ROLES` and `canLeadPickupRoute()`. The single place the UI asks "may this person open a route?". |
| `lib/permissions.test.ts` | **Create.** Pins `ROLE_DEFAULT_PERMISSIONS` against the migration and pins `canLeadPickupRoute`. |
| `lib/validation/userSchema.ts` | **Modify** `:28`, `:42`, `:62-68`. |
| `app/api/users/route.ts` | **Modify** `:38`. |
| `app/api/users/[id]/route.ts` | **Modify** `:10`. |
| `components/sidebar/navigation.ts` | **Modify** `:178`; **add** an exported `OPERATIONS_ROLES` so the test can assert the set instead of restating it. |
| `components/sidebar/navigation.test.ts` | **Modify** `:271-284`. |
| `lib/types.ts` | **Modify** `:1927-1930` (`start_pickup_route.Args`); **add** `pickup_route_crew` and `get_my_active_pickup_route`. Hand-maintained — there is no codegen step. |
| `hooks/pickup/useActivePickupRoute.ts` | **Modify.** Same exported types, now fed by the RPC, plus `crew`. |
| `hooks/pickup/useActivePickupRoute.test.ts` | **Modify.** The `from()` chain mock becomes an `rpc` mock. |
| `hooks/pickup/useStartPickupRoute.ts` | **Modify.** Sends `p_crew_user_ids`. |
| `hooks/pickup/useCrewCandidates.ts` + `.test.ts` | **Create.** The operator's users who may be crew. |
| `components/pickup/CrewSelect.tsx` + `.test.tsx` | **Create.** `3j`'s crew picker (~90 lines). |
| `components/pickup/PickupMobileNoRoute.tsx` + `.test.tsx` | **Create.** What crew without a route see (~40 lines). |
| `components/pickup/PickupMobileView.tsx` | **Modify.** Three-way branch: route → `3h`; leader → `3j`; crew → `PickupMobileNoRoute`. |
| `components/pickup/PickupMobileStartRoute.tsx` | **Modify.** Adds `CrewSelect`; `onCreateRoute(vehicleId, crewIds)`. It is 233 lines, so the picker lives in its own component to stay under 300. |
| `components/pickup/PickupRouteCrewStrip.tsx` + `.test.tsx` | **Create.** `3h`'s read-only "who is on this trip" strip (~50 lines). |
| `components/pickup/PickupMobileActiveRoute.tsx` | **Modify.** Renders the strip. 182 lines today. |
| `components/pickup/PickupRouteDraftPanel.tsx` | **Modify.** Desktop `1l`: no start affordance for a non-leader. |
| `components/pickup/PickupDesktopView.tsx` | **Modify** `:193`. Threads `canLead` through. |
| `app/app/pickup/page.tsx` | **Modify** `:87-89` and `:183-210`. Threads `crewIds` into `handleCreateRoute`. 299 lines — add nothing beyond what the plan says. |

**QA and docs**

| File | Responsibility |
|---|---|
| `infra/supabase-qa/create-qa-users.sh` | **Modify** `:99-104`. Adds `pickup_leader` (fixed id `…0207`). |
| `docs/qa-environment.md` | **Modify** `:131-140`. The login table. |
| `packages/database/supabase/seed-qa.sql` | **Modify** `:326-340`. Comment only: which QA account now walks `3j`. |

## Chunk 1 — Database: the role, the crew table, the RPCs

Self-contained. Nothing in the frontend changes here, and nothing here changes what any
existing screen does *except* one thing: once Task 2 merges, `pickup_crew` accounts can no
longer open a route. Task 2's last step ships the QA leader in the same commit for exactly
that reason.

Before starting: `./scripts/pgtap-local.sh up` (once), then `./scripts/pgtap-local.sh sync`
and `./scripts/pgtap-local.sh apply`. Expect `migrations: applied=N skipped=M failed=0`.

### Task 1.1: `pickup_leader` on the `user_role` enum, alone in its own migration

**Files:**
- Create: `packages/database/supabase/tests/spec61_user_role_pickup_leader.sql`
- Create: `packages/database/supabase/migrations/20260820000001_spec61_user_role_pickup_leader.sql`

- [ ] **Step 1: Write the failing test**

      `packages/database/supabase/tests/spec61_user_role_pickup_leader.sql`:

      ```sql
      -- spec-61 Task 1.1 — user_role carries pickup_leader.
      BEGIN;

      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum e
            JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = 'user_role' AND e.enumlabel = 'pickup_leader'
        ) THEN
          RAISE EXCEPTION 'user_role has no pickup_leader value';
        END IF;
      END $$;

      -- The value must be usable as a value, not merely present in the catalog.
      DO $$
      DECLARE v public.user_role;
      BEGIN
        v := 'pickup_leader'::public.user_role;
        IF v::text <> 'pickup_leader' THEN
          RAISE EXCEPTION 'cast round-trip failed: %', v;
        END IF;
      END $$;

      ROLLBACK;
      ```

- [ ] **Step 2: Run it, verify it fails**

      Run: `./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh run spec61_user_role_pickup_leader`
      Expected: `FAIL` with `ERROR: user_role has no pickup_leader value`

- [ ] **Step 3: Minimal implementation**

      `packages/database/supabase/migrations/20260820000001_spec61_user_role_pickup_leader.sql`:

      ```sql
      -- =============================================================================
      -- spec-61 Task 1 — add `pickup_leader` to public.user_role
      -- =============================================================================
      -- IRREVERSIBLE. Postgres cannot remove a value from an enum. Undoing this means
      -- rebuilding the type and every column, default, cast and RLS predicate that
      -- reads it. Do not merge it on the assumption it can be walked back.
      --
      -- THIS FILE CONTAINS ONE STATEMENT AND MUST STAY THAT WAY. The Supabase CLI
      -- wraps each migration file in a single transaction, and Postgres refuses to
      -- USE an enum value added by that same transaction:
      --     ERROR: unsafe use of new value "pickup_leader" of enum type user_role
      -- (the exemption is only for a type created in the same transaction). QA runs
      -- Postgres 17.6.1 (infra/supabase-qa/docker-compose.yml:400) and the local
      -- pgTAP harness runs 15.8 (scripts/pgtap-local.sh:14); the rule is the same in
      -- both. Precedents: 20260616000001 (super_admin, also alone in its file) and
      -- 20260512000001 (spec-43), whose header states the same rule.
      --
      -- AUTH SURFACE. `user_role` is read by RLS policies (e.g.
      -- 20260216170542_create_users_table_with_rbac.sql:86 restricts writes to
      -- admin/operations_manager) and by the JWT claims hook. Adding a value changes
      -- no existing row and no existing policy: every current user keeps their role
      -- and every predicate that names roles explicitly keeps the same answer. That
      -- is why this migration is additive-only and touches nothing else.
      --
      -- The NEXT migration (20260820000002) is free to write 'pickup_leader'.
      -- =============================================================================

      ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'pickup_leader';
      ```

- [ ] **Step 4: Run it, verify it passes**

      Run: `./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh apply && ./scripts/pgtap-local.sh run spec61_user_role_pickup_leader`
      Expected: `migrations: applied=1 …` then `spec61_user_role_pickup_leader   PASS`

- [ ] **Step 5: Prove the split was necessary (30 seconds, do not skip)**

      Run:
      ```
      ./scripts/pgtap-local.sh psql -c "BEGIN; ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'tmp_probe'; SELECT 'tmp_probe'::public.user_role; ROLLBACK;"
      ```
      Expected: `ERROR: unsafe use of new value "tmp_probe" of enum type user_role`.
      If this ever stops erroring on the target version, the two migrations may be merged —
      until then they may not. (The `ROLLBACK` leaves no trace of `tmp_probe`.)

- [ ] **Step 6: Commit**

      ```
      git add packages/database/supabase/migrations/20260820000001_spec61_user_role_pickup_leader.sql packages/database/supabase/tests/spec61_user_role_pickup_leader.sql
      git commit -m "feat(spec-61): add pickup_leader to the user_role enum

      Alone in its own migration: Postgres refuses to use an enum value added by
      the same transaction, and the Supabase CLI wraps each file in one. Adding a
      value is irreversible -- the file header says so."
      ```

### Task 1.2: `pickup_route_crew`, its RLS, its one-active-seat index, and the permission default

**Files:**
- Create: `packages/database/supabase/tests/spec61_pickup_route_crew.sql`
- Create: `packages/database/supabase/migrations/20260820000002_spec61_pickup_route_crew.sql`

The partial unique index the spec asks for cannot contain a subquery — Postgres forbids
subqueries in index predicates. So `removed_at` carries the route's activeness instead, and a
trigger on `pickup_routes` keeps it truthful. That is legitimate only because the crew is
fixed at creation (Decision 1): `removed_at` has exactly one writer.

- [ ] **Step 1: Write the failing test**

      `packages/database/supabase/tests/spec61_pickup_route_crew.sql`:

      ```sql
      -- spec-61 Task 1.2 — pickup_route_crew: shape, RLS, one active seat per person,
      -- and removed_at tracking the route's status.
      BEGIN;

      INSERT INTO public.operators (id, name, slug)
      VALUES ('aaaaaaaa-0000-4000-a000-000000000610','Spec61 Crew','spec61-crew')
      ON CONFLICT (slug) DO NOTHING;

      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, recovery_token
      ) VALUES
        ('aaaaaaaa-0000-4000-a000-000000000611','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','leader@spec61.test', crypt('x', gen_salt('bf')), NOW(),
         '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"pickup_leader"}'::jsonb,
         '{"full_name":"Lider Uno"}'::jsonb, NOW(), NOW(), '', ''),
        ('aaaaaaaa-0000-4000-a000-000000000612','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','crew@spec61.test', crypt('x', gen_salt('bf')), NOW(),
         '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"pickup_crew"}'::jsonb,
         '{"full_name":"Ana Perez"}'::jsonb, NOW(), NOW(), '', '')
      ON CONFLICT (id) DO NOTHING;

      -- DO UPDATE, not DO NOTHING: handle_new_user() already created these rows
      -- (same pattern as tests/spec47_single_active_route_per_driver.sql:23).
      INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
        ('aaaaaaaa-0000-4000-a000-000000000611','aaaaaaaa-0000-4000-a000-000000000610',
         'pickup_leader','leader@spec61.test','Lider Uno',ARRAY['pickup']),
        ('aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000610',
         'pickup_crew','crew@spec61.test','Ana Perez',ARRAY['pickup'])
      ON CONFLICT (id) DO UPDATE
        SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
            full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

      INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
        ('99999999-0000-4000-9000-000000000611','aaaaaaaa-0000-4000-a000-000000000610','VEH-61-1', true),
        ('99999999-0000-4000-9000-000000000612','aaaaaaaa-0000-4000-a000-000000000610','VEH-61-2', true)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status) VALUES
        ('77777777-0000-4000-7000-000000000611','aaaaaaaa-0000-4000-a000-000000000610',
         'PR-61-A','aaaaaaaa-0000-4000-a000-000000000611','99999999-0000-4000-9000-000000000611','in_progress');

      -- 1. RLS is on and the tenant policy exists (sibling shape: vehicles, pickup_routes).
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='pickup_route_crew' AND relrowsecurity) THEN
          RAISE EXCEPTION 'pickup_route_crew does not have RLS enabled';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies
                        WHERE tablename='pickup_route_crew'
                          AND policyname='pickup_route_crew_tenant_isolation') THEN
          RAISE EXCEPTION 'pickup_route_crew_tenant_isolation policy missing';
        END IF;
      END $$;

      -- 2. A crew seat can be taken.
      INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
      VALUES ('aaaaaaaa-0000-4000-a000-000000000610','77777777-0000-4000-7000-000000000611',
              'aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000611');

      -- 3. The same person cannot hold a second active seat, and the named index says so.
      INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
      VALUES ('77777777-0000-4000-7000-000000000613','aaaaaaaa-0000-4000-a000-000000000610',
              'PR-61-B','aaaaaaaa-0000-4000-a000-000000000611','99999999-0000-4000-9000-000000000612','received');

      DO $$
      DECLARE rejected BOOLEAN := FALSE; con TEXT := '';
      BEGIN
        BEGIN
          INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
          VALUES ('aaaaaaaa-0000-4000-a000-000000000610','77777777-0000-4000-7000-000000000613',
                  'aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000611');
        EXCEPTION WHEN unique_violation THEN
          rejected := TRUE; GET STACKED DIAGNOSTICS con = CONSTRAINT_NAME;
        END;
        IF NOT rejected THEN
          RAISE EXCEPTION 'a second active crew seat for the same person should have been rejected';
        END IF;
        IF con <> 'uniq_pickup_route_crew_one_active_per_user' THEN
          RAISE EXCEPTION 'expected uniq_pickup_route_crew_one_active_per_user, got %', con;
        END IF;
      END $$;

      -- 4. Closing the route frees the seat (removed_at stamped by the trigger).
      UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
       WHERE id = '77777777-0000-4000-7000-000000000611';

      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM public.pickup_route_crew
                    WHERE pickup_route_id='77777777-0000-4000-7000-000000000611'
                      AND removed_at IS NULL) THEN
          RAISE EXCEPTION 'crew of a closed route should have been stamped removed_at';
        END IF;
      END $$;

      INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
      VALUES ('aaaaaaaa-0000-4000-a000-000000000610','77777777-0000-4000-7000-000000000613',
              'aaaaaaaa-0000-4000-a000-000000000612','aaaaaaaa-0000-4000-a000-000000000611');

      -- 5. Reopening restores only seats whose holder is free (a reopen must never
      --    abort on a 23505 -- reopen_pickup_route is the receptionist's undo).
      UPDATE public.pickup_routes SET status = 'in_progress'
       WHERE id = '77777777-0000-4000-7000-000000000611';

      DO $$
      DECLARE n INT;
      BEGIN
        SELECT count(*) INTO n FROM public.pickup_route_crew
         WHERE user_id='aaaaaaaa-0000-4000-a000-000000000612' AND removed_at IS NULL;
        IF n <> 1 THEN
          RAISE EXCEPTION 'exactly one active seat expected after reopen, found %', n;
        END IF;
      END $$;

      -- 6. handle_new_user gives a pickup_leader the pickup permission.
      DO $$
      DECLARE v_perms TEXT[];
      BEGIN
        INSERT INTO auth.users (
          id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
          confirmation_token, recovery_token
        ) VALUES (
          'aaaaaaaa-0000-4000-a000-000000000619','00000000-0000-0000-0000-000000000000',
          'authenticated','authenticated','fresh-leader@spec61.test',
          crypt('x', gen_salt('bf')), NOW(),
          '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000610","role":"pickup_leader"}'::jsonb,
          '{"full_name":"Lider Nuevo"}'::jsonb, NOW(), NOW(), '', ''
        );
        SELECT permissions INTO v_perms FROM public.users
         WHERE id = 'aaaaaaaa-0000-4000-a000-000000000619';
        IF NOT ('pickup' = ANY(v_perms)) THEN
          RAISE EXCEPTION 'a new pickup_leader must get the pickup permission, got %', v_perms;
        END IF;
      END $$;

      ROLLBACK;
      ```

- [ ] **Step 2: Run it, verify it fails**

      Run: `./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh run spec61_pickup_route_crew`
      Expected: `FAIL` with `ERROR: pickup_route_crew does not have RLS enabled`.
      Not "relation does not exist" — the script's first assertion is the
      `pg_class.relrowsecurity` check, which raises its own message before anything
      queries the table.

- [ ] **Step 3: Minimal implementation — the table, the index, the trigger**

      `packages/database/supabase/migrations/20260820000002_spec61_pickup_route_crew.sql`:

      ```sql
      -- =============================================================================
      -- spec-61 Task 1 — pickup_route_crew, and pickup_leader's permission default
      -- =============================================================================
      -- Several people work one pickup trip. `pickup_routes.driver_id` keeps meaning
      -- THE LEADER and is unchanged; everyone else on the trip is a row here.
      --
      -- Depends on 20260820000001 having COMMITTED (it adds 'pickup_leader' to
      -- user_role, which the handle_new_user CASE below names). Separate files, not
      -- style: see that file's header.
      --
      -- Safe on live data: a brand-new table has no rows, so the unique index below
      -- cannot abort the deploy the way a constraint over existing rows can (the
      -- spec-56 lesson). Nothing existing is altered except the handle_new_user
      -- function body, which only affects users created AFTER this runs.
      -- =============================================================================

      BEGIN;

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

      COMMENT ON TABLE public.pickup_route_crew IS
        'Who besides the leader is on a pickup trip (spec-61). The leader is '
        'pickup_routes.driver_id and is deliberately NOT a row here. The crew is '
        'fixed when the route opens: start_pickup_route inserts these rows in the '
        'same transaction as the route and nothing else ever inserts one.';

      COMMENT ON COLUMN public.pickup_route_crew.removed_at IS
        'Set when the route stops being in_progress, by trg_pickup_route_crew_sync. '
        'It is the ACTIVE-SEAT marker that uniq_pickup_route_crew_one_active_per_user '
        'reads -- an index predicate cannot contain a subquery, so the route''s '
        'activeness has to live on the crew row. Do not write it by hand.';

      CREATE INDEX IF NOT EXISTS idx_pickup_route_crew_route
        ON public.pickup_route_crew(pickup_route_id);
      CREATE INDEX IF NOT EXISTS idx_pickup_route_crew_user
        ON public.pickup_route_crew(operator_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_pickup_route_crew_deleted_at
        ON public.pickup_route_crew(deleted_at);

      -- One active seat per person per operator -- the crew twin of
      -- uniq_pickup_routes_one_active_per_driver (20260812000003:109).
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_pickup_route_crew_one_active_per_user
        ON public.pickup_route_crew(operator_id, user_id)
        WHERE removed_at IS NULL AND deleted_at IS NULL;

      -- ── removed_at follows the route's status ──────────────────────────────────
      -- One trigger instead of edits to close_pickup_route / cancel_pickup_route /
      -- complete_route_reception / reopen_pickup_route / the receptionist trigger:
      -- they all write pickup_routes.status, and a new closing path cannot forget it.
      CREATE OR REPLACE FUNCTION public.sync_pickup_route_crew_seats()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public
      AS $$
      BEGIN
        IF NEW.deleted_at IS NOT NULL OR NEW.status <> 'in_progress' THEN
          UPDATE public.pickup_route_crew
             SET removed_at = NOW()
           WHERE pickup_route_id = NEW.id
             AND removed_at IS NULL
             AND deleted_at IS NULL;
          RETURN NEW;
        END IF;

        -- Back to in_progress (reopen_pickup_route, 20260812000005:185, and the
        -- receptionist trigger's undo). Restore only seats whose holder is not
        -- already active somewhere else: a raw restore would hit the unique index
        -- and abort the receptionist's reopen with a 23505 on someone else's data.
        UPDATE public.pickup_route_crew c
           SET removed_at = NULL
         WHERE c.pickup_route_id = NEW.id
           AND c.removed_at IS NOT NULL
           AND c.deleted_at IS NULL
           AND NOT EXISTS (
                 SELECT 1 FROM public.pickup_route_crew o
                  WHERE o.operator_id = c.operator_id
                    AND o.user_id     = c.user_id
                    AND o.removed_at IS NULL
                    AND o.deleted_at IS NULL);
        RETURN NEW;
      END $$;

      DROP TRIGGER IF EXISTS trg_pickup_route_crew_sync ON public.pickup_routes;
      CREATE TRIGGER trg_pickup_route_crew_sync
        AFTER UPDATE ON public.pickup_routes
        FOR EACH ROW
        WHEN (OLD.status IS DISTINCT FROM NEW.status
              OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
        EXECUTE FUNCTION public.sync_pickup_route_crew_seats();

      -- ── RLS: the sibling shape (20260812000001:33-49) ──────────────────────────
      ALTER TABLE public.pickup_route_crew ENABLE ROW LEVEL SECURITY;

      DO $$ BEGIN
        CREATE POLICY pickup_route_crew_tenant_isolation ON public.pickup_route_crew
          FOR ALL USING (operator_id = public.get_operator_id())
          WITH CHECK (operator_id = public.get_operator_id());
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- SELECT only, deliberately. Nothing in the frontend writes this table:
      -- start_pickup_route and the route-status trigger are both SECURITY
      -- DEFINER and bypass these grants. Granting INSERT/UPDATE here would let
      -- any authenticated user of the operator seat themselves on any route
      -- over PostgREST, or UPDATE removed_at to free their own seat — which
      -- would falsify the "exactly one writer" property the one-active-seat
      -- index depends on. vehicles grants INSERT/UPDATE because it IS written
      -- from the UI; this table is not, so do not copy that shape.
      GRANT SELECT ON public.pickup_route_crew TO authenticated;
      REVOKE ALL ON public.pickup_route_crew FROM anon;
      GRANT ALL ON public.pickup_route_crew TO service_role;

      DO $$ BEGIN
        CREATE TRIGGER audit_pickup_route_crew_changes
          AFTER INSERT OR UPDATE OR DELETE ON public.pickup_route_crew
          FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      COMMIT;
      ```

- [ ] **Step 4: Same migration — `handle_new_user` gains the `pickup_leader` branch**

      Append **inside the same `BEGIN … COMMIT`**, before `COMMIT`. Template: the live
      definition at `20260811000001_align_permission_vocabulary.sql:70-127` — copied
      verbatim, one `WHEN` line added. Per CLAUDE.md, never template from the original
      `20260216170542`.

      ```sql
      -- ── Role defaults: pickup_leader ───────────────────────────────────────────
      -- Template: the LIVE definition, 20260811000001_align_permission_vocabulary.sql:70.
      -- The only change is the pickup_leader line. A leader does the same work as
      -- pickup_crew plus route creation, and route creation is gated by ROLE in
      -- start_pickup_route (20260820000003), not by a permission token -- so the
      -- permission set is identical to pickup_crew's on purpose.
      -- Its frontend twin is ROLE_DEFAULT_PERMISSIONS in
      -- apps/frontend/src/lib/permissions.ts:38 -- change both together.
      CREATE OR REPLACE FUNCTION public.handle_new_user()
      RETURNS TRIGGER
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path TO 'public'
      AS $function$
      DECLARE
        v_operator_id UUID;
        v_role user_role;
        v_full_name VARCHAR(255);
        v_permissions TEXT[];
      BEGIN
        v_operator_id := (NEW.raw_app_meta_data->>'operator_id')::uuid;

        IF v_operator_id IS NULL THEN
          RAISE EXCEPTION 'User creation failed: operator_id required in signup metadata';
        END IF;

        v_role := COALESCE((NEW.raw_app_meta_data->>'role')::user_role, 'pickup_crew');
        v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);

        v_permissions := CASE v_role::text
          WHEN 'pickup_crew'        THEN ARRAY['pickup']
          WHEN 'pickup_leader'      THEN ARRAY['pickup']
          WHEN 'warehouse_staff'    THEN ARRAY['reception','distribution']
          WHEN 'loading_crew'       THEN ARRAY['distribution','dispatch']
          WHEN 'operations_manager' THEN ARRAY['pickup','reception','distribution','dispatch','customer_service']
          WHEN 'admin'              THEN ARRAY['pickup','reception','distribution','dispatch','customer_service','admin']
          WHEN 'super_admin'        THEN ARRAY['pickup','reception','distribution','dispatch','customer_service','admin']
          ELSE ARRAY[]::text[]
        END;

        INSERT INTO public.users (id, operator_id, role, email, full_name, permissions)
        VALUES (NEW.id, v_operator_id, v_role, NEW.email, v_full_name, v_permissions);

        RETURN NEW;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE EXCEPTION 'User creation failed: %', SQLERRM;
      END;
      $function$;
      ```

      Note the `CASE v_role::text` — the branch compares **text**, so this file never writes
      an enum literal of the value added by the previous migration. The cast in the test does,
      which is why the test lives in a separate transaction from the `ALTER TYPE`.

- [ ] **Step 5: Run it, verify it passes**

      Run: `./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh apply && ./scripts/pgtap-local.sh run spec61_pickup_route_crew`
      Expected: `migrations: applied=1 …` then `spec61_pickup_route_crew   PASS`

- [ ] **Step 6: Re-run the whole pickup DB suite — nothing else may move**

      Run:
      ```
      ./scripts/pgtap-local.sh run spec47_single_active_route_per_driver spec47_pickup_routes_rls \
        spec47_close_route_creates_route_reception spec47_cancel_route_detaches_manifests \
        spec52_state_engine spec52_reopen_route spec52_route_lock spec52_vehicle_constraints \
        rbac_users_test
      ```
      Expected: `── pass=9 fail=0 ──`. `spec52_reopen_route` is the one that would catch a
      trigger that aborts a reopen.

- [ ] **Step 7: Commit**

      ```
      git add packages/database/supabase/migrations/20260820000002_spec61_pickup_route_crew.sql packages/database/supabase/tests/spec61_pickup_route_crew.sql
      git commit -m "feat(spec-61): pickup_route_crew table, RLS and one-active-seat index

      removed_at carries the route's activeness because an index predicate cannot
      hold a subquery; one AFTER UPDATE trigger on pickup_routes keeps it truthful
      across every closing path, and restores seats on reopen only when the holder
      is free so the receptionist's undo can never abort on a 23505.
      handle_new_user gains the pickup_leader branch, templated on the live
      definition in 20260811000001."
      ```

### Task 2: `start_pickup_route` — leader gate, crew in the same transaction, and a QA leader

**Rollout — read before writing the migration. Decided 2026-08-20.**

The gate cannot simply be switched on. This repo deploys the database ahead of the
frontend (`deploy.yml`: `deploy-vercel` `needs: [… deploy-supabase]`). The moment the
gate lands:

- every existing `pickup_crew` account is refused by it;
- **nobody holds `pickup_leader`** — the enum value is brand new;
- the only surface that grants it, `roleOptions`, does not exist until the *frontend*
  chunk deploys, i.e. afterwards;
- and a promoted user must re-login before the claim refreshes.

So without a backfill, pickup is **down in production** from DB-deploy until
frontend-deploy plus admin grants plus a re-login per driver.

**The decision: the same migration promotes every existing `pickup_crew` user to
`pickup_leader`.** Nothing breaks at the moment it lands — everyone can open a route
exactly as they can today — and the operator then demotes people to crew deliberately,
through the admin UI, as they decide who leads. Safe by default, tightened by choice.

```sql
-- Backfill BEFORE the gate is enforced, in the same migration, so there is no
-- window in which a working account is refused.
UPDATE public.users
   SET role = 'pickup_leader'
 WHERE role = 'pickup_crew'
   AND deleted_at IS NULL;
```

Consequences to carry into the steps below:

- The promotion must also apply the `pickup_leader` permission default, or a promoted
  user is bounced by `_client-gate` despite holding the role. Assert this in the test —
  the role alone is not sufficient.
- Promoted users still need a re-login for the JWT claim to refresh. State it in the
  step; it is a real operational instruction, not an aside.
- **Back-out:** a follow-up migration widening the gate's whitelist to include
  `pickup_crew` restores the previous behaviour without touching data or the enum. Name
  it in the migration header — the enum value itself cannot be removed.
- QA: the `pickup_leader` row added to `create-qa-users.sh` is still needed for a *fresh*
  QA, but the backfill means the existing `qa-pickup-crew` account keeps working through
  the deploy. Do not rely on the backfill for a new environment.

**Files:**
- Create: `packages/database/supabase/tests/spec61_start_route_leader_gate.sql`
- Create: `packages/database/supabase/migrations/20260820000003_spec61_start_pickup_route_crew.sql`
- Modify: `infra/supabase-qa/create-qa-users.sh:99-104`
- Modify: `docs/qa-environment.md:131-140`
- Modify: `packages/database/supabase/seed-qa.sql:326-340` (comment only)

Signature decision, and it matters: `CREATE OR REPLACE` cannot add a parameter, and creating
`(UUID, UUID[] DEFAULT '{}')` **beside** the existing `(UUID)` makes `start_pickup_route(p_vehicle_id => …)`
ambiguous — Postgres raises `function public.start_pickup_route(p_vehicle_id => uuid) is not unique`
and the current frontend breaks the moment the DB chunk deploys. So the one-argument form is
**dropped** and replaced by the two-argument form with a default, which the existing
one-argument call sites (the frontend, and the TEXT wrapper's internal call at
`20260812000003…:346`) still resolve to unchanged. `DROP FUNCTION` also drops its `GRANT`, so
the grant is reissued below.

- [ ] **Step 1: Write the failing test**

      `packages/database/supabase/tests/spec61_start_route_leader_gate.sql`:

      ```sql
      -- spec-61 Task 2 — only a leader may open a route; the crew lands in the same
      -- transaction; a picker already on a trip is refused by name.
      BEGIN;

      INSERT INTO public.operators (id, name, slug)
      VALUES ('aaaaaaaa-0000-4000-a000-000000000620','Spec61 Gate','spec61-gate')
      ON CONFLICT (slug) DO NOTHING;

      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token
      ) VALUES
        ('aaaaaaaa-0000-4000-a000-000000000621','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','gate-leader@spec61.test', crypt('x', gen_salt('bf')), NOW(),
         '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620","role":"pickup_leader"}'::jsonb,
         '{"full_name":"Lider Gate"}'::jsonb, NOW(), NOW(), '', ''),
        ('aaaaaaaa-0000-4000-a000-000000000622','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','gate-crew@spec61.test', crypt('x', gen_salt('bf')), NOW(),
         '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620","role":"pickup_crew"}'::jsonb,
         '{"full_name":"Ana Perez"}'::jsonb, NOW(), NOW(), '', ''),
        ('aaaaaaaa-0000-4000-a000-000000000623','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','gate-leader2@spec61.test', crypt('x', gen_salt('bf')), NOW(),
         '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620","role":"pickup_leader"}'::jsonb,
         '{"full_name":"Lider Dos"}'::jsonb, NOW(), NOW(), '', '')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
        ('aaaaaaaa-0000-4000-a000-000000000621','aaaaaaaa-0000-4000-a000-000000000620','pickup_leader','gate-leader@spec61.test','Lider Gate',ARRAY['pickup']),
        ('aaaaaaaa-0000-4000-a000-000000000622','aaaaaaaa-0000-4000-a000-000000000620','pickup_crew','gate-crew@spec61.test','Ana Perez',ARRAY['pickup']),
        ('aaaaaaaa-0000-4000-a000-000000000623','aaaaaaaa-0000-4000-a000-000000000620','pickup_leader','gate-leader2@spec61.test','Lider Dos',ARRAY['pickup'])
      ON CONFLICT (id) DO UPDATE
        SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
            full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

      INSERT INTO public.vehicles (id, operator_id, plate, active) VALUES
        ('99999999-0000-4000-9000-000000000621','aaaaaaaa-0000-4000-a000-000000000620','VEH-62-1', true),
        ('99999999-0000-4000-9000-000000000622','aaaaaaaa-0000-4000-a000-000000000620','VEH-62-2', true)
      ON CONFLICT DO NOTHING;

      -- Act as the CREW member.
      SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000622","operator_id":"aaaaaaaa-0000-4000-a000-000000000620","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620"}}';

      DO $$
      DECLARE msg TEXT := '';
      BEGIN
        BEGIN
          PERFORM public.start_pickup_route('99999999-0000-4000-9000-000000000621'::uuid);
          RAISE EXCEPTION 'a pickup_crew user must not be able to start a route';
        EXCEPTION WHEN insufficient_privilege THEN
          GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
        END;
        -- Shown to the driver verbatim: it must be Spanish, not a Postgres string.
        IF msg NOT LIKE '%líder%' THEN
          RAISE EXCEPTION 'refusal message is not the Spanish one the UI shows: %', msg;
        END IF;
      END $$;

      -- Act as the LEADER: route + crew in one call.
      SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000621","operator_id":"aaaaaaaa-0000-4000-a000-000000000620","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620"}}';

      DO $$
      DECLARE r public.pickup_routes; n INT;
      BEGIN
        r := public.start_pickup_route(
               '99999999-0000-4000-9000-000000000621'::uuid,
               ARRAY['aaaaaaaa-0000-4000-a000-000000000622']::uuid[]);
        IF r.driver_id <> 'aaaaaaaa-0000-4000-a000-000000000621' THEN
          RAISE EXCEPTION 'driver_id must be the leader, got %', r.driver_id;
        END IF;
        SELECT count(*) INTO n FROM public.pickup_route_crew
         WHERE pickup_route_id = r.id AND user_id = 'aaaaaaaa-0000-4000-a000-000000000622'
           AND removed_at IS NULL;
        IF n <> 1 THEN
          RAISE EXCEPTION 'the crew member should be on the route exactly once, found %', n;
        END IF;
      END $$;

      -- A second leader cannot take a picker who is already out.
      SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000623","operator_id":"aaaaaaaa-0000-4000-a000-000000000620","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620"}}';

      DO $$
      DECLARE msg TEXT := ''; n INT;
      BEGIN
        BEGIN
          PERFORM public.start_pickup_route(
                    '99999999-0000-4000-9000-000000000622'::uuid,
                    ARRAY['aaaaaaaa-0000-4000-a000-000000000622']::uuid[]);
          RAISE EXCEPTION 'a picker already on a route must be refused';
        EXCEPTION WHEN unique_violation THEN
          GET STACKED DIAGNOSTICS msg = MESSAGE_TEXT;
        END;
        IF msg NOT LIKE '%Ana Perez%' OR msg NOT LIKE '%PR-%' THEN
          RAISE EXCEPTION 'the refusal must name the person and the route, got: %', msg;
        END IF;
        -- and it must have created NOTHING.
        SELECT count(*) INTO n FROM public.pickup_routes
         WHERE driver_id = 'aaaaaaaa-0000-4000-a000-000000000623' AND status = 'in_progress';
        IF n <> 0 THEN
          RAISE EXCEPTION 'the refused call must not leave a route behind, found %', n;
        END IF;
      END $$;

      -- The one-argument call still resolves (frontend mid-deploy, and the TEXT wrapper).
      SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000623","operator_id":"aaaaaaaa-0000-4000-a000-000000000620","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000620"}}';
      DO $$
      DECLARE r public.pickup_routes;
      BEGIN
        r := public.start_pickup_route(p_vehicle_id => '99999999-0000-4000-9000-000000000622'::uuid);
        IF r.id IS NULL THEN RAISE EXCEPTION 'one-argument call must still work'; END IF;
      END $$;

      ROLLBACK;
      ```

- [ ] **Step 2: Run it, verify it fails**

      Run: `./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh run spec61_start_route_leader_gate`
      Expected: `FAIL` with `ERROR: a pickup_crew user must not be able to start a route`

- [ ] **Step 3: Minimal implementation**

      `packages/database/supabase/migrations/20260820000003_spec61_start_pickup_route_crew.sql`:

      ```sql
      -- =============================================================================
      -- spec-61 Task 2 — start_pickup_route: leader-only, crew in the same transaction
      -- =============================================================================
      -- Template: the LATEST definition, 20260812000003_spec52_pickup_routes_vehicle.sql:138
      -- (no later migration redefines it). Everything below is that body, plus the
      -- leader gate, the crew pre-flight and the crew insert.
      --
      -- WHY DROP AND RECREATE RATHER THAN CREATE OR REPLACE:
      -- CREATE OR REPLACE cannot add a parameter, and creating (UUID, UUID[] DEFAULT)
      -- alongside the existing (UUID) makes every named one-argument call ambiguous
      --     ERROR: function public.start_pickup_route(p_vehicle_id => uuid) is not unique
      -- which would break useStartPickupRoute.ts the moment this deploys, before the
      -- frontend chunk lands. Dropping the one-argument form and giving the new
      -- parameter a DEFAULT keeps every existing call site resolving unchanged --
      -- including the deprecated TEXT wrapper's internal call (same file, :346).
      -- DROP FUNCTION also drops the GRANT; it is reissued at the bottom.
      --
      -- The route insert's retry loop no longer wraps the crew insert. It used to be
      -- one BEGIN/EXCEPTION block; a unique_violation from the crew index inside it
      -- would have been misread as a route-code collision and retried three times
      -- before dying with the wrong error.
      -- =============================================================================

      BEGIN;

      DROP FUNCTION IF EXISTS public.start_pickup_route(UUID);

      CREATE OR REPLACE FUNCTION public.start_pickup_route(
        p_vehicle_id    UUID,
        p_crew_user_ids UUID[] DEFAULT '{}'::UUID[]
      ) RETURNS public.pickup_routes
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, auth
      AS $$
      DECLARE
        v_operator UUID;
        v_driver   UUID;
        v_role     public.user_role;
        v_year     INT := EXTRACT(YEAR FROM NOW())::INT;
        v_code     TEXT;
        v_row      public.pickup_routes;
        v_vehicle  public.vehicles;
        v_uid      UUID;
        v_member   public.users;
        v_busy     TEXT;
      BEGIN
        v_operator := public.get_operator_id();
        v_driver   := NULLIF(auth.jwt() ->> 'sub','')::UUID;
        IF v_operator IS NULL THEN
          RAISE EXCEPTION 'no operator in JWT' USING ERRCODE = '42501';
        END IF;
        IF v_driver IS NULL THEN
          RAISE EXCEPTION 'no driver (sub) in JWT' USING ERRCODE = '42501';
        END IF;

        -- ── spec-61: only a leader opens a route ────────────────────────────────
        -- Read from public.users, not from the JWT claim: the claim is minted at
        -- login and a freshly promoted leader would still be carrying the old role
        -- (GlobalContext.tsx:52 reads the same claim, which is why the UI needs a
        -- re-login too). SECURITY DEFINER, so RLS does not hide the row.
        -- operations_manager / admin / super_admin keep the capability they have
        -- today; pickup_crew is the role this spec exists to stop.
        SELECT role INTO v_role FROM public.users
         WHERE id = v_driver AND deleted_at IS NULL;

        IF v_role IS NULL
           OR v_role::text NOT IN ('pickup_leader','operations_manager','admin','super_admin') THEN
          RAISE EXCEPTION 'Solo un líder de ruta puede iniciar una ruta de retiro. Pídele a tu líder que te agregue a la suya.'
            USING ERRCODE = '42501';
        END IF;

        -- Vehicle validation. All three checks matter: the operator scope stops a
        -- cross-tenant truck, and active/deleted_at are what keep the SIN-REGISTRO
        -- backfill placeholder (and any retired truck) out of new routes.
        IF p_vehicle_id IS NULL THEN
          RAISE EXCEPTION 'Debe seleccionar un vehículo para iniciar la ruta'
            USING ERRCODE = '22023';
        END IF;

        SELECT * INTO v_vehicle FROM public.vehicles
         WHERE id = p_vehicle_id
           AND operator_id = v_operator
           AND deleted_at IS NULL;

        IF v_vehicle.id IS NULL THEN
          RAISE EXCEPTION 'El vehículo seleccionado no existe o no pertenece a este operador'
            USING ERRCODE = '42501';
        END IF;
        IF NOT v_vehicle.active THEN
          -- EXPAND-PHASE EXEMPTION (spec-52, unchanged here): the operator's
          -- SIN-REGISTRO placeholder is the one inactive vehicle a route may bind
          -- to. Every other inactive vehicle -- a retired truck -- is still refused.
          IF v_vehicle.plate <> 'SIN-REGISTRO' THEN
            RAISE EXCEPTION 'El vehículo % está inactivo y no puede iniciar una ruta', v_vehicle.plate
              USING ERRCODE = '22023';
          END IF;
        END IF;

        -- ── spec-61: crew pre-flight, BEFORE anything is written ────────────────
        -- Refuse, never move (spec, Open question 4). Both tables are checked: a
        -- person can be busy as a LEADER (pickup_routes.driver_id) or as CREW, and
        -- uniq_pickup_route_crew_one_active_per_user can only see the second --
        -- the leader/crew overlap has no index and is caught only here.
        FOREACH v_uid IN ARRAY COALESCE(p_crew_user_ids, '{}'::UUID[]) LOOP
          CONTINUE WHEN v_uid = v_driver;   -- the leader is not their own crew

          SELECT * INTO v_member FROM public.users
           WHERE id = v_uid AND operator_id = v_operator AND deleted_at IS NULL;
          IF v_member.id IS NULL THEN
            RAISE EXCEPTION 'Una de las personas seleccionadas no pertenece a este operador'
              USING ERRCODE = '42501';
          END IF;

          SELECT pr.code INTO v_busy FROM public.pickup_routes pr
           WHERE pr.operator_id = v_operator AND pr.driver_id = v_uid
             AND pr.status = 'in_progress' AND pr.deleted_at IS NULL
           LIMIT 1;

          IF v_busy IS NULL THEN
            SELECT pr.code INTO v_busy
              FROM public.pickup_route_crew c
              JOIN public.pickup_routes pr ON pr.id = c.pickup_route_id
             WHERE c.operator_id = v_operator AND c.user_id = v_uid
               AND c.removed_at IS NULL AND c.deleted_at IS NULL
               AND pr.status = 'in_progress' AND pr.deleted_at IS NULL
             LIMIT 1;
          END IF;

          IF v_busy IS NOT NULL THEN
            -- Names the person AND the route: "who do I go ask" is the whole
            -- point of refusing rather than moving them.
            RAISE EXCEPTION '% ya está en la ruta % y no puede estar en dos a la vez',
                            COALESCE(v_member.full_name, v_member.email), v_busy
              USING ERRCODE = '23505';
          END IF;
        END LOOP;

        -- Build code; uniqueness enforced by partial unique index per operator.
        -- Retry up to 3x on collision. The crew insert is deliberately OUTSIDE this
        -- block -- see the file header.
        FOR i IN 1..3 LOOP
          v_code := 'PR-' || v_year || '-' || lpad(nextval('pickup_routes_code_seq')::TEXT, 4, '0');
          BEGIN
            INSERT INTO public.pickup_routes (operator_id, code, driver_id, vehicle_id, vehicle_label, status)
            VALUES (v_operator, v_code, v_driver, p_vehicle_id,
                    NULLIF(v_vehicle.plate, 'SIN-REGISTRO'), 'in_progress')
            RETURNING * INTO v_row;
            EXIT;
          EXCEPTION
            WHEN unique_violation THEN
              IF EXISTS (
                SELECT 1 FROM public.pickup_routes
                 WHERE operator_id = v_operator
                   AND driver_id = v_driver
                   AND status = 'in_progress'
                   AND deleted_at IS NULL
              ) THEN
                RAISE EXCEPTION 'El conductor ya tiene una ruta de retiro activa'
                  USING ERRCODE = '23505';
              END IF;
              v_row := NULL;   -- code collision: retry
          END;
        END LOOP;

        IF v_row.id IS NULL THEN
          RAISE EXCEPTION 'could not allocate pickup route code after 3 attempts';
        END IF;

        -- Same transaction as the route: a route can never exist without its crew.
        INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
        SELECT DISTINCT v_operator, v_row.id, u, v_driver
          FROM unnest(COALESCE(p_crew_user_ids, '{}'::UUID[])) AS u
         WHERE u <> v_driver;

        RETURN v_row;
      END $$;

      COMMENT ON FUNCTION public.start_pickup_route(UUID, UUID[])
        IS 'Open an in_progress pickup route on an active, operator-owned vehicle, with '
           'its crew, in one transaction (spec-61). Refuses a caller whose role cannot '
           'lead (pickup_leader / operations_manager / admin / super_admin may), and '
           'refuses a crew member already active on another route, naming it. Every '
           'refusal message is Spanish and shown to the driver verbatim.';

      -- DROP FUNCTION took the old grant with it.
      GRANT EXECUTE ON FUNCTION public.start_pickup_route(UUID, UUID[]) TO authenticated;
      REVOKE ALL ON FUNCTION public.start_pickup_route(UUID, UUID[]) FROM anon;

      COMMIT;
      ```

- [ ] **Step 4: Run it, verify it passes**

      Run: `./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh apply && ./scripts/pgtap-local.sh run spec61_start_route_leader_gate`
      Expected: `spec61_start_route_leader_gate   PASS`

- [ ] **Step 5: Confirm no other route test regressed**

      Run:
      ```
      ./scripts/pgtap-local.sh run spec52_start_route_text_wrapper spec52_vehicle_constraints \r
        spec47_single_active_route_per_driver spec52_migration_reconciliation spec47_migration_invariants
      ```

      **CORRECTION (post-implementation): the `pass=5 fail=0` originally predicted here was
      wrong.** Two of the five needed changes as part of *this* task, not a later one --
      a change that breaks an existing test has to fix it, that is part of completing
      the change:

      - `spec52_vehicle_constraints.sql:93-96` asserted `pronargs = 1 AND proargtypes[0]
        = 'uuid'` for `start_pickup_route`. Dropping and recreating it as
        `(UUID, UUID[] DEFAULT)` makes `pronargs = 2`, so the count went to 0 and the
        test raised. Fixed to assert the specific two-argument shape (still catches an
        accidental extra overload) plus a companion check that the old one-argument form
        is gone.
      - Both `spec52_vehicle_constraints.sql` (driver fixture `:32-58`) and
        `spec52_start_route_text_wrapper.sql` (driver fixture `:37-51`) insert their test
        drivers into `public.users` with no `role`, so they fell to the table default
        `pickup_crew` -- which the new leader gate now refuses regardless of which
        overload (UUID or TEXT) they call through. Fixed by promoting exactly the
        fixture users that call `start_pickup_route` directly to `pickup_leader` (one
        driver in `spec52_vehicle_constraints.sql`, all four in
        `spec52_start_route_text_wrapper.sql`, which opens routes as every driver in
        turn) -- fixture users that never call the RPC were deliberately left at
        `pickup_crew`, with a comment saying why, so the next edit doesn't promote
        everyone by reflex.

      `spec47_single_active_route_per_driver.sql` and `spec52_migration_reconciliation.sql`
      insert `pickup_routes` rows directly and never call `start_pickup_route()`, so the
      gate never sees them -- unaffected. `spec47_migration_invariants.sql` asserts
      schema-level and seed-data invariants (table drops, FK targets, enum labels,
      manifest/reception_scan consistency against the live seed) that this task's
      migration does not touch at all -- if it fails, that predates spec-61 and is not
      this task's regression.

      Expected, corrected: `spec52_start_route_text_wrapper` and `spec52_vehicle_constraints`
      required the fixture/assertion fixes above to pass; the other three were already
      unaffected by this task's changes.

- [ ] **Step 6: Ship the QA leader in the same commit**

      In `infra/supabase-qa/create-qa-users.sh`, extend `ROLE_ROWS` (`:99-104`) with a row
      after `pickup_crew`:

      ```
      pickup_leader|$QA_OPERATOR_ID|pickup|00000000-0000-4000-8000-000000000207
      ```

      and extend the header comment at `:19-21` to name `pickup_leader` alongside the other
      QA-operator roles. Add to `docs/qa-environment.md`'s table (`:131-140`):

      ```
      | qa-pickup-leader@qa.test | pickup_leader | QA Test Operator |
      ```

      and in `packages/database/supabase/seed-qa.sql`, amend the comment block at `:326-340`
      so it says the account that walks `3j` is now `qa-pickup-leader@qa.test`
      (`00000000-0000-4000-8000-000000000207`) and that `qa-pickup-crew@qa.test` is the
      account for the "crew with no route" state. No SQL changes in the seed: the seed
      already asserts zero active routes, which is what both accounts need.

- [ ] **Step 7: Verify the script's shape without running it**

      Run: `bash -n infra/supabase-qa/create-qa-users.sh && grep -n "pickup_leader" infra/supabase-qa/create-qa-users.sh`
      Expected: no syntax output, and the new `ROLE_ROWS` line printed.

      **The script does not run itself on deploy.** `deploy-qa.sh:175` deliberately leaves it
      in `setup-qa.sh:195`, the one-time bootstrap. So merging this commit does *not* create
      `qa-pickup-leader@qa.test` — QA will have a leader-only flow and no leader until someone
      runs, on the QA VPS:

      ```
      bash ~/aureon-last-mile/infra/supabase-qa/create-qa-users.sh /home/aureon/.env.qa
      ```

      It is idempotent (existing emails are skipped). **Ask the user before touching the VPS**
      — CLAUDE.md forbids deploying without an explicit instruction — and do not report this
      task complete until they confirm the account exists.

- [ ] **Step 8: Commit**

      ```
      git add packages/database/supabase/migrations/20260820000003_spec61_start_pickup_route_crew.sql packages/database/supabase/tests/spec61_start_route_leader_gate.sql infra/supabase-qa/create-qa-users.sh docs/qa-environment.md packages/database/supabase/seed-qa.sql
      git commit -m "feat(spec-61): only a leader opens a pickup route, and the crew rides with it

      Dropped and recreated start_pickup_route rather than CREATE OR REPLACE: a
      second overload with a defaulted argument makes every named one-argument
      call ambiguous, which would break the live frontend the moment the DB chunk
      deploys. Crew are validated before anything is written and inserted in the
      same transaction as the route.

      Ships qa-pickup-leader@qa.test in the same commit -- create-qa-users.sh only
      runs from setup-qa.sh, so QA needs it run by hand before the flow works."
      ```

## Chunk 2 — Frontend role plumbing, and "my route" including crew

Depends on Chunk 1 being merged (the role must exist in the database before a user can be
given it). Nothing here is user-visible on its own except the `/admin` role dropdown.

### Task 3: `pickup_leader` through the frontend's role surfaces

**Files:**
- Modify: `apps/frontend/src/lib/types/auth.types.ts:15-33`, `:198-207`
- Modify: `apps/frontend/src/lib/permissions.ts:38-45`
- Create: `apps/frontend/src/lib/permissions.test.ts`
- Modify: `apps/frontend/src/lib/validation/userSchema.ts:30`, `:42`, `:62-68`
- Modify: `apps/frontend/src/app/api/users/route.ts:38`
- Modify: `apps/frontend/src/app/api/users/[id]/route.ts:10`
- Modify: `apps/frontend/src/components/sidebar/navigation.ts:174-181`
- Modify: `apps/frontend/src/components/sidebar/navigation.test.ts:271-284`

The trap is `MOBILE_TAB_ROLES`. `buildMobileTabs` returns `[]` for any role not in that set
(`navigation.ts:209`), so a `pickup_leader` missing there gets **no bottom tab bar at all** —
on a phone, the only navigation these users have. The test below asserts the set by
construction rather than by restating the strings, so the next role added cannot slip past.

- [ ] **Step 1: Write the failing navigation test**

      Replace `describe('isOperationsRole', …)` at `navigation.test.ts:271-284` with:

      ```ts
      describe('isOperationsRole', () => {
        it('is true for every operations role', () => {
          for (const role of OPERATIONS_ROLES) {
            expect(isOperationsRole(role)).toBe(true);
          }
        });

        // The trap this test exists for: buildMobileTabs returns [] for any role
        // outside the set, so a floor role missing here gets NO bottom tab bar --
        // the only navigation a phone user has. spec-61 added pickup_leader.
        it('covers every floor role that works on a phone', () => {
          expect([...OPERATIONS_ROLES].sort()).toEqual(
            ['loading_crew', 'pickup_crew', 'pickup_leader', 'warehouse_staff'].sort(),
          );
        });

        it('gives every operations role the full four-tab bar', () => {
          for (const role of OPERATIONS_ROLES) {
            const tabs = buildMobileTabs({
              role,
              permissions: [],
              enabledModules: [],
            });
            expect(tabs).toHaveLength(4);
          }
        });

        it('is false for desk roles and for unknown input', () => {
          expect(isOperationsRole('operations_manager')).toBe(false);
          expect(isOperationsRole('admin')).toBe(false);
          expect(isOperationsRole('super_admin')).toBe(false);
          expect(isOperationsRole('some_future_role')).toBe(false);
          expect(isOperationsRole(null)).toBe(false);
        });
      });
      ```

      Add `OPERATIONS_ROLES` and `buildMobileTabs` to the import list at `navigation.test.ts:11`.

- [ ] **Step 2: Run it, verify it fails**

      Run: `cd apps/frontend && npx vitest run src/components/sidebar/navigation.test.ts --maxWorkers=2`
      Expected: FAIL — `OPERATIONS_ROLES is not exported by …/navigation.ts` (or, once
      exported, `expected [ … ] to deeply equal [ …, 'pickup_leader', … ]`)

- [ ] **Step 3: Minimal implementation**

      `navigation.ts:174-181` becomes:

      ```ts
      /**
       * spec-54 — the mobile bottom tab bar.
       *
       * Floor and van roles only. `operations_manager` and `admin` do their work
       * on desktop; a phone in their hand is incidental, and a 4-tab driver bar
       * would hide most of the 9-item nav they actually need — they keep the
       * hamburger `Sheet` instead (see AppLayout).
       *
       * spec-61 — `pickup_leader` belongs here for the same reason `pickup_crew`
       * does: it is a van role. A role missing from this set gets NO tab bar
       * (`buildMobileTabs` returns `[]` below), which on a phone means no
       * navigation at all. Exported so navigation.test.ts can assert the set
       * rather than restate it.
       */
      export const OPERATIONS_ROLES = [
        'pickup_crew',
        'pickup_leader',
        'warehouse_staff',
        'loading_crew',
      ] as const;

      const MOBILE_TAB_ROLES: ReadonlySet<string> = new Set(OPERATIONS_ROLES);

      export function isOperationsRole(role: string | null): boolean {
        return role !== null && MOBILE_TAB_ROLES.has(role);
      }
      ```

- [ ] **Step 4: Run it, verify it passes**

      Run: `cd apps/frontend && npx vitest run src/components/sidebar/navigation.test.ts --maxWorkers=2`
      Expected: PASS

- [ ] **Step 5: Write the failing permissions test**

      Create `apps/frontend/src/lib/permissions.test.ts`:

      ```ts
      import { describe, it, expect } from 'vitest';
      import { ROLE_DEFAULT_PERMISSIONS, canLeadPickupRoute, ROUTE_LEADER_ROLES } from './permissions';

      describe('ROLE_DEFAULT_PERMISSIONS', () => {
        // Mirrors the CASE in handle_new_user, migration 20260820000002 (itself
        // templated on 20260811000001:100). If these drift, users created through
        // /admin and users created by the trigger get different permissions.
        it('gives a pickup_leader exactly what pickup_crew gets', () => {
          expect(ROLE_DEFAULT_PERMISSIONS.pickup_leader).toEqual(['pickup']);
          expect(ROLE_DEFAULT_PERMISSIONS.pickup_leader).toEqual(
            ROLE_DEFAULT_PERMISSIONS.pickup_crew,
          );
        });

        it('covers every role the app can assign', () => {
          expect(Object.keys(ROLE_DEFAULT_PERMISSIONS).sort()).toEqual(
            [
              'admin',
              'loading_crew',
              'operations_manager',
              'pickup_crew',
              'pickup_leader',
              'super_admin',
              'warehouse_staff',
            ].sort(),
          );
        });
      });

      describe('canLeadPickupRoute', () => {
        // The UI twin of start_pickup_route's role gate (20260820000003). The
        // database is the enforcement; this only decides what to render, so it
        // must never be MORE permissive than the RPC.
        it('is true for the roles the RPC accepts', () => {
          for (const role of ROUTE_LEADER_ROLES) {
            expect(canLeadPickupRoute(role)).toBe(true);
          }
          expect([...ROUTE_LEADER_ROLES].sort()).toEqual(
            ['admin', 'operations_manager', 'pickup_leader', 'super_admin'].sort(),
          );
        });

        it('is false for crew, for other floor roles, and for an unknown role', () => {
          expect(canLeadPickupRoute('pickup_crew')).toBe(false);
          expect(canLeadPickupRoute('warehouse_staff')).toBe(false);
          expect(canLeadPickupRoute('loading_crew')).toBe(false);
          expect(canLeadPickupRoute('some_future_role')).toBe(false);
          expect(canLeadPickupRoute(null)).toBe(false);
        });
      });
      ```

- [ ] **Step 6: Run it, verify it fails**

      Run: `cd apps/frontend && npx vitest run src/lib/permissions.test.ts --maxWorkers=2`
      Expected: FAIL — `No "canLeadPickupRoute" export is defined on the "./permissions" mock`
      / `canLeadPickupRoute is not a function`

- [ ] **Step 7: Minimal implementation**

      In `permissions.ts`, add `pickup_leader` to `ROLE_DEFAULT_PERMISSIONS` (`:38-45`), right
      after `pickup_crew`:

      ```ts
        pickup_crew: ['pickup'],
        // spec-61 — a leader does the same work plus opening the route. Route
        // creation is gated by ROLE in start_pickup_route, not by a permission
        // token, so the token set is deliberately identical to pickup_crew's.
        pickup_leader: ['pickup'],
      ```

      and append at the end of the file:

      ```ts
      /**
       * Roles that may open a pickup route (spec-61).
       *
       * The UI twin of the role gate in `start_pickup_route`
       * (migration 20260820000003). The database is the enforcement — this only
       * decides whether to render a control — so it must never be more permissive
       * than the RPC. operations_manager / admin / super_admin are here because
       * they can start routes today and this spec is not about taking that away.
       *
       * NOTE: the caller's role comes from the JWT claim
       * (lib/context/GlobalContext.tsx:53), which is minted at login. A user just
       * promoted to pickup_leader keeps the old answer until their token refreshes.
       */
      export const ROUTE_LEADER_ROLES = [
        'pickup_leader',
        'operations_manager',
        'admin',
        'super_admin',
      ] as const;

      export function canLeadPickupRoute(role: string | null | undefined): boolean {
        return !!role && (ROUTE_LEADER_ROLES as readonly string[]).includes(role);
      }
      ```

- [ ] **Step 8: Run it, verify it passes**

      Run: `cd apps/frontend && npx vitest run src/lib/permissions.test.ts --maxWorkers=2`
      Expected: PASS

- [ ] **Step 9: Let the type checker drive the remaining surfaces**

      Run: `cd apps/frontend && npx tsc --noEmit`
      Expected: after adding `PICKUP_LEADER = 'pickup_leader'` to `UserRole`
      (`auth.types.ts:15-33`), an error at `auth.types.ts:198` —
      `Property '[UserRole.PICKUP_LEADER]' is missing in type … Record<UserRole, string>`.
      That error *is* the test for this step; there is no runtime assertion to write.

      Make these **seven** edits, then re-run `npx tsc --noEmit` until clean.

      **Edits 6 and 7 are the dangerous ones: `tsc` will NOT flag them.** `super_admin`
      is already missing from both lists, which proves nothing depends on them for
      compilation — so they get left stale and silently drift. Do not skip them because
      the type-check passes.

      1. `auth.types.ts:15-33` — add the member, above `WAREHOUSE_STAFF`:
         ```ts
           /** Pickup route leaders — open the route and name its crew (spec-61) */
           PICKUP_LEADER = 'pickup_leader',
         ```
      2. `auth.types.ts:197-206` — add to `roleNames`:
         ```ts
             [UserRole.PICKUP_LEADER]: 'Pickup Leader',
         ```
      3. `lib/validation/userSchema.ts:30` and `:42` — both enums become
         ```ts
           ['pickup_crew', 'pickup_leader', 'warehouse_staff', 'loading_crew', 'operations_manager', 'admin'] as const,
         ```
      4. `lib/validation/userSchema.ts:62-68` — `roleOptions` gains, after `pickup_crew`:
         ```ts
           { value: 'pickup_leader', label: 'Líder de recogida', color: 'gray' },
         ```
         This is the whole of the "grant the role" surface: `UserForm.tsx:228` and `:405`
         render `roleOptions` and hold no role list of their own, so they need no edit.
      5. `app/api/users/route.ts:38` and `app/api/users/[id]/route.ts:10` — same enum list as
         (3). These are the server-side gate; without them the form can offer the role and the
         API will reject it with `Please select a valid role`.

      6. `lib/api/users.ts:9` and `:15` — `CreateUserInput.role` and `UpdateUserInput.role`
         are two more hand-written role unions. Same list as (3). `tsc` does catch these.

      7. `lib/types.ts:2078` (`Enums.user_role`) and `:2262` (`Constants.user_role`) — the
         hand-maintained database types. **`tsc` will not catch these.** Add
         `'pickup_leader'` to both, keeping the enum order consistent with the migration.
         Task 4 Step 9 already edits this file for other reasons; do not assume it covers
         the enum, because it does not.

- [ ] **Step 10: Prove the API and the form agree**

      Run:
      ```
      cd apps/frontend && npx vitest run src/components/admin src/app/api/users --maxWorkers=2
      ```
      Expected: PASS, no snapshot or role-list assertion breaks. If a test enumerates roles,
      update it in this step rather than the next.

- [ ] **Step 11: Full type + lint check**

      Run: `cd apps/frontend && npx tsc --noEmit && npx eslint src/lib/permissions.ts src/lib/types/auth.types.ts src/components/sidebar/navigation.ts src/lib/validation/userSchema.ts`
      Expected: no output from either.

- [ ] **Step 12: Commit**

      ```
      git add apps/frontend/src/lib/permissions.ts apps/frontend/src/lib/permissions.test.ts apps/frontend/src/lib/types/auth.types.ts apps/frontend/src/lib/validation/userSchema.ts apps/frontend/src/app/api/users apps/frontend/src/components/sidebar/navigation.ts apps/frontend/src/components/sidebar/navigation.test.ts
      git commit -m "feat(spec-61): plumb pickup_leader through the frontend role surfaces

      MOBILE_TAB_ROLES is the one that bites: buildMobileTabs returns [] for a
      role outside it, so a leader missing there would get no bottom tab bar at
      all. The set is now exported and asserted by construction, so the next role
      cannot slip past. Four zod enums carried the role list, not two -- both API
      routes and both schemas in userSchema.ts."
      ```

### Task 4: "my route" means I lead it **or** I am active crew on it

**Files:**
- Create: `packages/database/supabase/tests/spec61_my_active_route.sql`
- Create: `packages/database/supabase/migrations/20260820000004_spec61_my_active_pickup_route.sql`
- Modify: `apps/frontend/src/hooks/pickup/useActivePickupRoute.ts`
- Modify: `apps/frontend/src/hooks/pickup/useActivePickupRoute.test.ts`
- Modify: `apps/frontend/src/lib/types.ts` (add the function + the table)

One query, no N+1 — and PostgREST cannot express it. `.or('driver_id.eq.X, …')` cannot reach
an embedded table's column without `referencedTable`, which filters the *embed* rather than
the parent, and an `!inner` join on `pickup_route_crew` would drop the leader's own route
whenever the leader took no crew. A single `SECURITY INVOKER` SQL function does it in one
round trip and carries the crew list Task 6 needs.

- [ ] **Step 1: Write the failing DB test**

      `packages/database/supabase/tests/spec61_my_active_route.sql`:

      ```sql
      -- spec-61 Task 4 — get_my_active_pickup_route(): leader OR active crew.
      BEGIN;

      INSERT INTO public.operators (id, name, slug)
      VALUES ('aaaaaaaa-0000-4000-a000-000000000630','Spec61 Mine','spec61-mine')
      ON CONFLICT (slug) DO NOTHING;

      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token
      ) VALUES
        ('aaaaaaaa-0000-4000-a000-000000000631','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','mine-leader@spec61.test', crypt('x', gen_salt('bf')), NOW(),
         '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630","role":"pickup_leader"}'::jsonb,
         '{"full_name":"Marta Rojas"}'::jsonb, NOW(), NOW(), '', ''),
        ('aaaaaaaa-0000-4000-a000-000000000632','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','mine-crew@spec61.test', crypt('x', gen_salt('bf')), NOW(),
         '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630","role":"pickup_crew"}'::jsonb,
         '{"full_name":"Ana Perez"}'::jsonb, NOW(), NOW(), '', ''),
        ('aaaaaaaa-0000-4000-a000-000000000633','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','mine-other@spec61.test', crypt('x', gen_salt('bf')), NOW(),
         '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630","role":"pickup_crew"}'::jsonb,
         '{"full_name":"Nadie"}'::jsonb, NOW(), NOW(), '', '')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.users (id, operator_id, role, email, full_name, permissions) VALUES
        ('aaaaaaaa-0000-4000-a000-000000000631','aaaaaaaa-0000-4000-a000-000000000630','pickup_leader','mine-leader@spec61.test','Marta Rojas',ARRAY['pickup']),
        ('aaaaaaaa-0000-4000-a000-000000000632','aaaaaaaa-0000-4000-a000-000000000630','pickup_crew','mine-crew@spec61.test','Ana Perez',ARRAY['pickup']),
        ('aaaaaaaa-0000-4000-a000-000000000633','aaaaaaaa-0000-4000-a000-000000000630','pickup_crew','mine-other@spec61.test','Nadie',ARRAY['pickup'])
      ON CONFLICT (id) DO UPDATE
        SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
            full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

      INSERT INTO public.vehicles (id, operator_id, plate, active)
      VALUES ('99999999-0000-4000-9000-000000000631','aaaaaaaa-0000-4000-a000-000000000630','AAA-111', true)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
      VALUES ('77777777-0000-4000-7000-000000000631','aaaaaaaa-0000-4000-a000-000000000630',
              'PR-61-M','aaaaaaaa-0000-4000-a000-000000000631','99999999-0000-4000-9000-000000000631','in_progress');

      INSERT INTO public.pickup_route_crew (operator_id, pickup_route_id, user_id, added_by)
      VALUES ('aaaaaaaa-0000-4000-a000-000000000630','77777777-0000-4000-7000-000000000631',
              'aaaaaaaa-0000-4000-a000-000000000632','aaaaaaaa-0000-4000-a000-000000000631');

      -- The leader sees it, with the plate, their name, and the crew.
      SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000631","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
      DO $$
      DECLARE j JSONB;
      BEGIN
        j := public.get_my_active_pickup_route();
        IF j IS NULL THEN RAISE EXCEPTION 'the leader must see their own route'; END IF;
        IF j->>'code' <> 'PR-61-M' THEN RAISE EXCEPTION 'wrong route: %', j->>'code'; END IF;
        IF j->>'plate' <> 'AAA-111' THEN RAISE EXCEPTION 'plate not joined: %', j; END IF;
        IF j->>'driver_name' <> 'Marta Rojas' THEN RAISE EXCEPTION 'driver name not joined: %', j; END IF;
        IF jsonb_array_length(j->'crew') <> 1
           OR j->'crew'->0->>'full_name' <> 'Ana Perez' THEN
          RAISE EXCEPTION 'crew missing from the payload: %', j->'crew';
        END IF;
      END $$;

      -- The crew member sees the SAME route.
      SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000632","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
      DO $$
      DECLARE j JSONB;
      BEGIN
        j := public.get_my_active_pickup_route();
        IF j IS NULL OR j->>'id' <> '77777777-0000-4000-7000-000000000631' THEN
          RAISE EXCEPTION 'active crew must see the route they are on, got %', j;
        END IF;
      END $$;

      -- Someone on no route sees nothing.
      SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000633","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
      DO $$ BEGIN
        IF public.get_my_active_pickup_route() IS NOT NULL THEN
          RAISE EXCEPTION 'a person on no route must get NULL';
        END IF;
      END $$;

      -- Once the route closes, the crew member is back to nothing.
      UPDATE public.pickup_routes SET status = 'in_transit', in_transit_at = NOW()
       WHERE id = '77777777-0000-4000-7000-000000000631';

      SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000632","operator_id":"aaaaaaaa-0000-4000-a000-000000000630","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000630"}}';
      DO $$ BEGIN
        IF public.get_my_active_pickup_route() IS NOT NULL THEN
          RAISE EXCEPTION 'a closed route must stop being "my route"';
        END IF;
      END $$;

      ROLLBACK;
      ```

- [ ] **Step 2: Run it, verify it fails**

      Run: `./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh run spec61_my_active_route`
      Expected: `FAIL` with `ERROR: function public.get_my_active_pickup_route() does not exist`

- [ ] **Step 3: Minimal implementation**

      `packages/database/supabase/migrations/20260820000004_spec61_my_active_pickup_route.sql`:

      ```sql
      -- =============================================================================
      -- spec-61 Task 4 — get_my_active_pickup_route(): leader OR active crew
      -- =============================================================================
      -- Replaces the PostgREST query in
      -- apps/frontend/src/hooks/pickup/useActivePickupRoute.ts, which filtered
      -- driver_id = auth.uid() and so showed a crew member NO active route --
      -- dropping them on 3j, where they would open a second route for the same van.
      --
      -- Why an RPC and not a richer .select(): "I lead it OR I am active crew on it"
      -- is an OR across a join. PostgREST's .or() cannot filter a parent row on an
      -- embedded table's column (referencedTable filters the embed, not the parent),
      -- and pickup_route_crew!inner would drop a leader who took no crew. The
      -- alternatives are two round-trips or this. One round trip, and it carries the
      -- crew list that 3h needs (spec-61 Task 6) in the same payload.
      --
      -- SECURITY INVOKER, deliberately: every table it reads already has a tenant
      -- SELECT policy for authenticated users -- pickup_routes
      -- (20260625000001:115), pickup_route_crew (20260820000002), vehicles
      -- (20260812000001:36), users (20260216170542:78). A DEFINER function here
      -- would hand out cross-operator data if the operator scoping below ever
      -- regressed; INVOKER keeps RLS as the backstop.
      -- =============================================================================

      BEGIN;

      CREATE OR REPLACE FUNCTION public.get_my_active_pickup_route()
      RETURNS JSONB
      LANGUAGE sql
      STABLE
      SECURITY INVOKER
      SET search_path = public, auth
      AS $$
        WITH me AS (
          SELECT NULLIF(auth.jwt() ->> 'sub','')::UUID AS uid,
                 public.get_operator_id()              AS op
        ),
        mine AS (
          SELECT pr.*
            FROM public.pickup_routes pr, me
           WHERE pr.operator_id = me.op
             AND pr.status = 'in_progress'
             AND pr.deleted_at IS NULL
             AND (
               pr.driver_id = me.uid
               OR EXISTS (
                 SELECT 1 FROM public.pickup_route_crew c
                  WHERE c.pickup_route_id = pr.id
                    AND c.user_id    = me.uid
                    AND c.removed_at IS NULL
                    AND c.deleted_at IS NULL
               )
             )
           -- Ordered + LIMIT 1 for the same reason the hook did: the indexes make
           -- two active rows impossible, and if one ever slips through, the newest
           -- is the least wrong answer.
           ORDER BY pr.started_at DESC
           LIMIT 1
        )
        SELECT to_jsonb(m.*) || jsonb_build_object(
          -- `plate`, not vehicle_label: vehicle_label is a deprecated expand-phase
          -- mirror (spec-52). LEFT-join semantics -- a route whose vehicle row was
          -- removed still resolves, with plate NULL, matching
          -- ActivePickupRoute['vehicle'] being nullable.
          'plate',       (SELECT v.plate     FROM public.vehicles v WHERE v.id = m.vehicle_id),
          'driver_name', (SELECT u.full_name FROM public.users   u WHERE u.id = m.driver_id),
          'crew', COALESCE((
            SELECT jsonb_agg(
                     jsonb_build_object('user_id', c.user_id, 'full_name', u.full_name)
                     ORDER BY u.full_name)
              FROM public.pickup_route_crew c
              JOIN public.users u ON u.id = c.user_id
             WHERE c.pickup_route_id = m.id
               AND c.removed_at IS NULL
               AND c.deleted_at IS NULL
          ), '[]'::jsonb)
        )
        FROM mine m;
      $$;

      COMMENT ON FUNCTION public.get_my_active_pickup_route() IS
        'The caller''s open pickup route -- the one they LEAD or are active CREW on '
        '(spec-61) -- with the vehicle plate, the leader''s name and the crew, in one '
        'round trip. NULL when there is none. Contract of ActivePickupRoute in '
        'apps/frontend/src/hooks/pickup/useActivePickupRoute.ts.';

      GRANT EXECUTE ON FUNCTION public.get_my_active_pickup_route() TO authenticated;
      REVOKE ALL ON FUNCTION public.get_my_active_pickup_route() FROM anon;

      COMMIT;
      ```

- [ ] **Step 4: Run it, verify it passes**

      Run: `./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh apply && ./scripts/pgtap-local.sh run spec61_my_active_route`
      Expected: `spec61_my_active_route   PASS`

- [ ] **Step 5: Write the failing hook test**

      Rewrite `apps/frontend/src/hooks/pickup/useActivePickupRoute.test.ts`. The old file mocks
      a `from()` chain; the hook now calls an RPC, so the mock changes shape. Keep the
      behavioural assertions, drop the four that assert PostgREST syntax
      (`eq('status','in_progress')`, the `select` string matchers) — they now belong to the DB
      test above.

      ```ts
      import { describe, it, expect, vi, beforeEach } from 'vitest';
      import { renderHook, waitFor } from '@testing-library/react';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import React from 'react';

      const mockRpc = vi.fn();

      vi.mock('@/lib/supabase/client', () => ({
        createSPAClient: () => ({ rpc: mockRpc }),
      }));

      import { useActivePickupRoute } from './useActivePickupRoute';

      function wrapperFactory() {
        const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        function Wrapper({ children }: { children: React.ReactNode }) {
          return React.createElement(QueryClientProvider, { client: qc }, children);
        }
        return Wrapper;
      }

      const ROUTE = {
        id: 'route-1',
        operator_id: 'op-1',
        driver_id: 'driver-1',
        code: 'PR-2026-0001',
        status: 'in_progress',
        plate: 'AAA-111',
        driver_name: 'M. Rojas',
        crew: [{ user_id: 'crew-1', full_name: 'Ana Pérez' }],
      };

      describe('useActivePickupRoute', () => {
        beforeEach(() => {
          vi.clearAllMocks();
          mockRpc.mockResolvedValue({ data: null, error: null });
        });

        it('returns null when the caller is on no route', async () => {
          const { result } = renderHook(() => useActivePickupRoute('op-1'), {
            wrapper: wrapperFactory(),
          });
          await waitFor(() => expect(result.current.isLoading).toBe(false));
          expect(result.current.data).toBeNull();
        });

        // spec-61: "my route" is resolved server-side as leader OR active crew.
        // One call, no second query to pickup_route_crew — a crew member on a
        // route their colleague opened must land on 3h, not 3j.
        it('resolves the route in a single RPC call', async () => {
          mockRpc.mockResolvedValue({ data: ROUTE, error: null });
          const { result } = renderHook(() => useActivePickupRoute('op-1'), {
            wrapper: wrapperFactory(),
          });
          await waitFor(() => expect(result.current.isLoading).toBe(false));
          expect(mockRpc).toHaveBeenCalledTimes(1);
          expect(mockRpc).toHaveBeenCalledWith('get_my_active_pickup_route', undefined);
          expect(result.current.data?.id).toBe('route-1');
        });

        it('surfaces the plate and the driver name in the shape the screens read', async () => {
          mockRpc.mockResolvedValue({ data: ROUTE, error: null });
          const { result } = renderHook(() => useActivePickupRoute('op-1'), {
            wrapper: wrapperFactory(),
          });
          await waitFor(() => expect(result.current.isLoading).toBe(false));
          expect(result.current.data?.vehicle?.plate).toBe('AAA-111');
          expect(result.current.data?.driver?.full_name).toBe('M. Rojas');
        });

        it('leaves vehicle null when the vehicle row is gone', async () => {
          mockRpc.mockResolvedValue({ data: { ...ROUTE, plate: null }, error: null });
          const { result } = renderHook(() => useActivePickupRoute('op-1'), {
            wrapper: wrapperFactory(),
          });
          await waitFor(() => expect(result.current.isLoading).toBe(false));
          expect(result.current.data?.vehicle).toBeNull();
        });

        it('carries the crew for 3h', async () => {
          mockRpc.mockResolvedValue({ data: ROUTE, error: null });
          const { result } = renderHook(() => useActivePickupRoute('op-1'), {
            wrapper: wrapperFactory(),
          });
          await waitFor(() => expect(result.current.isLoading).toBe(false));
          expect(result.current.data?.crew).toEqual([
            { user_id: 'crew-1', full_name: 'Ana Pérez' },
          ]);
        });

        it('defaults crew to an empty array when the RPC omits it', async () => {
          const { crew: _drop, ...noCrew } = ROUTE;
          mockRpc.mockResolvedValue({ data: noCrew, error: null });
          const { result } = renderHook(() => useActivePickupRoute('op-1'), {
            wrapper: wrapperFactory(),
          });
          await waitFor(() => expect(result.current.isLoading).toBe(false));
          expect(result.current.data?.crew).toEqual([]);
        });

        it('does not fetch when operatorId is null', () => {
          renderHook(() => useActivePickupRoute(null), { wrapper: wrapperFactory() });
          expect(mockRpc).not.toHaveBeenCalled();
        });
      });
      ```

- [ ] **Step 6: Run it, verify it fails**

      Run: `cd apps/frontend && npx vitest run src/hooks/pickup/useActivePickupRoute.test.ts --maxWorkers=2`
      Expected: FAIL — `TypeError: supabase.from is not a function` (the hook still queries
      PostgREST)

- [ ] **Step 7: Minimal implementation**

      Replace the body of `useActivePickupRoute.ts` from the type block down. Keep
      `PickupRoute` and the `vehicle` / `driver` shape exactly as they are — five components
      import `ActivePickupRoute` and none of them should have to change:

      ```ts
      import { useQuery } from '@tanstack/react-query';
      import { createSPAClient } from '@/lib/supabase/client';
      import { callRpc } from '@/lib/supabase/rpc';
      import type { Database } from '@/lib/types';

      export type PickupRoute = Database['public']['Tables']['pickup_routes']['Row'];

      /** One person on the trip besides the leader (spec-61). */
      export interface RouteCrewMember {
        user_id: string;
        full_name: string | null;
      }

      /** The RPC's payload: the route row, flattened, plus three joined extras. */
      type ActiveRoutePayload = PickupRoute & {
        plate: string | null;
        driver_name: string | null;
        crew?: RouteCrewMember[] | null;
      };

      export type ActivePickupRoute = PickupRoute & {
        vehicle: { plate: string } | null;
        driver: { full_name: string } | null;
        /** spec-61 — everyone else on this trip. Empty for a solo route. */
        crew: RouteCrewMember[];
      };

      /**
       * The signed-in user's open pickup route — the one they LEAD or are active
       * CREW on — or null.
       *
       * spec-61 moved the resolution into `get_my_active_pickup_route()`. It used
       * to filter `driver_id = auth.uid()` here, which showed a crew member no
       * active route at all and dropped them on 3j, where they opened a SECOND
       * route for the same van. "Leader OR active crew" is an OR across a join and
       * PostgREST cannot express it in one request — see the migration header
       * (20260820000004) before considering a return to `.select()`.
       *
       * Refetches on window focus so someone who closes a route on one device sees
       * it disappear on another.
       */
      export function useActivePickupRoute(operatorId: string | null) {
        return useQuery<ActivePickupRoute | null>({
          queryKey: ['pickup', 'active-route', operatorId],
          enabled: !!operatorId,
          refetchOnWindowFocus: true,
          staleTime: 10_000,
          queryFn: async () => {
            const supabase = createSPAClient();
            const { data, error } = await callRpc<ActiveRoutePayload | null>(
              supabase,
              'get_my_active_pickup_route',
            );
            if (error) throw error;
            if (!data) return null;

            const { plate, driver_name, crew, ...route } = data;
            return {
              ...(route as PickupRoute),
              vehicle: plate ? { plate } : null,
              driver: driver_name ? { full_name: driver_name } : null,
              crew: crew ?? [],
            };
          },
        });
      }
      ```

      `callRpc`, not `supabase.rpc(...)` directly: the RPC name is not in the generated union
      and the cast idiom that looks obvious detaches `this` — see the comment in
      `lib/supabase/rpc.ts`.

- [ ] **Step 8: Run it, verify it passes**

      Run: `cd apps/frontend && npx vitest run src/hooks/pickup/useActivePickupRoute.test.ts --maxWorkers=2`
      Expected: PASS (7 tests)

- [ ] **Step 9: Add the new table and function to the hand-maintained types**

      In `apps/frontend/src/lib/types.ts`, add a `pickup_route_crew` entry beside
      `pickup_routes` (`:307`) with `Row` / `Insert` / `Update` matching the migration, and in
      `Functions` beside `start_pickup_route` (`:1927`):

      ```ts
            get_my_active_pickup_route: {
              Args: Record<PropertyKey, never>
              Returns: Json
            }
      ```

      and widen `start_pickup_route` (`:1928`) to
      `Args: { p_vehicle_id: string; p_crew_user_ids?: string[] }` — Task 5 sends the second
      argument and will not compile otherwise.

- [ ] **Step 10: Run the whole pickup suite plus types**

      Run:
      ```
      cd apps/frontend && npx tsc --noEmit && npx vitest run src/hooks/pickup src/components/pickup src/app/app/pickup --maxWorkers=2
      ```
      Expected: no `tsc` output; all pickup suites PASS. Any failure here is a consumer that
      was reading a field the hook no longer returns — fix the consumer, do not widen the type.

- [ ] **Step 11: Commit**

      ```
      git add packages/database/supabase/migrations/20260820000004_spec61_my_active_pickup_route.sql packages/database/supabase/tests/spec61_my_active_route.sql apps/frontend/src/hooks/pickup/useActivePickupRoute.ts apps/frontend/src/hooks/pickup/useActivePickupRoute.test.ts apps/frontend/src/lib/types.ts
      git commit -m "feat(spec-61): my route is the one I lead OR am active crew on

      Resolved server-side in get_my_active_pickup_route: 'leader OR active crew'
      is an OR across a join, which PostgREST cannot express in one request --
      .or() cannot filter a parent on an embedded column, and !inner would drop a
      leader who took no crew. One round trip, and it carries the crew list 3h
      needs. The hook's exported types are unchanged apart from the added crew."
      ```

## Chunk 3 — The screens: `3j` for leaders, something honest for crew, crew on `3h`

Depends on Chunks 1 and 2. This is the only chunk a driver can see.

### Task 5: `3j` becomes the leader's screen, and crew get their own

**Files:**
- Create: `apps/frontend/src/hooks/pickup/useCrewCandidates.ts` + `.test.ts`
- Create: `apps/frontend/src/components/pickup/CrewSelect.tsx` + `.test.tsx`
- Create: `apps/frontend/src/components/pickup/PickupMobileNoRoute.tsx` + `.test.tsx`
- Modify: `apps/frontend/src/components/pickup/PickupMobileView.tsx`
- Modify: `apps/frontend/src/components/pickup/PickupMobileStartRoute.tsx`
- Modify: `apps/frontend/src/hooks/pickup/useStartPickupRoute.ts`
- Modify: `apps/frontend/src/app/app/pickup/page.tsx:183-210`
- Modify: `apps/frontend/src/components/pickup/PickupRouteDraftPanel.tsx`
- Modify: `apps/frontend/src/components/pickup/PickupDesktopView.tsx:193`

Copy for the crew screen is fixed here rather than left to the implementer, because the whole
point is that the message is *actionable*: it must say a route is not open and who opens it.

- [ ] **Step 1: Write the failing test for the crew's empty screen**

      `apps/frontend/src/components/pickup/PickupMobileNoRoute.test.tsx`:

      ```tsx
      import { describe, it, expect } from 'vitest';
      import { render, screen } from '@testing-library/react';
      import { PickupMobileNoRoute } from './PickupMobileNoRoute';

      describe('PickupMobileNoRoute', () => {
        it('says no route is open and who opens it', () => {
          render(<PickupMobileNoRoute />);
          expect(screen.getByText(/no hay una ruta abierta/i)).toBeInTheDocument();
          expect(screen.getByText(/líder/i)).toBeInTheDocument();
        });

        // The whole reason this component exists (spec-61): a crew member must
        // never be shown a control they cannot use. start_pickup_route refuses
        // them, so a start button here could only ever produce an error toast.
        it('offers no vehicle selector and no start button', () => {
          render(<PickupMobileNoRoute />);
          expect(screen.queryByRole('button', { name: /iniciar ruta/i })).toBeNull();
          expect(screen.queryByRole('combobox')).toBeNull();
        });
      });
      ```

- [ ] **Step 2: Run it, verify it fails**

      Run: `cd apps/frontend && npx vitest run src/components/pickup/PickupMobileNoRoute.test.tsx --maxWorkers=2`
      Expected: FAIL — `Failed to resolve import "./PickupMobileNoRoute"`

- [ ] **Step 3: Minimal implementation**

      `apps/frontend/src/components/pickup/PickupMobileNoRoute.tsx`:

      ```tsx
      'use client';

      import { Users } from 'lucide-react';

      /**
       * spec-61 — what a picker who is NOT a route leader sees when no route is
       * open for them.
       *
       * Deliberately not 3j. `start_pickup_route` refuses a caller who cannot lead
       * (migration 20260820000003), so a vehicle selector and an "Iniciar ruta"
       * button here could only ever produce an error toast — the definition of a
       * control that lies. The copy names the leader instead, because the fix is
       * ten seconds of asking, which is the trade the spec makes: a loud failure
       * beats a silent second route for the same van.
       */
      export function PickupMobileNoRoute() {
        return (
          <section
            data-testid="pickup-mobile-no-route"
            className="rounded-[10px] border border-border bg-surface p-5 text-center"
          >
            <Users className="mx-auto h-7 w-7 text-text-muted" aria-hidden="true" />
            <p className="mt-3 font-heading text-[15px] font-semibold text-text">
              No hay una ruta abierta para ti
            </p>
            <p className="mt-1.5 text-[13px] leading-[1.45] text-text-secondary">
              El líder de tu equipo abre la ruta y te agrega a ella. Pídele que te
              incluya y esta pantalla se actualiza sola.
            </p>
          </section>
        );
      }
      ```

- [ ] **Step 4: Run it, verify it passes**

      Run: `cd apps/frontend && npx vitest run src/components/pickup/PickupMobileNoRoute.test.tsx --maxWorkers=2`
      Expected: PASS

- [ ] **Step 5: Write the failing branch test on `PickupMobileView`**

      Append to `apps/frontend/src/components/pickup/PickupMobileView.test.tsx` (it already
      mocks the hooks this file uses — reuse its existing setup and props factory):

      ```tsx
      describe('spec-61 — who may open a route', () => {
        it('shows 3j to a leader with no active route', () => {
          renderView({ activeRoute: null, role: 'pickup_leader' });
          expect(screen.getByTestId('pickup-mobile-start-route')).toBeInTheDocument();
          expect(screen.queryByTestId('pickup-mobile-no-route')).toBeNull();
        });

        it('shows crew with no route the ask-your-leader screen, not 3j', () => {
          renderView({ activeRoute: null, role: 'pickup_crew' });
          expect(screen.getByTestId('pickup-mobile-no-route')).toBeInTheDocument();
          expect(screen.queryByTestId('pickup-mobile-start-route')).toBeNull();
        });

        it('shows 3h to a crew member who IS on a route', () => {
          renderView({ activeRoute: ACTIVE_ROUTE, role: 'pickup_crew' });
          expect(screen.getByTestId('pickup-mobile-view')).toBeInTheDocument();
          expect(screen.queryByTestId('pickup-mobile-no-route')).toBeNull();
        });
      });
      ```

      `renderView` gains a `role` key that it passes into the component as the new `role` prop.

- [ ] **Step 6: Run it, verify it fails**

      Run: `cd apps/frontend && npx vitest run src/components/pickup/PickupMobileView.test.tsx --maxWorkers=2`
      Expected: FAIL — `Unable to find an element by: [data-testid="pickup-mobile-no-route"]`
      (crew currently get `3j`)

- [ ] **Step 7: Minimal implementation**

      In `PickupMobileView.tsx`: add `role: string | null` and `crewIds`-carrying
      `onCreateRoute` to the props, import `canLeadPickupRoute` and `PickupMobileNoRoute`, and
      make the tail a three-way branch:

      ```tsx
        if (activeRoute) {
          return (
            <PickupMobileActiveRoute … />
          );
        }

        // spec-61 — 3j is the LEADER's screen. A crew member with no route gets
        // PickupMobileNoRoute instead: start_pickup_route would refuse them, so
        // rendering the vehicle picker and the start button would be offering a
        // control that can only fail. `role` is the JWT claim
        // (GlobalContext.tsx:53) — a picker promoted to leader keeps seeing this
        // screen until their token refreshes, which is a re-login.
        const canLead = canLeadPickupRoute(role);

        return (
          <div className="flex flex-col gap-4" data-testid="pickup-mobile-view">
            <PickupMobileHeader driverName={currentUserName ?? null} routeCode={null} />
            {canLead ? (
              <PickupMobileStartRoute … onCreateRoute={onCreateRoute} />
            ) : (
              <PickupMobileNoRoute />
            )}
          </div>
        );
      ```

      Then thread `role` in from `page.tsx` — `useOperatorId()` already returns it
      (`hooks/useOperatorId.ts`), so `page.tsx:59` becomes
      `const { operatorId, role } = useOperatorId();` and the JSX passes `role={role}`.

- [ ] **Step 8: Run it, verify it passes**

      Run: `cd apps/frontend && npx vitest run src/components/pickup/PickupMobileView.test.tsx --maxWorkers=2`
      Expected: PASS

- [ ] **Step 9: Write the failing test for the crew picker's data source**

      `apps/frontend/src/hooks/pickup/useCrewCandidates.test.ts` — same mock shape as
      `useAuditLogUsers.test.ts` (a `from()` chain), asserting:
      - it queries `users` filtered by `operator_id`, `deleted_at IS NULL`, ordered by `full_name`;
      - it narrows to the roles that ride a van (`pickup_crew`, `pickup_leader`) via `.in('role', …)`;
      - it excludes the signed-in user (a leader is never their own crew — the RPC skips them anyway);
      - it does not fetch when `operatorId` is null.

- [ ] **Step 10: Run it, verify it fails, then implement**

      Run: `cd apps/frontend && npx vitest run src/hooks/pickup/useCrewCandidates.test.ts --maxWorkers=2`
      Expected: FAIL — unresolved import. Then write `useCrewCandidates.ts`:

      ```ts
      import { useQuery } from '@tanstack/react-query';
      import { createSPAClient } from '@/lib/supabase/client';

      export interface CrewCandidate {
        id: string;
        full_name: string | null;
        role: string;
      }

      /**
       * The people a leader may put on a route (spec-61).
       *
       * A plain `users` read, not an RPC: `users_tenant_isolation_select`
       * (20260216170542:78) already lets any authenticated user see their own
       * operator's users, so there is nothing for a SECURITY DEFINER function to
       * add. Narrowed to the van roles — a warehouse_staff on a pickup route is
       * not a thing anyone has asked for, and a full operator directory in a
       * bottom sheet is unusable on a phone.
       *
       * Availability is NOT filtered here. `start_pickup_route` refuses a picker
       * who is already out, naming their route (migration 20260820000003), and
       * that named refusal is more useful than a name silently missing from the
       * list — the leader would just conclude the app is broken.
       */
      export function useCrewCandidates(operatorId: string | null, excludeUserId: string | null) {
        return useQuery<CrewCandidate[]>({
          queryKey: ['pickup', 'crew-candidates', operatorId, excludeUserId],
          enabled: !!operatorId,
          staleTime: 300_000,
          queryFn: async () => {
            const supabase = createSPAClient();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data, error } = await (supabase.from('users') as any)
              .select('id, full_name, role')
              .eq('operator_id', operatorId!)
              .in('role', ['pickup_crew', 'pickup_leader'])
              .is('deleted_at', null)
              .order('full_name', { ascending: true });
            if (error) throw error;
            return ((data as CrewCandidate[]) ?? []).filter((u) => u.id !== excludeUserId);
          },
        });
      }
      ```

      Run the test again. Expected: PASS.

- [ ] **Step 11: Write the failing test for `CrewSelect`**

      `apps/frontend/src/components/pickup/CrewSelect.test.tsx` — render with a stub candidate
      list (mock `useCrewCandidates`) and assert:
      - every candidate renders as a toggleable row with an accessible name;
      - tapping one calls `onChange` with that id added; tapping again removes it;
      - the header shows the count (`EQUIPO · 2`);
      - an empty candidate list renders "No hay compañeros registrados" and no checkboxes.

- [ ] **Step 12: Run it, verify it fails, then implement**

      Run: `cd apps/frontend && npx vitest run src/components/pickup/CrewSelect.test.tsx --maxWorkers=2`
      Expected: FAIL — unresolved import. Then write `CrewSelect.tsx` (~90 lines): a labelled
      list of `min-h-[44px]` toggle rows using the same token classes as
      `PickupMobileClientGroup.tsx`, `value: string[]` / `onChange(next: string[])`, no
      internal state. It is its own component so `PickupMobileStartRoute.tsx` (233 lines)
      stays under the 300-line limit. Re-run: PASS.

- [ ] **Step 13: Wire the crew through `3j` and the mutation — failing test first**

      In `PickupMobileStartRoute.test.tsx`, add:

      ```tsx
      it('passes the ticked crew to onCreateRoute alongside the vehicle', async () => {
        const onCreateRoute = vi.fn();
        renderStartRoute({ onCreateRoute });
        await selectVehicle('AAA-111');
        await userEvent.click(screen.getByRole('button', { name: /ana pérez/i }));
        await userEvent.click(screen.getByRole('button', { name: /iniciar ruta/i }));
        expect(onCreateRoute).toHaveBeenCalledWith('vehicle-1', ['crew-1']);
      });

      it('opens a solo route when no crew is ticked', async () => {
        const onCreateRoute = vi.fn();
        renderStartRoute({ onCreateRoute });
        await selectVehicle('AAA-111');
        await userEvent.click(screen.getByRole('button', { name: /iniciar ruta/i }));
        expect(onCreateRoute).toHaveBeenCalledWith('vehicle-1', []);
      });
      ```

      and in `useStartPickupRoute.test.ts` (create if absent), assert the RPC receives
      `{ p_vehicle_id: 'v1', p_crew_user_ids: ['u1'] }`.

- [ ] **Step 14: Run them, verify they fail**

      Run: `cd apps/frontend && npx vitest run src/components/pickup/PickupMobileStartRoute.test.tsx src/hooks/pickup/useStartPickupRoute.test.ts --maxWorkers=2`
      Expected: FAIL — `expected "spy" to be called with … but got ['vehicle-1']`

- [ ] **Step 15: Implement the wiring**

      1. `PickupMobileStartRoute.tsx` — add `const [crewIds, setCrewIds] = useState<string[]>([])`,
         render `<CrewSelect …/>` between the `VehicleSelect` and the error line, and change
         the button to `onCreateRoute(vehicleId, crewIds)`. Update
         `PickupMobileStartRouteProps.onCreateRoute` to `(vehicleId: string, crewIds: string[]) => void`.

         **`crewIds` MUST be defaulted on `handleCreateRoute` itself:**
         ```ts
         const handleCreateRoute = async (vehicleId: string, crewIds: string[] = []) => {
         ```
         The desktop path still calls it with one argument: `PickupDesktopView.tsx:193`
         threads it to `PickupRouteDraftPanel.tsx:117` as `onStart`, and
         `StartRouteButton` invokes `onStart(vehicleId)`. Two required parameters is a
         `tsc` error on that prop type, and at runtime desktop would pass `undefined` as
         the crew. `StartRouteButton.tsx` itself needs **no** edit — but only because of
         this default, which is why it is called out here rather than left implicit.
      2. `useStartPickupRoute.ts` — `StartArgs` gains `crewUserIds?: string[]`, and the call
         becomes:
         ```ts
         const { data, error } = await supabase.rpc('start_pickup_route', {
           p_vehicle_id: vehicleId,
           p_crew_user_ids: crewUserIds ?? [],
         });
         ```
         The RPC's Spanish messages (`Solo un líder…`, `… ya está en la ruta …`) are rethrown
         verbatim, as they already are — no new error mapping, and none wanted: the RPC's
         message names the person and the route.
      3. `page.tsx:185` — `handleCreateRoute(vehicleId: string, crewIds: string[])` passes
         `{ vehicleId, crewUserIds: crewIds }` to `startMut.mutate`. The rest of the handler,
         including the partial-attach toast at `:200`, is untouched.

- [ ] **Step 16: Run them, verify they pass**

      Run: `cd apps/frontend && npx vitest run src/components/pickup src/hooks/pickup src/app/app/pickup --maxWorkers=2`
      Expected: all PASS

- [ ] **Step 17: Close the desktop hole**

      `1l` has its own start affordance — `PickupRouteDraftPanel.tsx:117` renders
      `StartRouteButton`. A `pickup_crew` user on a laptop would still see a button the RPC
      refuses. Add a `canLead` prop (default `true`, so no existing caller changes meaning),
      threaded from `page.tsx` through `PickupDesktopView.tsx:193`, and when it is false render
      the panel's body as the same one-line message instead of the button:

      ```tsx
      {canLead ? (
        <StartRouteButton … />
      ) : (
        <p className="px-4 py-3 text-[12.5px] text-text-secondary">
          Solo un líder de ruta puede abrir una ruta. Pídele que te agregue a la suya.
        </p>
      )}
      ```

      Add one test to `PickupRouteDraftPanel`'s suite (create the file if it has none)
      asserting that `canLead={false}` renders no button named `/iniciar ruta/i`.

- [ ] **Step 18: Full check**

      Run: `cd apps/frontend && npx tsc --noEmit && npx vitest run src/components/pickup src/hooks/pickup src/app/app/pickup src/components/sidebar --maxWorkers=2`
      Expected: no `tsc` output; all suites PASS.

- [ ] **Step 19: Commit**

      ```
      git add apps/frontend/src/components/pickup apps/frontend/src/hooks/pickup apps/frontend/src/app/app/pickup/page.tsx
      git commit -m "feat(spec-61): 3j is the leader's screen; crew get an honest one

      A crew member with no route sees who to ask instead of a vehicle picker and
      a start button that start_pickup_route would refuse. The leader picks the
      crew in 3j and it rides into the RPC in the same call. The desktop 1l draft
      panel is gated the same way -- it had its own start button."
      ```

### Task 6: `3h` shows who is on the trip

**Files:**
- Create: `apps/frontend/src/components/pickup/PickupRouteCrewStrip.tsx` + `.test.tsx`
- Modify: `apps/frontend/src/components/pickup/PickupMobileActiveRoute.tsx`

No edit path, by Decision 1. The crew is fixed when the route opens, and
`pickup_route_crew.removed_at` has exactly one writer — the trigger. Rendering an "add
someone" control here would need a second RPC, a second uniqueness path, and an answer to
"what happens to the loads they already scanned", none of which this spec settles.

- [ ] **Step 1: Write the failing test**

      `apps/frontend/src/components/pickup/PickupRouteCrewStrip.test.tsx`:

      ```tsx
      import { describe, it, expect } from 'vitest';
      import { render, screen } from '@testing-library/react';
      import { PickupRouteCrewStrip } from './PickupRouteCrewStrip';

      describe('PickupRouteCrewStrip', () => {
        it('names the leader first, then the crew', () => {
          render(
            <PickupRouteCrewStrip
              driverName="M. Rojas"
              crew={[
                { user_id: 'u1', full_name: 'Ana Pérez' },
                { user_id: 'u2', full_name: 'Luis Soto' },
              ]}
            />,
          );
          const names = screen.getAllByTestId('crew-member').map((n) => n.textContent);
          expect(names[0]).toMatch(/M\. Rojas/);
          expect(names).toHaveLength(3);
          expect(screen.getByText(/líder/i)).toBeInTheDocument();
        });

        it('renders nothing for a solo route rather than an empty header', () => {
          const { container } = render(
            <PickupRouteCrewStrip driverName="M. Rojas" crew={[]} />,
          );
          expect(container).toBeEmptyDOMElement();
        });

        // The crew is fixed once the route opens (spec-61 Task 6). No edit path.
        it('offers no way to add or remove anyone', () => {
          render(
            <PickupRouteCrewStrip
              driverName="M. Rojas"
              crew={[{ user_id: 'u1', full_name: 'Ana Pérez' }]}
            />,
          );
          expect(screen.queryByRole('button')).toBeNull();
        });

        it('falls back to a placeholder rather than showing an id', () => {
          render(
            <PickupRouteCrewStrip
              driverName={null}
              crew={[{ user_id: 'u1', full_name: null }]}
            />,
          );
          expect(screen.queryByText('u1')).toBeNull();
        });
      });
      ```

- [ ] **Step 2: Run it, verify it fails**

      Run: `cd apps/frontend && npx vitest run src/components/pickup/PickupRouteCrewStrip.test.tsx --maxWorkers=2`
      Expected: FAIL — `Failed to resolve import "./PickupRouteCrewStrip"`

- [ ] **Step 3: Minimal implementation**

      `PickupRouteCrewStrip.tsx` (~50 lines): an eyebrow `EQUIPO · N` and a wrapped row of
      name chips, the leader's carrying a `LÍDER` marker, each `data-testid="crew-member"`;
      `full_name ?? 'Sin nombre'` (the same choice `PickupMobileHeader` makes — never show a
      raw id); returns `null` when `crew.length === 0`. Read-only: no `<button>` anywhere.

- [ ] **Step 4: Run it, verify it passes**

      Run: `cd apps/frontend && npx vitest run src/components/pickup/PickupRouteCrewStrip.test.tsx --maxWorkers=2`
      Expected: PASS

- [ ] **Step 5: Render it on `3h` — failing test first**

      In `PickupMobileActiveRoute`'s suite (or `PickupMobileView.test.tsx`, which already
      renders the active-route branch), assert that with
      `activeRoute.crew = [{ user_id: 'u1', full_name: 'Ana Pérez' }]` the name appears on the
      screen. Run it, expect FAIL.

- [ ] **Step 6: Implement**

      In `PickupMobileActiveRoute.tsx`, directly under `<PickupMobileHeader …/>` (`:80-83`):

      ```tsx
            <PickupRouteCrewStrip
              driverName={activeRoute.driver?.full_name ?? null}
              crew={activeRoute.crew}
            />
      ```

      No new query: `activeRoute.crew` comes from `get_my_active_pickup_route` (Task 4).

- [ ] **Step 7: Run it, verify it passes**

      Run: `cd apps/frontend && npx vitest run src/components/pickup --maxWorkers=2`
      Expected: all PASS

- [ ] **Step 8: Commit**

      ```
      git add apps/frontend/src/components/pickup/PickupRouteCrewStrip.tsx apps/frontend/src/components/pickup/PickupRouteCrewStrip.test.tsx apps/frontend/src/components/pickup/PickupMobileActiveRoute.tsx apps/frontend/src/components/pickup/PickupMobileView.test.tsx
      git commit -m "feat(spec-61): 3h shows who is on the trip

      Read-only and no extra query -- the crew arrives in the same payload as the
      route. No edit path: the crew is fixed when the route opens, which is what
      makes removed_at's single writer (the status trigger) safe."
      ```

## Chunk 4 — `get_pending_manifests` stops offering routed loads

Independent of everything above and wrong today under any crew model: a load already attached
to a route still appears available to everyone, so two people claim it and the second gets
`manifest … already linked to another route %` raw from `add_manifest_to_route`
(`20260625000001…:385`).

### Task 7: exclude routed manifests

**Files:**
- Create: `packages/database/supabase/tests/spec61_pending_excludes_routed.sql`
- Create: `packages/database/supabase/migrations/20260820000005_spec61_pending_manifests_exclude_routed.sql`

**Caller audit, done — do not re-do it, but do re-run the grep before editing.**
`get_pending_manifests` has exactly one caller: `usePendingManifests`
(`hooks/pickup/useManifests.ts:53`), read at `app/app/pickup/page.tsx:79` into `pendingRows`,
which feeds the desktop `1l` "Manifiestos" tab (`PickupDesktopView`), the `3j` grouped list
(`PickupMobileStartRoute`), and the header totals (`pendingTotals`, `clientBreakdown`). No
agent, worker, n8n flow or other RPC calls it. The nav badge does **not**
(`20260817000001_spec54_nav_counts.sql:43-49` counts `manifests.status`) — so after this
change the badge and the list legitimately differ; see Decision 9.

- [ ] **Step 1: Re-run the caller audit**

      Run: `git grep -n "get_pending_manifests" -- . ':!node_modules'`
      Expected: hits only in `hooks/pickup/useManifests.ts`, its test, the migrations, seed and
      doc comments. If anything new appears, stop and re-read that caller before changing the
      predicate.

- [ ] **Step 2: Write the failing test**

      `packages/database/supabase/tests/spec61_pending_excludes_routed.sql`:

      ```sql
      -- spec-61 Task 7 — a load already on a route is not offered as available.
      BEGIN;

      INSERT INTO public.operators (id, name, slug)
      VALUES ('aaaaaaaa-0000-4000-a000-000000000640','Spec61 Pending','spec61-pending')
      ON CONFLICT (slug) DO NOTHING;

      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token
      ) VALUES
        ('aaaaaaaa-0000-4000-a000-000000000641','00000000-0000-0000-0000-000000000000',
         'authenticated','authenticated','pend-leader@spec61.test', crypt('x', gen_salt('bf')), NOW(),
         '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640","role":"pickup_leader"}'::jsonb,
         '{"full_name":"Lider Pend"}'::jsonb, NOW(), NOW(), '', '')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.users (id, operator_id, role, email, full_name, permissions)
      VALUES ('aaaaaaaa-0000-4000-a000-000000000641','aaaaaaaa-0000-4000-a000-000000000640',
              'pickup_leader','pend-leader@spec61.test','Lider Pend',ARRAY['pickup'])
      ON CONFLICT (id) DO UPDATE
        SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role;

      INSERT INTO public.vehicles (id, operator_id, plate, active)
      VALUES ('99999999-0000-4000-9000-000000000641','aaaaaaaa-0000-4000-a000-000000000640','VEH-64', true)
      ON CONFLICT DO NOTHING;

      -- Two CARGAs. trg_ensure_manifest_for_order (20260814000001) creates the
      -- manifests rows from these inserts -- do not insert manifests by hand.
      INSERT INTO public.orders (id, operator_id, order_number, external_load_id, retailer_name, status)
      VALUES
        ('66666666-0000-4000-6000-000000000641','aaaaaaaa-0000-4000-a000-000000000640','ORD-641','LOAD-FREE','Cliente A','pendiente'),
        ('66666666-0000-4000-6000-000000000642','aaaaaaaa-0000-4000-a000-000000000640','ORD-642','LOAD-ROUTED','Cliente A','pendiente');

      INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
      VALUES ('77777777-0000-4000-7000-000000000641','aaaaaaaa-0000-4000-a000-000000000640',
              'PR-61-P','aaaaaaaa-0000-4000-a000-000000000641','99999999-0000-4000-9000-000000000641','in_progress');

      UPDATE public.manifests
         SET pickup_route_id = '77777777-0000-4000-7000-000000000641'
       WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000640'
         AND external_load_id = 'LOAD-ROUTED';

      SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000641","operator_id":"aaaaaaaa-0000-4000-a000-000000000640","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640"}}';

      DO $$
      DECLARE loads TEXT[];
      BEGIN
        SELECT array_agg(external_load_id ORDER BY external_load_id)
          INTO loads FROM public.get_pending_manifests();

        IF 'LOAD-ROUTED' = ANY(COALESCE(loads,'{}')) THEN
          RAISE EXCEPTION 'a load already on a route must not be offered as available: %', loads;
        END IF;
        IF NOT ('LOAD-FREE' = ANY(COALESCE(loads,'{}'))) THEN
          RAISE EXCEPTION 'an unrouted load must still be offered: %', loads;
        END IF;
      END $$;

      -- The other columns are a contract (useManifests.ts PendingManifest) and this
      -- change must not disturb them.
      DO $$
      DECLARE r RECORD;
      BEGIN
        SELECT * INTO r FROM public.get_pending_manifests() WHERE external_load_id = 'LOAD-FREE';
        IF r.id IS NULL THEN RAISE EXCEPTION 'id must be the manifests row id'; END IF;
        IF r.verified_count <> 0 THEN RAISE EXCEPTION 'verified_count changed shape'; END IF;
      END $$;

      ROLLBACK;
      ```

- [ ] **Step 3: Run it, verify it fails**

      Run: `./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh run spec61_pending_excludes_routed`
      Expected: `FAIL` with `ERROR: a load already on a route must not be offered as available: {LOAD-FREE,LOAD-ROUTED}`

- [ ] **Step 4: Minimal implementation**

      `packages/database/supabase/migrations/20260820000005_spec61_pending_manifests_exclude_routed.sql`:
      copy the **whole** function from `20260813000001_spec53_package_labels.sql:151-229` — the
      latest definition, per CLAUDE.md's `CREATE OR REPLACE` rule — and change exactly one line
      inside the exclusion subquery at `:186`:

      ```sql
                AND (m.status = 'completed'
                     OR m.reception_status IS NOT NULL
                     OR m.pickup_route_id IS NOT NULL)
      ```

      with this header:

      ```sql
      -- =============================================================================
      -- spec-61 Task 7 — a load already on a route is not "pending"
      -- =============================================================================
      -- TEMPLATED ON THE LATEST DEFINITION: 20260813000001_spec53_package_labels.sql:151
      -- (spec-53's id/labels_printed_at/labels_printed_by_name columns). Templating
      -- on any earlier one would silently drop those and blank the "Imprimir
      -- etiquetas" button. Everything below is byte-for-byte that function except
      -- the one added OR in the exclusion subquery.
      --
      -- Independent of the crew model and wrong under all of them: a routed load
      -- stayed in the Activos list, so a second person could tick it and get a raw
      -- 'manifest ... already linked to another route' out of add_manifest_to_route
      -- (20260625000001:385) -- the partial-attach toast at page.tsx:200 is the only
      -- thing that ever surfaced it.
      --
      -- NOT a data risk: this is a function body, no constraint and no index, so it
      -- cannot abort a deploy on production rows. It DOES change what two live
      -- screens list -- the desktop 1l Manifiestos tab and mobile 3j -- both fed by
      -- the single caller usePendingManifests (useManifests.ts:53 -> page.tsx:79).
      -- Verified by grep on 2026-08-20: no other caller exists, in this repo or in
      -- apps/agents, apps/worker or the n8n flows.
      --
      -- The Recogida nav badge is deliberately NOT changed. It counts
      -- manifests.status IN ('pending','in_progress')
      -- (20260817000001_spec54_nav_counts.sql:43) -- the operator's outstanding
      -- workload, which a routed load is still part of. The list answers a
      -- different question ("what can I still claim"). They are meant to differ.
      -- =============================================================================
      ```

- [ ] **Step 5: Run it, verify it passes**

      Run: `./scripts/pgtap-local.sh sync && ./scripts/pgtap-local.sh apply && ./scripts/pgtap-local.sh run spec61_pending_excludes_routed`
      Expected: `spec61_pending_excludes_routed   PASS`

- [ ] **Step 6: Check the manifest-list neighbours did not move**

      Run:
      ```
      ./scripts/pgtap-local.sh run spec53_manifest_per_carga spec51_listo_para_despacho_pipeline_position spec55_carton_expansion
      cd apps/frontend && npx vitest run src/hooks/pickup/useManifests.test.ts src/app/app/pickup --maxWorkers=2
      ```
      Expected: `── pass=3 fail=0 ──` and all frontend suites PASS. The frontend needs no change
      — the return shape is identical, only the row set is smaller.

- [ ] **Step 7: Verify migration numbering before pushing**

      Run: `bash scripts/check-migration-versions.sh`
      Expected: `check-migration-versions: OK — N migrations, all version prefixes unique`.
      If another branch merged a `202608200000NN` first, renumber **this** file (it has not
      reached production yet) — never one that has.

- [ ] **Step 8: Commit**

      ```
      git add packages/database/supabase/migrations/20260820000005_spec61_pending_manifests_exclude_routed.sql packages/database/supabase/tests/spec61_pending_excludes_routed.sql
      git commit -m "fix(spec-61): get_pending_manifests stops offering routed loads

      A load already attached to a route stayed in the Activos list, so a second
      person could claim it and get a raw rejection out of add_manifest_to_route.
      Templated on the spec-53 definition -- an earlier template would drop the
      label-printing columns. The nav badge is deliberately left alone: it counts
      the operator's outstanding workload, not what you can still claim."
      ```

## Closing out

- [ ] Set `**Status:**` to `in progress` in this file with the first implementation commit,
      per `docs/specs/CLAUDE.md`. Only the user moves it to `completed`.
- [ ] Push the branch, open the PR, and enable auto-merge in the same step:
      `gh pr create` then `gh pr merge --auto --squash` (CLAUDE.md — never skip the second).
- [ ] Confirm before reporting done: `gh pr checks <N>` green and
      `gh pr view <N> --json state,mergedAt` showing merged.
- [ ] Ask the user to run `create-qa-users.sh` on the QA VPS (Task 2, Step 7) and confirm
      `qa-pickup-leader@qa.test` can log in and open a route. Until that happens, QA has a
      leader-only flow and no leader.

### Risks to carry

**A reopened route can strand its crew, permanently.** The restore branch of the
route-status trigger skips any seat whose holder is active elsewhere — correct, because
otherwise a receptionist's undo aborts on a 23505 — but nothing ever retries. That
person's `removed_at` stays set, so `get_my_active_pickup_route()` returns NULL for them
while the route they were on is `in_progress` again. They land on the no-route screen
with no explanation, and Decision 1 (crew fixed at creation, no `add_crew_to_route`)
means there is no way back onto it.

The same shape reaches further: the trigger is `AFTER UPDATE` only, so a crew row
inserted against a route that is not `in_progress` is never stamped at all, and blocks
that person from every future route.

Two things follow, and neither is optional:

- The Task 1.2 test that asserts the skipped-seat state must **not** describe it as
  correct. Assert the behaviour, and name it as a known limitation in the same breath.
- Decide whether a stranded seat gets any signal — at minimum the crew screen should be
  able to say "you were on a route that reopened without you" rather than showing the
  same blank state as someone who was never on one. If the answer is "no signal for now",
  write that down here rather than leaving it to be discovered on a warehouse floor.


- **The enum change touches auth.** Eight migrations reference `user_role` and RLS policies
  read it (`20260216170542:86` restricts user writes to `admin`/`operations_manager`; the JWT
  claims hook copies `users.role` into the token). Adding a value changes no existing row and
  no existing predicate — which is exactly why Task 1.1 is additive-only and alone in its
  file. A mistake here does not fail a test, it locks people out: if anything in Task 1
  tempts you into editing an existing policy, stop and re-read this line.
- **Adding an enum value is irreversible.** Stated in the migration header; Postgres cannot
  remove one.
- **Deploys abort on data, not code** — the spec-56 lesson. The only new constraint in this
  plan, `uniq_pickup_route_crew_one_active_per_user`, is built over a table created in the
  same migration, so it has no rows to fail on. **If a later revision adds a constraint over
  `pickup_routes` or `users` (for example, requiring `driver_id` to be a leader), it needs a
  pre-flight count against production first** — spec-56's Gate 1 is the worked example.
  Nothing in this plan needs that gate, and saying so is part of the deliverable.
- **QA has no leader until Task 2 ships one, and shipping it is not enough.**
  `create-qa-users.sh` runs only from `setup-qa.sh` (`deploy-qa.sh:175`), so the row added to
  the script does not reach QA on merge. The moment Task 2's migration lands,
  `qa-pickup-crew@qa.test` — the account the entire seeded pickup scenario is built around
  (`seed-qa.sql:326-340`) — can no longer open a route, and no other QA account can either.
  Between merge and someone running the script, the QA pickup flow is dead.
- **A promoted user keeps the old role until they log in again.** The client reads `role` from
  the JWT claim (`GlobalContext.tsx:53`), minted at login. Grant `pickup_leader` in `/admin`
  and the user still sees the crew screen until their token refreshes. The RPC reads
  `public.users` directly, so the *server* is right immediately — the symptom is a leader who
  cannot see the button but could use the API. Tell whoever runs the QA pass to log out and
  back in after a role change.
- **Leader/crew overlap has no index.** `uniq_pickup_route_crew_one_active_per_user` covers
  crew-to-crew only; someone leading route A being added as crew on route B is caught by the
  RPC's pre-flight and nowhere else. Any future writer of `pickup_route_crew` must repeat that
  check — which is one more reason there is exactly one writer.

## Non-goals

- The per-vehicle uniqueness index (spec-56 owns it).
- Assignment of manifests to individual users (`assigned_to_user_id` stays dead).
- Any change to how scanning or attribution works — both already support several
  people on one load.
