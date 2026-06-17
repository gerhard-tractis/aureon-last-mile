# Spec 46 — Wire Activation Guards Into Existing Modules

**Status:** in progress

## Context

[Spec 45](spec-45-module-activation-layer.md) shipped the per-tenant module activation primitive: the `operator_enabled_modules` / `operator_module_audit` tables, the `get_enabled_modules_for_operator` `SECURITY DEFINER` RPC, the `ModuleKey` TS enum and `MODULES` registry at `apps/frontend/src/lib/modules/registry.ts`, the helper API (`getEnabledModulesForCurrentUser`, `isModuleEnabled`, `requireModuleEnabled`, `withModule`), and the super-admin toggle UI. The tenant is seeded with `ops_control` + `late_order_alerts` only.

Spec 45 was deliberately scoped to the primitive. **Nothing is gated yet.** Every module layout still renders unconditionally for any user whose RBAC `permissions` array allows it, and the sidebar in `apps/frontend/src/components/AppLayout.tsx` filters nav items only by RBAC permissions. A super-admin can toggle `pickup_enabled = false` for the tenant today and Pickup will still be reachable.

Spec 46 closes that loop. After this spec ships, every module guard is *both* RBAC (user has the role) *and* activation (operator has the module enabled). Phase 1 of the rollout (`docs/architecture/phased-rollout-strategy.md`) becomes possible — flipping `pickup_enabled` off actually hides Pickup; flipping it on actually reveals it. Phase 2 (Pickup activation across all warehouses) reduces to a config flip + training runbook with zero code change.

This is the second prerequisite spec in the rollout chain — spec-47 (preset selector) builds on the assumption that Ops Control's layout is already activation-gated.

## Goals

1. Add a server-side activation guard to every existing module's route tree so that an operator with the module disabled cannot reach any page under it (direct URL → 404).
2. Filter the sidebar nav in `AppLayout` by the enabled-modules set so disabled modules are invisible in navigation.
3. Compose with — **not replace** — the existing RBAC `hasPermission` check. Module activation is operator-level; RBAC is user-level. Both must pass.
4. Make the existing module layouts that today are `'use client'` permission gates work cleanly with a server-rendered activation gate above them. No flicker, no client-side redirect for the activation case.
5. Cover every module currently in the `ModuleKey` enum that has a route (`ops_control`, `pickup`, `reception`, `distribution`, `dispatch`, `conversations`). Add a placeholder route + guard for `returns` if a `/app/returns` segment exists; skip otherwise. `pre_route` and `late_order_alerts` have no module routes — `late_order_alerts` is alert behaviour, `pre_route` is a future module — so no guard is needed for them in this spec.

## Non-Goals

- The Ops Control preset selector (spec-47) and the Visibility preset (spec-48). Spec 46 leaves the existing single-page Ops Control behind the activation guard; spec-47 will refactor the page itself.
- API route guards for mutations. The activation helpers already expose `withModule` (spec-45). Wiring it into individual API routes is its own follow-up; this spec is layout / navigation only.
- Removing RBAC. The existing `useOperatorId` + `hasPermission` checks stay exactly as they are inside the `'use client'` segments. The activation guard runs above them.
- Building any module that does not yet have a route (`/app/returns`, `/app/pre-route`).
- Self-serve operator-side toggle UI. Activation toggles remain super-admin-only per spec-45.

## Architecture

### Two-Layer Guard Pattern

For each module:

```
app/<module>/layout.tsx                  ← async Server Component
  └─ await requireModuleEnabled(ModuleKey.X)   ← spec-45 helper; calls notFound() if off
  └─ renders <ModuleClientGate>{children}</ModuleClientGate>

app/<module>/_client-gate.tsx            ← 'use client'
  └─ RBAC check via useOperatorId / hasPermission (lifted from today's layout)
  └─ renders {children} when allowed
```

