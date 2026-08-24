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
| `components/sidebar/navigation.mobile.ts:32` | add `'ops_leader'` to `OPERATIONS_ROLES` → four-tab shell, hamburger suppressed |
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

- `components/sidebar/navigation.mobile.test.ts` — `buildMobileTabs` for `ops_leader` with
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

---

# Implementation Plan

> **For agentic workers:** use `superpowers:executing-plans` to implement this
> plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `ops_leader` role that works all four operational screens from the
mobile tab-bar shell, with full pickup-route authority and no management surfaces.

**Architecture:** Three migrations extend the database's role vocabulary and the
`start_pickup_route` gate. The frontend change is purely additive — `ops_leader`
joins four existing role lists, and every downstream behaviour (tab bar,
start-route control, crew picker, admin dropdown) follows from those lists. No new
components.

**Tech Stack:** Postgres/Supabase (SQL migrations; plain-SQL advisory tests run via
`scripts/pgtap-local.sh`), Next.js App Router, TypeScript, Vitest + Testing Library.

## Ground rules

1. **One branch, one PR.** The `roleOptions` dropdown entry must not reach
   production before the enum migration (`22P02` → 500 from
   `auth.admin.createUser`). `deploy.yml` applies migrations and builds the
   frontend in the same run, so one PR is safe and splitting is not.
2. **CI does not run SQL tests** — only lint / type-check / `test:run` / build. The
   advisory suite is a local docker harness and must be run by hand (Task 4).
3. **Three existing tests assert exact role sets** and go RED the moment the role is
   added. That is the TDD entry point, not a breakage:
   `navigation.mobile.test.ts:18`, `permissions.test.ts:16`,
   `permissions.test.ts:35`.
6. **`navigation.ts` was split after this plan was written** (PR #520 era): the
   mobile tab logic — `OPERATIONS_ROLES`, `isOperationsRole`, `buildMobileTabs`,
   `isImmersiveMobileRoute` — now lives in `navigation.mobile.ts`, with
   `navigation.breadcrumbs.ts` alongside it. File paths below are updated; the
   symbols and their behaviour are unchanged.
4. **`CREATE OR REPLACE` uses the latest definition as template** (CLAUDE.md).
   Named per task. Starting from an older body silently reverts everything since.
5. Frontend tests: `cd apps/frontend && npx vitest run <path>`.

---

## Chunk 1: Database

### Task 1: Add the enum value

**Files:** Create `packages/database/supabase/migrations/20260823000001_spec66_user_role_ops_leader.sql`

`ALTER TYPE … ADD VALUE` cannot run in the same transaction that reads the value, so
this migration contains nothing else. Same split spec-61 used.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- spec-66: ops_leader — one floor role that works all four stations
-- =============================================================================
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that reads
-- the new value, so this migration adds the value and nothing else. The
-- handle_new_user CASE that uses it is 20260823000002; the start_pickup_route
-- gate is 20260823000003. Same split spec-61 used for pickup_leader.
--
-- No user is migrated onto this role. Assignment is per-user through /admin.
-- =============================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'ops_leader';
```

- [ ] **Step 2: Commit**

```bash
git add packages/database/supabase/migrations/20260823000001_spec66_user_role_ops_leader.sql
git commit -m "feat(spec-66): add ops_leader to the user_role enum"
```

### Task 2: Role defaults in `handle_new_user`

**Files:** Create `packages/database/supabase/migrations/20260823000002_spec66_ops_leader_defaults.sql`
· Template `20260820000002_spec61_pickup_route_crew.sql`

- [ ] **Step 1: Copy the CURRENT function body**

```bash
sed -n '/CREATE OR REPLACE FUNCTION public.handle_new_user/,/^\$function\$;/p' \
  packages/database/supabase/migrations/20260820000002_spec61_pickup_route_crew.sql
```

This is the only correct template. Do NOT start from `20260216170542` or
`20260811000001` — both are older, and re-issuing either drops the `pickup_leader`
branch.

- [ ] **Step 2: Write the migration**

Paste that body verbatim, adding exactly one line to the `v_permissions` CASE,
directly after the `pickup_leader` branch:

```sql
    WHEN 'ops_leader'         THEN ARRAY['pickup','reception','distribution','dispatch']
```

Header comment to carry:

```sql
-- spec-66: ops_leader's defaults. Template is 20260820000002 (the latest
-- definition of handle_new_user), per CLAUDE.md. Only the v_permissions CASE
-- changes; everything else is carried across unchanged.
--
-- These defaults apply only when the caller passes no explicit permissions:
-- app/api/users/route.ts overwrites them with the admin form's checked boxes
-- immediately after creation. lib/permissions.ts ROLE_DEFAULT_PERMISSIONS
-- mirrors this CASE (Task 6) and its test enforces parity.
```

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260823000002_spec66_ops_leader_defaults.sql
git commit -m "feat(spec-66): give a new ops_leader all four station permissions"
```

