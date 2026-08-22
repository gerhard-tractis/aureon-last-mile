# Spec-66: `ops_leader` — one floor role that works all four stations

> **Related:** [spec-61](spec-61-pickup-route-crew.md) (introduced `pickup_leader`; the
> role gate on `start_pickup_route` this spec extends),
> [spec-54](spec-54-ui-rebrand.md) (the mobile bottom tab bar and `OPERATIONS_ROLES`),
> [spec-45](spec-45-module-activation-layer.md) (per-operator module activation)

**Status:** backlog

_Date: 2026-08-22_

---

## Problem

No role lets one person work all four operational screens without also handing them
the management side of the product.

The four screens — Recogida, Recepción, Distribución, Despacho — are gated by
**permissions** (`_client-gate.tsx` on each module, `isVisible` in
`components/sidebar/navigation.ts`). The shell a user gets is chosen by **role**
(`OPERATIONS_ROLES` → the bottom tab bar; anything else → the hamburger `Sheet`).
Today those two facts cannot be combined into "floor worker who does everything":

| Role | Reaches 4 screens | Shell |
|---|---|---|
| `pickup_crew` / `pickup_leader` | no (pickup only) | 4-tab bar |
| `warehouse_staff` | no (reception + distribution) | 4-tab bar |
| `loading_crew` | no (distribution + dispatch) | 4-tab bar |
| `operations_manager` | **yes** | hamburger, plus every management surface |

`operations_manager` is the only role that reaches all four, and it is the wrong
tool: it also grants Torre de control, Dashboard ejecutivo, Capacidad, Auditoría,
the order inspector and the `/` search palette, and it drops the user into the
desktop-derived hamburger shell rather than the tab bar built for the floor.

### Why the obvious workaround does not work

Permissions are a free-form `text[]`, so an admin can tick all four boxes on a
`warehouse_staff` user. That gets the shell right — `warehouse_staff` is already an
operations role, so all four tabs render and unlock — but **Recogida is a dead end**:

- `start_pickup_route` refuses any role outside
  `('pickup_leader','operations_manager','admin','super_admin')`
  (`20260820000003_spec61_start_pickup_route_crew.sql:143`). It reads
  `public.users.role` directly and never consults permissions, so the `pickup`
  grant buys nothing. The user cannot open a route.
- `useCrewCandidates.ts:36` lists crew candidates with
  `.in('role', ['pickup_crew','pickup_leader'])`, so the user does not appear in
  any leader's crew picker either. They cannot be added to someone else's route.

The result is the "No tienes una ruta activa · Pídele a tu líder que te agregue a
su ruta" dead end, with no leader able to add them. Permissions decide **which
screens open**; role decides **what may be done inside Recogida**. Spec-61 created
that split deliberately, and a permission grant cannot route around it.

## Decision

**Add a `ops_leader` role: an operations role with all four permissions and full
pickup-route authority.**

- Four live tabs, no hamburger, no management surfaces.
- Permissions `['pickup','reception','distribution','dispatch']` — no
  `customer_service`, no `admin`.
- May open a pickup route (joins the `start_pickup_route` gate) **and** may be
  added to another leader's route (joins the crew picker). Both halves, so
  Recogida has no dead end in either direction.

### Rejected alternatives, and why

| Option | Why not |
|---|---|
| Use `pickup_leader` with all four permissions ticked | Works today with zero code, and is the recommended stopgap until this ships. Rejected as the answer: the role name misdescribes the job, and it is a manual per-user grant indistinguishable from an accident. New hires do not get it. |
| Use `operations_manager` | Reaches all four screens but drags in every management surface and the wrong shell. This is the problem, not the fix. |
| Replace the role gate with a `pickup_lead` permission token | Cleaner long term — permissions would become the single vocabulary — but it rewrites spec-61's deliberate role-based security gate and touches `start_pickup_route`'s authorisation for no benefit this spec needs. Out of scope. |
| Grant the four permissions but leave route authority alone | This is exactly the `warehouse_staff` workaround above, and it is the dead end the Problem section describes. |

### Relationship to spec-61

Spec-61 restricted route creation so that a forgotten crew member fails **loudly**
(blocked immediately) rather than silently (opens a second route for the same van,
discovered at reception). This spec adds a second role that may create routes.

That argument still holds: the set of people who may open a route stays small and
explicit, and a crew member who is not on the route is still blocked immediately.
What changes is only that a second, deliberately-named role is on the list. This
widening is intentional and is recorded here so it is not read later as drift.

## What is deliberately NOT changed

Both of these already work for an `ops_leader` without modification, and touching
them would be a security regression:

- **`cancel_pickup_route`** authorises the route's own `driver_id` regardless of
  role, plus `operations_manager`/`admin`/`super_admin`
  (`20260821000001_spec61_cancel_pickup_route_authz.sql:102,131`). An `ops_leader`
  cancelling their own route passes the `driver_id` check for free. `ops_leader`
  must **not** be added to the manager override list, for the same reason that
  migration's header gives for `pickup_leader`: leading routes is not authority
  over someone else's route. That migration carries a guard at line 175 that raises
  if `pickup_leader` appears in the function source; this spec adds the equivalent
  assertion for `ops_leader`.
- **`add_manifest_to_route`** is authorised by the route's driver, not by role
  (`tests/add_manifest_to_route_authz.sql:16`). Works for free.

## Implementation

### Task 1 — enum value (migration, alone)

`ALTER TYPE … ADD VALUE` cannot be used in the same transaction that reads the new
value, so the enum lands in its own migration, exactly as spec-61 Task 1.1 did.

```sql
-- packages/database/supabase/migrations/<ts>_spec66_user_role_ops_leader.sql
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'ops_leader';
```

### Task 2 — role defaults in `handle_new_user` (migration)