- **Why split:** module activation must run server-side so a disabled module returns 404 with no client JS rendered. RBAC stays client-side because `useOperatorId` is client-only and the existing UX (redirect to `/app` or `/app/dashboard`) is the established behaviour we are not changing.
- **Why a sibling file instead of inlining `'use client'` in the layout:** Next.js does not allow `'use client'` and `async` in the same file. The layout must be async (it `await`s `requireModuleEnabled`); the RBAC gate must be a client component. Splitting is the idiomatic resolution.
- **404 vs redirect:** activation failure → 404 (matches spec-45 semantics; helper uses `notFound()`). RBAC failure → redirect to `/app` or `/app/dashboard` (preserves today's behaviour).

The client-gate file is private to its module — prefixed with `_` so Next.js does not route to it. It is a thin wrapper, not a place to add module-specific logic.

### Sidebar Filtering

`AppLayout.tsx` today is a Client Component reading RBAC from `useGlobal()`. The enabled set must be available client-side without a fetch on every render. The cheapest delivery:

- Add a server fetch in `apps/frontend/src/app/app/layout.tsx`: `const enabled = await getEnabledModulesForCurrentUser();`
- Pass `enabledModules: ReadonlyArray<ModuleKey>` (serialise the `Set` to an array at the boundary) as a prop into `AppLayout`.
- In `AppLayout`, extend each `navItems` entry with an additional `module?: ModuleKey` field. The `.filter((item) => item.show)` line becomes:

  ```ts
  .filter((item) => item.show && (item.module === undefined || enabledModules.includes(item.module)))
  ```

- Dashboard, Capacity, Audit Logs, Admin have no `ModuleKey` (they are platform-level, not toggleable) — they keep `module` undefined and bypass the activation filter.
- Ops Control, Pickup, Reception, Distribución, Despacho, Conversaciones each map to their `ModuleKey`.

### Module ↔ Route Mapping

| ModuleKey | Route segment | Layout today | Action |
|---|---|---|---|
| `ops_control` | `/app/operations-control` | none | **Create** `layout.tsx` (activation guard only; existing RBAC for ops-control lives at the page level via `isAdminOrManager`, leave as-is) |
| `pickup` | `/app/pickup` | client RBAC | **Convert** `layout.tsx` to async server + extract `_client-gate.tsx` |
| `reception` | `/app/reception` | client RBAC | **Convert** as above |
| `distribution` | `/app/distribution` | client RBAC | **Convert** as above (preserve `layout.test.tsx` coverage; add server-layer test) |
| `dispatch` | `/app/dispatch` | client RBAC (admin OR dispatch) | **Convert** as above; keep the `admin OR dispatch` RBAC inside the client gate verbatim |
| `conversations` | `/app/conversations` | none (single `page.tsx`) | **Create** `layout.tsx` (activation guard only; existing RBAC lives at the page level / route, leave page logic untouched) |
| `returns` | `/app/returns` (does not exist yet) | — | **Skip.** When spec-44b lands the route, that spec adds the guard. Note this in the spec map. |
| `pre_route`, `late_order_alerts` | n/a | — | **Skip.** No routes to gate. |

### Files Touched

- `apps/frontend/src/app/app/layout.tsx` — server-fetch enabled set, pass to `AppLayout`
- `apps/frontend/src/components/AppLayout.tsx` — accept `enabledModules` prop, extend `navItems` with `module?` field, extend the filter
- `apps/frontend/src/app/app/pickup/layout.tsx` — rewrite as async server guard
- `apps/frontend/src/app/app/pickup/_client-gate.tsx` — **new**, holds today's RBAC logic
- `apps/frontend/src/app/app/reception/layout.tsx` — rewrite
- `apps/frontend/src/app/app/reception/_client-gate.tsx` — **new**
- `apps/frontend/src/app/app/distribution/layout.tsx` — rewrite
- `apps/frontend/src/app/app/distribution/_client-gate.tsx` — **new**
- `apps/frontend/src/app/app/dispatch/layout.tsx` — rewrite
- `apps/frontend/src/app/app/dispatch/_client-gate.tsx` — **new**
- `apps/frontend/src/app/app/operations-control/layout.tsx` — **new** (activation only)
- `apps/frontend/src/app/app/conversations/layout.tsx` — **new** (activation only)

### Files NOT Touched

- `apps/frontend/src/lib/modules/**` — already shipped in spec-45. If a helper is missing, surface it in code review; don't extend in this spec.
- `apps/frontend/src/hooks/useOperatorId.ts` and `apps/frontend/src/lib/types/auth.types.ts` — RBAC primitives untouched.
- Any module's `page.tsx`, components, or business logic.

## Test Plan (TDD — Tests First)

Each new layout and each rewritten layout gets a server-side test. Pattern after `apps/frontend/src/app/app/distribution/layout.test.tsx` (already exists for the client variant) and `apps/frontend/src/lib/modules/require-enabled.test.ts`.

### 1. Layout-level activation tests (one per module)

For `pickup`, `reception`, `distribution`, `dispatch`, `operations-control`, `conversations`:

- **Renders children when module enabled:** mock `getEnabledModulesForCurrentUser` to return a Set containing the matching `ModuleKey`; assert `requireModuleEnabled` resolves and the layout returns the children subtree.
- **Calls `notFound()` when module disabled:** mock the helper to return an empty Set; assert `notFound` is invoked (use the standard Next.js test pattern that asserts the thrown `NEXT_NOT_FOUND` sentinel).

### 2. Client-gate tests (RBAC preserved)

For the four modules whose client gates carry RBAC (`pickup`, `reception`, `distribution`, `dispatch`):

- Lift the existing layout test cases — "redirects when permission missing", "renders when permission present" — onto the new `_client-gate.tsx` file. Behaviour must be byte-equivalent to today.
- For `dispatch`, preserve both the `dispatch` permission case and the `admin` permission case.

### 3. AppLayout nav filter tests

In `apps/frontend/src/components/AppLayout.tsx` (or a new `AppLayout.test.tsx` if one does not exist):

- Given `enabledModules = []`, only platform items (Dashboard, Capacity, Audit Logs, Conversaciones-if-CS, Admin-if-admin) render.

  > Note: Ops Control is currently `show: isAdminOrManager` with no module gate. After this spec, an admin without `ops_control` enabled should not see Ops Control in the nav. Test asserts this.
- Given `enabledModules = [ModuleKey.PICKUP, ModuleKey.DISPATCH]` and permissions `['pickup','dispatch']`, exactly Pickup + Despacho appear among module items.
- Given an enabled module the user lacks RBAC for, the item is hidden (RBAC AND activation).

### 4. End-to-end seed verification

The tenant is seeded with `ops_control + late_order_alerts` only.

- Log in as the tenant's ops manager → Ops Control link appears in nav; Pickup / Reception / Distribución / Despacho / Conversaciones links **do not** appear.
- Navigate directly to `/app/pickup` → 404. Same for the other disabled module roots.
- Super-admin flips `pickup_enabled` on through the spec-45 Admin UI → Pickup link appears in nav on next reload; `/app/pickup` renders.
- Super-admin flips `pickup_enabled` back off → Pickup disappears from nav; `/app/pickup` returns 404 again.

(Steps 4 are manual / preview-deploy verification, not automated, but must be executed and recorded in the PR description before merge.)

## Implementation Steps

Linear order, each step keeps the app green:

1. **Tests first — layout activation.** Add the six layout-level tests (failing) per the test plan §1.
2. **Add the platform-level enabled-set fetch.** Edit `apps/frontend/src/app/app/layout.tsx` to await `getEnabledModulesForCurrentUser` and pass `enabledModules` to `<AppLayout>`. Update `AppLayout` props + `navItems` filter (test §3 turns green for the items already gated; new modules still allowed because no `module` field yet).
3. **Tag each `navItems` entry with `module`.** Add `module: ModuleKey.OPS_CONTROL`, `ModuleKey.PICKUP`, etc. test §3 fully passes.
4. **Server-ify `pickup/layout.tsx`** with `requireModuleEnabled(ModuleKey.PICKUP)`; move existing client body into `pickup/_client-gate.tsx`. Layout test §1 for Pickup turns green; client-gate test §2 for Pickup turns green.
5. **Repeat step 4 for `reception`, `distribution`, `dispatch`.**
6. **Create `operations-control/layout.tsx`** as an async server component that calls `requireModuleEnabled(ModuleKey.OPS_CONTROL)` then renders `{children}`. No client gate — RBAC for Ops Control lives in the page.
7. **Create `conversations/layout.tsx`** the same way for `ModuleKey.CONVERSATIONS`.
8. **Run the full test suite + typecheck.** Fix any drift in tests that hard-coded the old layout shape.
9. **Manual verification §4** against a preview deploy seeded with only `ops_control + late_order_alerts`. Capture screenshots in the PR description.
10. **Open PR, enable auto-merge per repo rules.** Wait for CI green + merge before declaring done.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Server-fetching the enabled set in the root `/app/layout.tsx` adds latency to every page load | The RPC is a single indexed lookup keyed by `operator_id`; `getEnabledModulesForCurrentUser` is already `cache()`-wrapped per request. Acceptable cost. Measure in CI bench if a regression is suspected. |
| Existing module `page.tsx` files import client-only hooks that previously assumed the layout had already gated permission | Behaviour does not change for an *enabled* module — RBAC still runs inside `_client-gate.tsx` before children render. A *disabled* module 404s server-side before the page imports execute. No client code paths broken. |
| Sidebar momentarily shows / hides items as user data loads | The enabled set comes from the server render; it is stable on first paint. No layout shift expected. |
| Cypress / Playwright suites assume direct-URL access to module roots | Audit before merge; any e2e test that targets a module must first ensure that module's flag is enabled for the test operator. |
| Ops Control became invisible to admins who don't have it in their seed | This is the desired Phase 1 behaviour — the seed already grants `ops_control` to the tenant. For internal `aureon-internal` operator, ensure all modules are enabled (spec-45 seed responsibility; verify, don't re-do). |

## Verification

Before opening the PR:

- `pnpm test` (frontend) green — six new layout tests, four moved client-gate tests, AppLayout nav-filter tests.
- `pnpm typecheck` clean.
- Manual run-through §4 above, against preview deploy.

Before declaring done:

- PR opened with `gh pr create` + `gh pr merge --auto --squash`.
- CI green; PR merged to `main`.
- Update the spec map row in `docs/architecture/phased-rollout-strategy.md`: spec-46 → `completed`.
- Flip this file's `Status:` line to `completed` only on user confirmation, per `docs/specs/CLAUDE.md`.

## Out of Scope — Recorded for Follow-Up

- API route activation guards (`withModule` wiring across `app/api/**`) — separate spec.
- Ops Control preset selector → spec-47.
- Visibility preset → spec-48.
- Late-order alerts agent → spec-49.
- Returns route activation → folded into spec-44b when its route lands.