### Task 3: Extend the `start_pickup_route` role gate

**Files:** Create `packages/database/supabase/migrations/20260823000003_spec66_start_pickup_route_ops_leader.sql`
· Template `20260820000003_spec61_start_pickup_route_crew.sql`

- [ ] **Step 1: Copy the CURRENT function body**

```bash
sed -n '/CREATE OR REPLACE FUNCTION public.start_pickup_route/,/^\$function\$;/p' \
  packages/database/supabase/migrations/20260820000003_spec61_start_pickup_route_crew.sql
```

- [ ] **Step 2: Write the migration, changing ONE line**

Line 143 of the template:

```sql
     OR v_role::text NOT IN ('pickup_leader','operations_manager','admin','super_admin') THEN
```

becomes:

```sql
     OR v_role::text NOT IN ('ops_leader','pickup_leader','operations_manager','admin','super_admin') THEN
```

Everything else — the operator-scoped role lookup, the vehicle validation block, the
Spanish refusal message — carries across unchanged. Header comment:

```sql
-- spec-66: ops_leader joins the set of roles that may open a pickup route.
-- Template is 20260820000003 (the latest definition), per CLAUDE.md. Exactly
-- one line changes: the role list in the refusal below.
--
-- NOT changed, deliberately: cancel_pickup_route (20260821000001). It
-- authorises the route's own driver_id regardless of role, so an ops_leader
-- cancelling their own route already passes. Adding ops_leader to its manager
-- override list would repeat the mistake that migration's header warns about
-- for pickup_leader — leading routes is not authority over someone else's
-- route. spec66_ops_leader_route_authz.sql asserts it stays out.
```

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260823000003_spec66_start_pickup_route_ops_leader.sql
git commit -m "feat(spec-66): let an ops_leader open a pickup route"
```

### Task 4: Advisory SQL test

**Files:** Create `packages/database/supabase/tests/spec66_ops_leader_route_authz.sql`

Convention (see `tests/rbac_users_test.sql`): plain SQL in `BEGIN` … `ROLLBACK`,
fixtures created by inserting into `auth.users` and letting the
`on_auth_user_created` trigger run `handle_new_user`, failures raised with
`RAISE EXCEPTION`. No pgTAP assertions needed.

- [ ] **Step 1: Write the test** — cover four things:

1. a trigger-created `ops_leader` has exactly
   `['pickup','reception','distribution','dispatch']` (proves Task 2)
2. an `ops_leader` may call `start_pickup_route` (proves Task 3)
3. a `warehouse_staff` **holding the `pickup` permission** still may not — the
   regression this spec exists to fix, and the row proving permissions did not
   become a way around the role gate
4. `'ops_leader'` does **not** appear in `cancel_pickup_route`'s source, mirroring
   the `pickup_leader` guard at `20260821000001:175`:

```sql
SELECT prosrc INTO v_src FROM pg_proc
 WHERE proname = 'cancel_pickup_route'
   AND pronamespace = 'public'::regnamespace;