`CREATE OR REPLACE FUNCTION public.handle_new_user`, adding one branch:

```sql
WHEN 'ops_leader' THEN ARRAY['pickup','reception','distribution','dispatch']
```

**Template:** the **latest** definition, `20260820000002_spec61_pickup_route_crew.sql:191`
— not the original in `20260216170542`, and not `20260811000001`. Per CLAUDE.md,
a `CREATE OR REPLACE` that starts from an older body silently reverts everything
added since.

Note this branch only applies when the caller passes no explicit permissions:
`app/api/users/route.ts` overwrites the trigger's defaults with the admin form's
checked boxes immediately after creation.

### Task 3 — route-leader gate (migration)

`CREATE OR REPLACE FUNCTION public.start_pickup_route`, adding `'ops_leader'` to
the refusal list at `20260820000003_spec61_start_pickup_route_crew.sql:143`:

```sql
OR v_role::text NOT IN ('ops_leader','pickup_leader','operations_manager','admin','super_admin') THEN
```

**Template:** `20260820000003`, the latest definition. Everything else in the body
— the operator-scoped role lookup, vehicle validation, the Spanish refusal message
— is carried across unchanged.

### Task 4 — frontend role lists

| File | Change |
|---|---|
| `components/sidebar/navigation.ts:184` | add `'ops_leader'` to `OPERATIONS_ROLES` → four-tab shell, hamburger suppressed |
| `lib/permissions.ts:85` | add to `ROUTE_LEADER_ROLES` → the start-route control renders |
| `lib/permissions.ts:47` | add `ops_leader: ['pickup','reception','distribution','dispatch']` to `ROLE_DEFAULT_PERMISSIONS` (a reference copy of the SQL CASE with no runtime consumer; its test enforces parity) |
| `hooks/pickup/useCrewCandidates.ts:36` | add to `.in('role', […])` → appears in a leader's crew picker |
| `lib/validation/userSchema.ts` | both `z.enum` lists, plus a `roleOptions` entry `{ value: 'ops_leader', label: 'Ops Leader', color: 'gray' }` — English label, matching its six neighbours |
| `app/api/users/route.ts:38`, `app/api/users/[id]/route.ts:10` | `z.enum` lists |
| `lib/api/users.ts:9,15` | TS unions |
| `lib/types/auth.types.ts` | enum member + `roleNames` entry at line 201 — typed `Record<UserRole, string>`, so the compiler *requires* it once the enum member exists; keep the label in sync with `roleOptions` |
| `lib/types.ts`, `packages/database/src/database.types.ts`, `packages/database/src/enums.ts` | regenerated Supabase types |
| `packages/database/seed-qa/lib/enums.ts` | the QA scenario seed refuses to run on enum drift, so it must carry the new value |

**Ordering constraint (ships broken if ignored).** The `roleOptions` entry must not
reach production ahead of Task 1's migration. An admin selecting "Ops Leader"
before the enum has the value makes `handle_new_user`'s `::user_role` cast fail
with Postgres `22P02`, surfaced as a 500 from `auth.admin.createUser`. This exact
trap is documented at `lib/validation/userSchema.ts:62` for `pickup_leader`.
Because `deploy.yml` applies migrations and builds the frontend in the same run,
shipping Tasks 1–4 in one PR satisfies this; splitting them across PRs does not.

### Task 5 — tests (TDD, written before the change)

- `components/sidebar/navigation.test.ts` — `buildMobileTabs` for `ops_leader` with
  all four permissions and all four modules enabled returns four tabs, none
  `disabled`; with a module disabled the corresponding tab is `disabled`, not absent
- `components/AppLayout.test.tsx` — `ops_leader` renders no "Abrir barra lateral"
  button
- `lib/permissions.test.ts` — `canLeadPickupRoute('ops_leader')` is true; the
  existing `ROLE_DEFAULT_PERMISSIONS`/CASE parity assertion covers the new entry
- new `packages/database/supabase/tests/spec66_ops_leader_route_authz.sql` —
  an `ops_leader` may call `start_pickup_route`; a `warehouse_staff` with the
  `pickup` permission still may not (the regression this spec exists to fix);
  and an assertion that `'ops_leader'` does **not** appear in
  `cancel_pickup_route`'s source, mirroring the `pickup_leader` guard at
  `20260821000001:175`
- `packages/database/supabase/tests/rbac_users_test.sql` — the trigger assigns the
  four permissions to a new `ops_leader`

### Task 6 — QA

- add `qa-ops-leader@qa.test` to `create-qa-users.sh` and to the users table in
  `docs/qa-environment.md`
- verify on QA at 390px: four live tabs; open a pickup route with a vehicle; add a
  crew member; scan into Recepción; Distribución and Despacho reachable; confirm no
  hamburger and no Torre de control / Dashboard / Auditoría / Admin

## Risks

- **Two roles may now open pickup routes.** Discussed under "Relationship to
  spec-61". Accepted deliberately.
- **Role lists are enumerated in ~13 places.** Missing one produces a partial role
  that looks correct until a specific screen is used — the `useCrewCandidates`
  filter is the easiest to miss, and missing it recreates the exact dead end this
  spec fixes. Task 5's advisory SQL test and the navigation tests are the guard.
- **The JWT `role` claim is minted at login** (`lib/context/GlobalContext.tsx:58`).
  A user promoted to `ops_leader` keeps the old shell and the old start-route answer
  until their token refreshes — they must sign out and back in. Same behaviour
  spec-61 documented for `pickup_leader`; worth stating in the QA steps so it is not
  reported as a bug.
- **No existing users are migrated.** The enum value is added; assignment is
  per-user through `/admin`. If accounts should be converted, that is a follow-up
  and needs the re-login note above.