IF v_src LIKE '%ops_leader%' THEN
  RAISE EXCEPTION 'cancel_pickup_route authorises ops_leader — leading routes is not authority over someone else''s route';
END IF;
```

- [ ] **Step 2: Run it — the only verification SQL gets**

```bash
./scripts/pgtap-local.sh up          # first run only
./scripts/pgtap-local.sh sync
./scripts/pgtap-local.sh apply
./scripts/pgtap-local.sh run spec66_ops_leader_route_authz
```

Expected: `pass`. CI will **not** catch a failure here.

- [ ] **Step 3: Re-run the spec-61 suite for regressions**

Tasks 2 and 3 re-issue two functions spec-61 owns:

```bash
./scripts/pgtap-local.sh run rbac_users_test add_manifest_to_route_authz \
  spec47_single_active_route_per_driver route_reception_snapshot_contract
```

Expected: all pass. A failure means a `CREATE OR REPLACE` used the wrong template
and dropped behaviour.

- [ ] **Step 4: Commit**

```bash
git add packages/database/supabase/tests/spec66_ops_leader_route_authz.sql
git commit -m "test(spec-66): ops_leader may open a route; permission alone still may not"
```

---

## Chunk 2: Frontend role lists

Each task is genuinely test-first: the assertion already exists and passes with the
old set, so editing it to the new set turns it RED before any source change.

### Task 5: `OPERATIONS_ROLES` — the four-tab shell

**Files:** Modify `apps/frontend/src/components/sidebar/navigation.mobile.ts:32-37`
· Test `apps/frontend/src/components/sidebar/navigation.mobile.test.ts:14-30`

- [ ] **Step 1: Make the test fail** — add `'ops_leader'` to the expected set:

```ts
  it('covers every floor role that works on a phone', () => {
    expect([...OPERATIONS_ROLES].sort()).toEqual(
      ['loading_crew', 'ops_leader', 'pickup_crew', 'pickup_leader', 'warehouse_staff'].sort(),
    );
  });
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd apps/frontend && npx vitest run src/components/sidebar/navigation.mobile.test.ts
```

Expected: FAIL — received array lacks `ops_leader`.

- [ ] **Step 3: Add the role** in `navigation.mobile.ts:32`:

```ts
export const OPERATIONS_ROLES = [
  'pickup_crew',
  'pickup_leader',
  // spec-66 — works all four stations; the tab bar is its only navigation.
  'ops_leader',
  'warehouse_staff',
  'loading_crew',
] as const;
```

- [ ] **Step 4: Run to verify it passes**

Same command. Expected: PASS. The existing "gives every operations role the full
four-tab bar" test (line 282) now covers `ops_leader` automatically.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/sidebar/navigation.mobile.ts apps/frontend/src/components/sidebar/navigation.mobile.test.ts
git commit -m "feat(spec-66): give ops_leader the four-tab mobile shell"
```

### Task 6: `ROUTE_LEADER_ROLES` and `ROLE_DEFAULT_PERMISSIONS`

**Files:** Modify `apps/frontend/src/lib/permissions.ts:47` and `:85`
· Test `apps/frontend/src/lib/permissions.test.ts:15-27` and `:34-42`

- [ ] **Step 1: Make both tests fail**

Add `'ops_leader'` to the expected key list at `permissions.test.ts:16-26`, add it to
the `ROUTE_LEADER_ROLES` set at line 36, add
`expect(canLeadPickupRoute('ops_leader')).toBe(true);`, and add:

```ts
  it('gives an ops_leader all four stations and no management token', () => {
    expect(ROLE_DEFAULT_PERMISSIONS.ops_leader).toEqual([
      'pickup', 'reception', 'distribution', 'dispatch',
    ]);
    expect(ROLE_DEFAULT_PERMISSIONS.ops_leader).not.toContain('customer_service');
    expect(ROLE_DEFAULT_PERMISSIONS.ops_leader).not.toContain('admin');
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/frontend && npx vitest run src/lib/permissions.test.ts
```

Expected: FAIL on all three.

- [ ] **Step 3: Add the entries**

`permissions.ts:47`, inside `ROLE_DEFAULT_PERMISSIONS`, after `pickup_leader`:

```ts
  // spec-66 — mirrors the handle_new_user CASE in migration 20260823000002.
  // Four stations, no customer_service, no admin.
  ops_leader: ['pickup', 'reception', 'distribution', 'dispatch'],
```

`permissions.ts:85`:

```ts
export const ROUTE_LEADER_ROLES = [
  'ops_leader',
  'pickup_leader',
  'operations_manager',
  'admin',
  'super_admin',
] as const;
```

This list must never be more permissive than the RPC — it now matches migration
`20260823000003` exactly.

- [ ] **Step 4: Run to verify they pass** — same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/permissions.ts apps/frontend/src/lib/permissions.test.ts
git commit -m "feat(spec-66): ops_leader defaults and route-leader authority"
```

### Task 7: The crew picker

**Files:** Modify `apps/frontend/src/hooks/pickup/useCrewCandidates.ts:36`

Without this an `ops_leader` cannot be **added** to another leader's route — half the
dead end the spec exists to remove, and the easiest touch point to miss.

- [ ] **Step 1: Add the role**

```ts
        // spec-66 — an ops_leader both leads routes and joins someone else's.
        .in('role', ['pickup_crew', 'pickup_leader', 'ops_leader'])
```

- [ ] **Step 2: Run the pickup hook tests**

```bash
cd apps/frontend && npx vitest run src/hooks/pickup
```

Expected: PASS. No existing test asserts the exact list; the QA walk in Task 10 is
what proves this end to end.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/hooks/pickup/useCrewCandidates.ts
git commit -m "feat(spec-66): an ops_leader can be added to another leader's route"
```

### Task 8: The shell, asserted at the layout level

**Files:** Test `apps/frontend/src/components/AppLayout.test.tsx` (add beside line 515)

- [ ] **Step 1: Write the test**

```tsx
  it('gives an ops_leader four live tabs and no hamburger', () => {
    mockRole = 'ops_leader';
    mockPermissions = ['pickup', 'reception', 'distribution', 'dispatch'];
    mockPathname = '/app/pickup';
    render(
      <AppLayout enabledModules={[ModuleKey.PICKUP, ModuleKey.RECEPTION, ModuleKey.DISTRIBUTION, ModuleKey.DISPATCH]}>
        <div>content</div>
      </AppLayout>,
    );
    const tabBar = screen.getByRole('navigation', { name: /navegación principal/i });
    for (const label of ['Recogida', 'Recepción', 'Distribución', 'Despacho']) {
      expect(within(tabBar).getByRole('link', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Abrir barra lateral' })).toBeNull();
  });
```

Asserting `getByRole('link')` for all four is the point: a `TabDisabled` renders a
`<span>`, not a link, so this fails if any permission is missing.

- [ ] **Step 2: Run it**

```bash
cd apps/frontend && npx vitest run src/components/AppLayout.test.tsx
```

If Tasks 5–6 are already committed this passes immediately — fine. Its value is
proving the whole shell decision end to end rather than the list in isolation.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/AppLayout.test.tsx
git commit -m "test(spec-66): ops_leader gets four live tabs and no hamburger"
```

---

## Chunk 3: Type surfaces, admin UI, QA

### Task 9: Role enumerations and the admin dropdown

All additive, one commit:

- `apps/frontend/src/lib/types/auth.types.ts` — `UserRole` member
  `OPS_LEADER = 'ops_leader'` and the `roleNames` entry at line 201. `roleNames` is
  typed `Record<UserRole, string>`, so the compiler **requires** the entry once the
  member exists — a missing label is a type error, not a runtime bug.
- `apps/frontend/src/lib/validation/userSchema.ts` — both `z.enum` lists (lines 30,
  44) and a `roleOptions` entry
  `{ value: 'ops_leader', label: 'Ops Leader', color: 'gray' }`. English label, to
  match its six neighbours.
- `apps/frontend/src/app/api/users/route.ts:38` and
  `apps/frontend/src/app/api/users/[id]/route.ts:10` — `z.enum` lists.
- `apps/frontend/src/lib/api/users.ts:9,15` — TS unions.
- `apps/frontend/src/lib/types.ts` and `packages/database/src/database.types.ts` —
  the generated `user_role` union. Hand-edit to add `"ops_leader"`; regenerating
  needs `SUPABASE_PROJECT_REF` and pulls unrelated drift.
- `packages/database/src/enums.ts:24` — add to `USER_ROLES`. **Note:** this list is
  missing `pickup_leader` (spec-61 never updated it). Add both while here and say so
  in the commit message — a stale enum mirror is the class of bug this spec fixes
  elsewhere.
- `packages/database/seed-qa/lib/enums.ts:44` — add to `user_role`. The QA scenario
  seed **refuses to run** on enum drift, so omitting this breaks seeding.

- [ ] **Step 1: Make the edits**
- [ ] **Step 2: Type-check both packages**

```bash
cd apps/frontend && npx tsc --noEmit
cd ../../packages/database && npx tsc --noEmit
```

Expected: clean. A `Record<UserRole, string>` error means the `roleNames` entry is
missing.

- [ ] **Step 3: Full frontend suite**

```bash
cd apps/frontend && npx vitest run
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(spec-66): expose ops_leader in the role enums and admin dropdown"
```

### Task 10: QA user and verification

**Files:** Modify `infra/supabase-qa/create-qa-users.sh:100-108` and
`docs/qa-environment.md:133-142`

- [ ] **Step 1: Add the QA row**

```
ops_leader|$QA_OPERATOR_ID|pickup,reception,distribution,dispatch|00000000-0000-4000-8000-000000000208
```

Use the **app** permission vocabulary shown above. The existing rows still use the
legacy `warehouse` / `loading` / `operations` tokens that migration `20260811000001`
retired — a pre-existing QA-seed defect, out of scope here, but do not copy the
pattern into the new row. Update the header comment at lines 16-18 and the users
table in `docs/qa-environment.md`.

- [ ] **Step 2: Open the PR**

```bash
git push -u origin feat/spec-66-ops-leader
gh pr create --title "feat(spec-66): ops_leader — one floor role that works all four stations"
gh pr merge --auto --squash
```

- [ ] **Step 3: Verify on QA after the deploy**

Sign in as `qa-ops-leader@qa.test` at 390px and confirm:

1. four live tabs, no `Lock` badges, no hamburger
2. no Torre de control / Dashboard / Capacidad / Auditoría / Admin anywhere
3. Recogida: open a route with a vehicle → succeeds (Task 3 working)
4. add a crew member to that route → the picker lists candidates (Task 7)
5. as a `pickup_leader`, the `ops_leader` appears in *their* crew picker
6. cancel the route as its own driver → succeeds with no migration change
7. Recepción, Distribución, Despacho all open and accept a scan

**Expected gotcha:** the `role` claim is minted at login
(`lib/context/GlobalContext.tsx:58`). A user promoted to `ops_leader` keeps the old
shell and the old start-route answer until they sign out and back in. Sign out
first; this is not a bug.

- [ ] **Step 4: Confirm merged, then update Status**

```bash
gh pr checks <N>
gh pr view <N> --json state,mergedAt
```

Set `**Status:**` to `in progress` on the first implementation commit, and to
`completed` only when the user confirms — never self-declare.
