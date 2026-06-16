# Spec 45 — Per-Tenant Module Activation Layer

**Status:** in progress

## Context

The previous attempt to roll out the full Aureon platform to the active tenant failed because it demanded simultaneous change of processes, layouts, and people's roles. The tenant operates on paper + Excel and cannot absorb a big-bang cutover. The strategic response (documented in `docs/architecture/phased-rollout-strategy.md`) is to roll out the modules we have already built **one at a time**, per tenant, on the schedule that matches each tenant's capacity to absorb change.

This spec delivers the foundational primitive that the rollout strategy depends on: a **per-tenant module activation layer** that lets a super-admin enable or disable each module independently for each operator. Without this layer, every phase of the rollout requires a code change. With it, every phase is a config flip + a training session.

This spec is Phase 0 of the rollout strategy — Phase 1 (Visibility preset + late-order alerts) and Phase 2 (Pickup activation) are separate specs that build on top of this primitive.

**Out of scope (explicitly deferred to follow-up specs):**

- Wiring the guards into the existing module layouts (`apps/frontend/src/app/app/pickup/layout.tsx`, etc.). Covered by a follow-up "wire activation guards into existing modules" spec so this one stays focused on the primitive.
- The Ops Control preset selector and the Visibility preset.
- Phase 1 / Phase 2 rollout-runbook documents.

## Goals

1. Add a per-operator module enablement state with intrinsic soft-delete history and a separate append-only audit log.
2. Introduce a `super_admin` role that can flip toggles across operators without breaking the existing RLS / JWT-claims model.
3. Provide a single typed source of truth (`getEnabledModulesForCurrentUser`) consumed by navigation, route guards, and API guards.
4. Ship an Admin UI tab where a super-admin can flip modules per operator, with mandatory free-text reason and audit drawer.
5. Seed the existing tenant with the Phase 1 module set (`ops_control`, `late_order_alerts`) only. New operators default to all-OFF.

## Non-Goals

- Editing existing module layouts to consume the guards.
- Self-serve toggle UI for regular operator admins (only super-admins can flip).
- Cross-tenant analytics, customer-support tooling, or any other super-admin feature beyond module toggles.
- A registry table for modules — module identity is a TS enum in code.

## Architecture

### Data Model

Two new tables, both scoped by `operator_id`, both inaccessible to regular roles (all access via `SECURITY DEFINER` RPCs).

#### `operator_enabled_modules` — current-state table (soft-delete)

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `operator_id` | `UUID NOT NULL REFERENCES operators(id)` | |
| `module_key` | `TEXT NOT NULL` | App-layer validation against `ModuleKey` enum |
| `enabled_at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |
| `enabled_by` | `UUID NOT NULL REFERENCES auth.users(id)` | |
| `disabled_at` | `TIMESTAMPTZ NULL` | Soft delete |
| `disabled_by` | `UUID NULL REFERENCES auth.users(id)` | |

Indexes:

- Partial unique index `(operator_id, module_key) WHERE disabled_at IS NULL` — at most one active enablement per pair.
- `(operator_id) WHERE disabled_at IS NULL` — fast "give me the enabled set" lookup.

Semantics:

- "Module X is enabled for operator Y" = a row exists with `disabled_at IS NULL`.
- Disabling = update the active row, setting `disabled_at` + `disabled_by`.
- Re-enabling after a disable = **insert a fresh row**, not update the soft-deleted one. History is preserved naturally.

#### `operator_module_audit` — append-only log

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | |
| `operator_id` | `UUID NOT NULL REFERENCES operators(id)` | |
| `module_key` | `TEXT NOT NULL` | |
| `action` | `TEXT NOT NULL CHECK (action IN ('enable','disable'))` | |
| `actor_user_id` | `UUID NOT NULL REFERENCES auth.users(id)` | |
| `at` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | |
| `reason` | `TEXT NULL` | Free-text supplied at flip time |

No updates, no deletes — append-only by convention and by RLS.

#### RLS

Both tables have RLS enabled with **no** SELECT/INSERT/UPDATE/DELETE policies for any role. All access flows through `SECURITY DEFINER` RPCs that own the authorization logic.

### Module Registry (code, not DB)

`apps/frontend/src/lib/modules/registry.ts`:

```ts
export enum ModuleKey {
  OPS_CONTROL = 'ops_control',
  LATE_ORDER_ALERTS = 'late_order_alerts',
  PICKUP = 'pickup',
  RECEPTION = 'reception',
  DISTRIBUTION = 'distribution',
  PRE_ROUTE = 'pre_route',
  DISPATCH = 'dispatch',
  RETURNS = 'returns',
  CONVERSATIONS = 'conversations',
}

export interface ModuleMeta {
  label: string;
  description: string;
  navHref: string | null; // null for non-navigated modules (e.g. late_order_alerts)
  navIcon?: string;
}

export const MODULES: Record<ModuleKey, ModuleMeta> = { /* ... */ };
```

Always-on (NOT in the registry): Admin, auth, profile, shell, ingest pipelines (Paris / Easy webhooks).

### Super-Admin Role

- Add `super_admin` to the Postgres `user_role` ENUM.
- Add `SUPER_ADMIN = 'super_admin'` to the `UserRole` enum in `apps/frontend/src/lib/types/auth.types.ts`.
- Add `RolePermissions.isSuperAdmin(role)` helper.
- Add `getRoleDisplayName` entry: "Super Admin".
- Seed an internal operator `Aureon` (slug: `aureon-internal`) — super-admin users belong to this operator like any other user.
- **JWT claims hook and RLS policies are NOT changed.** Super-admin appears in JWT as a normal role. Cross-tenant access happens only through `SECURITY DEFINER` RPCs that explicitly check `auth.jwt() ->> 'role' = 'super_admin'`.

### RPCs

All `SECURITY DEFINER`. All written in `packages/database/supabase/migrations/<spec45_rpcs>.sql`.

| RPC | Authorization | Purpose |
|---|---|---|
| `get_enabled_modules_for_operator(p_operator_id UUID) RETURNS TEXT[]` | Authenticated user reading **own** operator, OR super-admin reading any | Powers the helper API |
| `list_operators_with_module_state() RETURNS TABLE(...)` | Super-admin only | Powers Admin UI main table |
| `enable_module_for_operator(p_operator_id UUID, p_module_key TEXT, p_reason TEXT) RETURNS VOID` | Super-admin only | Idempotent — if already enabled, no state change but audit row noting attempted re-enable still inserted |
| `disable_module_for_operator(p_operator_id UUID, p_module_key TEXT, p_reason TEXT) RETURNS VOID` | Super-admin only | Idempotent — if already disabled, no state change but audit row inserted |
| `get_module_audit_for_operator(p_operator_id UUID) RETURNS TABLE(...)` | Super-admin only | Powers audit drawer |

All RPCs that mutate state reject calls with NULL or empty `p_reason`.

### Helper API

`apps/frontend/src/lib/modules/enabled.ts`:

```ts
export type EnabledModulesSet = ReadonlySet<ModuleKey>;

export const getEnabledModulesForCurrentUser = cache(
  async (): Promise<EnabledModulesSet> => { ... }
);

export const isModuleEnabled = async (key: ModuleKey): Promise<boolean> => {
  const set = await getEnabledModulesForCurrentUser();
  return set.has(key);
};
```

Implementation:

- Resolves `operator_id` from the current request's JWT claims (existing pattern in the codebase).
- Calls `get_enabled_modules_for_operator(operator_id)` via `supabase-js`.
- Filters DB-returned keys against the TS `ModuleKey` enum; unknown keys are warned to Sentry and discarded (TS enum is source of truth).
- Memoized per request via React `cache()`.
- Fail-closed: any RPC error throws, no fallback that exposes a module.

`apps/frontend/src/lib/modules/require-enabled.ts`:

```ts
export async function requireModuleEnabled(key: ModuleKey): Promise<void> {
  if (!(await isModuleEnabled(key))) notFound();
}
```

`apps/frontend/src/lib/modules/with-module.ts`:

```ts
export function withModule<T extends Handler>(key: ModuleKey, handler: T): T { ... }
```

Wraps a Next.js Route Handler; returns a 404 `Response` if the module is disabled, otherwise invokes the handler.

### Admin UI

Path: `apps/frontend/src/app/app/admin/modules/page.tsx`. Extends the existing Admin module (spec-33 completed).

- Layout-level guard: if `role !== 'super_admin'`, `notFound()`.
- **Top:** operator picker (dropdown sourced from `list_operators_with_module_state`).
- **Body:** grid of module cards, one per `ModuleKey`. Each card shows label, description, current state (enabled/disabled), enabled-at + enabled-by metadata when enabled, a toggle switch, and a "View audit" link.
- **Toggle interaction:** clicking the switch opens `ToggleDialog` requiring a free-text reason. Submitting calls the corresponding server action which invokes `enable_module_for_operator` or `disable_module_for_operator`. Empty reason blocks submission client-side; RPC also rejects.
- **Audit drawer:** `AuditDrawer` shows the append-only log scoped to the selected operator + module. Append-only display — no edits.

Visual style follows the existing Admin module conventions (spec-33). No new design system tokens introduced.

## Defaults and Seeding

Migration `20260616XXXXXX_spec45_default_enable_existing_operator.sql`:

- For every existing operator EXCEPT the internal `aureon-internal` operator, insert active rows in `operator_enabled_modules` for `ops_control` and `late_order_alerts` only.
- `enabled_by` for these seed rows = the system user we create in the internal-operator seed migration.
- Audit rows are also written so history is consistent.

**New operators going forward get nothing seeded.** All-OFF on creation. Super-admin must explicitly enable each module.

## Critical Files

**New:**

- `packages/database/supabase/migrations/20260616XXXXXX_spec45_user_role_super_admin.sql`
- `packages/database/supabase/migrations/20260616XXXXXX_spec45_internal_operator_seed.sql`
- `packages/database/supabase/migrations/20260616XXXXXX_spec45_module_activation_tables.sql`
- `packages/database/supabase/migrations/20260616XXXXXX_spec45_module_activation_rpcs.sql`
- `packages/database/supabase/migrations/20260616XXXXXX_spec45_default_enable_existing_operator.sql`
- `apps/frontend/src/lib/modules/registry.ts`
- `apps/frontend/src/lib/modules/enabled.ts`
- `apps/frontend/src/lib/modules/require-enabled.ts`
- `apps/frontend/src/lib/modules/with-module.ts`
- `apps/frontend/src/app/app/admin/modules/page.tsx`
- `apps/frontend/src/app/app/admin/modules/ModuleCard.tsx`
- `apps/frontend/src/app/app/admin/modules/ToggleDialog.tsx`
- `apps/frontend/src/app/app/admin/modules/AuditDrawer.tsx`
- `apps/frontend/src/app/app/admin/modules/actions.ts`
- Test files mirroring each of the above under `__tests__/`

**Modified:**

- `apps/frontend/src/lib/types/auth.types.ts` — add `SUPER_ADMIN` to `UserRole`, `isSuperAdmin` helper, display-name entry
- Admin module navigation (`apps/frontend/src/app/app/admin/**` shell) — register the new `Modules` tab, gate its visibility to `super_admin`

All new TS files must stay ≤ 300 lines per the project rule.

## Testing Strategy (TDD)

Tests are written before each implementation chunk.

**Database (pgTAP or the existing SQL test harness):**

- `get_enabled_modules_for_operator` returns only active rows; super-admin can read any operator; non-super-admin can only read own.
- `enable_module_for_operator` requires super-admin; inserts state row + audit row; idempotent on already-enabled (no second active row, but audit row still inserted).
- `disable_module_for_operator` requires super-admin; soft-deletes active row + audit row; idempotent on already-disabled.
- `list_operators_with_module_state` rejects non-super-admin.
- `get_module_audit_for_operator` rejects non-super-admin.
- Partial unique index prevents duplicate active rows under concurrent enable attempts.
- Empty `p_reason` is rejected by mutating RPCs.

**Helper layer (Vitest):**

- `getEnabledModulesForCurrentUser` returns the right typed `Set` for a mocked RPC response.
- Unknown keys returned by RPC are filtered out and warned (Sentry mock asserted).
- Memoized within a single request (`cache()` behavior tested by stub).
- Fails closed on RPC error.

**Guard layer (Vitest):**

- `requireModuleEnabled` calls `notFound()` when disabled.
- `withModule` returns 404 `Response` when disabled, invokes handler when enabled.
- Navigation filter hides disabled items (tested via the helper mock).

**Admin UI (Vitest + RTL):**

- Page returns 404 for non-super-admin roles.
- Super-admin sees operator picker + module grid.
- `ToggleDialog` blocks submission with empty reason.
- Toggle calls the correct server action; optimistic UI then settles on RPC result.
- `AuditDrawer` renders log entries in reverse chronological order.

**Integration (`supabase-js` against local Supabase):**

- End-to-end: enable a module via RPC → helper returns it → disable → helper no longer returns it → audit log has both entries with reasons.

## Verification

1. Apply all five migrations against a fresh local Supabase. Confirm tables, indexes, RLS, and RPCs exist.
2. Confirm the internal `aureon-internal` operator exists; confirm the existing tenant has exactly two active rows in `operator_enabled_modules` (`ops_control`, `late_order_alerts`); confirm new operators created post-migration get no seed rows.
3. Create a test user with `super_admin` role under the internal operator. Log in. Navigate to `/app/admin/modules`. Confirm operator picker and module grid render.
4. Toggle `pickup` ON for the existing tenant. Submit with reason "verification test". Confirm the state changes in the grid; confirm the audit drawer shows the entry.
5. Toggle `pickup` OFF. Confirm the audit drawer shows both entries with reasons.
6. Log in as a regular `admin` user. Navigate to `/app/admin/modules` directly. Confirm 404.
7. Log in as the existing tenant's `operations_manager`. Confirm `getEnabledModulesForCurrentUser()` returns exactly `{ops_control, late_order_alerts}` (verified via a temporary debug route or unit test against the helper).
8. CI: all new unit + integration tests pass. Type check passes. Lint passes.

## Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` (preferred) or `superpowers:executing-plans` to implement. Steps use checkbox (`- [ ]`) for tracking.

**Goal:** Ship the per-tenant module activation primitive — DB tables, RPCs, super-admin role, helper API, guards, Admin UI — so subsequent specs can gate modules behind toggles.

**Architecture:** Two tables (soft-delete state + append-only audit), `SECURITY DEFINER` RPCs for all access, request-cached helper, layout/middleware/nav guards, super-admin-only Admin tab.

**Tech stack:** Postgres (Supabase), Next.js App Router (existing), `@supabase/ssr`, Vitest + RTL (jsdom), Tailwind + shadcn/ui (per existing Admin module).

### Path Corrections vs. Spec Architecture Section

The spec referenced `apps/frontend/src/app/app/admin/modules/` for the Admin UI, but the existing admin module lives at `apps/frontend/src/app/admin/`. **All Admin UI paths below use the actual path: `apps/frontend/src/app/admin/modules/`.** Components live under `apps/frontend/src/components/admin/modules/` to match the existing `components/admin/` pattern (per `AdminPage.tsx`, `ClientManagement.tsx`, etc.).

### Conventions (from existing codebase)

- Migration filename: `YYYYMMDDHHMMSS_spec45_<slug>.sql` — six-digit sequence within a date (e.g., `20260616000001`, `20260616000002`). Today's prefix: `20260616`.
- SQL tests: plain SQL in `packages/database/supabase/tests/`, wrapped in `BEGIN; ... ROLLBACK;` with `RAISE EXCEPTION` for failed assertions (no pgTAP).
- Vitest tests colocated next to source (`Foo.tsx` + `Foo.test.tsx`) for components; `__tests__/` only when grouping many.
- SSR client: `createSSRClient()` from `@/lib/supabase/server`.
- Role check pattern: `session.user.app_metadata?.claims?.role` (see `apps/frontend/src/app/admin/page.tsx:14`).

### File Structure

**New SQL files:**
- `packages/database/supabase/migrations/20260616000001_spec45_user_role_super_admin.sql`
- `packages/database/supabase/migrations/20260616000002_spec45_internal_operator_seed.sql`
- `packages/database/supabase/migrations/20260616000003_spec45_module_activation_tables.sql`
- `packages/database/supabase/migrations/20260616000004_spec45_module_activation_rpcs.sql`
- `packages/database/supabase/migrations/20260616000005_spec45_default_enable_existing_operators.sql`
- `packages/database/supabase/tests/spec45_module_activation_test.sql`

**New TS files (frontend, all ≤ 300 lines):**
- `apps/frontend/src/lib/modules/registry.ts`
- `apps/frontend/src/lib/modules/registry.test.ts`
- `apps/frontend/src/lib/modules/enabled.ts`
- `apps/frontend/src/lib/modules/enabled.test.ts`
- `apps/frontend/src/lib/modules/require-enabled.ts`
- `apps/frontend/src/lib/modules/require-enabled.test.ts`
- `apps/frontend/src/lib/modules/with-module.ts`
- `apps/frontend/src/lib/modules/with-module.test.ts`
- `apps/frontend/src/app/admin/modules/page.tsx`
- `apps/frontend/src/components/admin/modules/ModulesAdminPage.tsx`
- `apps/frontend/src/components/admin/modules/ModulesAdminPage.test.tsx`
- `apps/frontend/src/components/admin/modules/ModuleCard.tsx`
- `apps/frontend/src/components/admin/modules/ModuleCard.test.tsx`
- `apps/frontend/src/components/admin/modules/ToggleDialog.tsx`
- `apps/frontend/src/components/admin/modules/ToggleDialog.test.tsx`
- `apps/frontend/src/components/admin/modules/AuditDrawer.tsx`
- `apps/frontend/src/components/admin/modules/AuditDrawer.test.tsx`
- `apps/frontend/src/components/admin/modules/actions.ts`
- `apps/frontend/src/components/admin/modules/actions.test.ts`

**Modified TS files:**
- `apps/frontend/src/lib/types/auth.types.ts` — add `SUPER_ADMIN` enum value + `isSuperAdmin` helper + display name entry
- `apps/frontend/src/lib/types/auth.types.test.ts` — extend tests for the new role
- `apps/frontend/src/components/admin/AdminPage.tsx` — add a "Módulos" tab visible only to `super_admin`

---

## Chunk 1: DB Foundation — Enum, Internal Operator, Tables

Goal: `super_admin` role exists, internal operator seeded, the two new tables exist with correct schema, indexes, and RLS denying direct access.

### Task 1.1: Add `super_admin` to `user_role` ENUM

**Files:**
- Create: `packages/database/supabase/migrations/20260616000001_spec45_user_role_super_admin.sql`

- [ ] **Step 1: Create the migration**

```sql
-- spec-45 — Add super_admin to user_role ENUM
-- super_admin is a cross-tenant role held by Aureon internal users only.
-- Cross-tenant access happens exclusively through SECURITY DEFINER RPCs
-- (no RLS or JWT-claims-hook changes needed).

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'super_admin';
```

- [ ] **Step 2: Apply locally and verify**

Run: `pnpm --filter database supabase db reset` (or the project's local-Supabase reset command — check `packages/database/package.json` scripts).
Then in psql / SQL editor:

```sql
SELECT enum_range(NULL::user_role);
```

Expected output: array containing `super_admin` alongside existing values.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260616000001_spec45_user_role_super_admin.sql
git commit -m "feat(spec-45): add super_admin to user_role ENUM"
```

### Task 1.2: Seed internal `aureon-internal` operator + system user

**Files:**
- Create: `packages/database/supabase/migrations/20260616000002_spec45_internal_operator_seed.sql`

- [ ] **Step 1: Create the migration**

```sql
-- spec-45 — Seed internal Aureon operator and a system user.
-- The system user is the actor for automated seed rows (e.g. default-enable
-- migrations). Super-admin humans will be created later via the normal
-- user-creation flow with operator_id = the internal operator.

INSERT INTO public.operators (id, name, slug, country_code, is_active)
VALUES (
  '00000000-0000-0000-0000-00000000aure',
  'Aureon',
  'aureon-internal',
  'CL',
  TRUE
)
ON CONFLICT (slug) DO NOTHING;

-- System user used as actor for seed rows. Has no auth.users counterpart on
-- purpose — it cannot log in. References below use this UUID directly.
INSERT INTO auth.users (id, email, created_at, updated_at, raw_app_meta_data)
VALUES (
  '00000000-0000-0000-0000-0000000000sys',
  'system@aureon-internal.local',
  NOW(),
  NOW(),
  jsonb_build_object('claims', jsonb_build_object('role', 'super_admin'))
)
ON CONFLICT (id) DO NOTHING;
```

> **Note:** if `auth.users` direct INSERT is rejected in the local Supabase environment, replace the `auth.users` insert with calling `supabase.auth.admin.createUser()` from a one-off node script in `packages/database/scripts/`. Verify which approach the codebase already uses by checking other migrations that reference `auth.users` with `git grep -l 'auth.users' packages/database/supabase/migrations`.

- [ ] **Step 2: Apply and verify**

```sql
SELECT id, slug FROM public.operators WHERE slug = 'aureon-internal';
SELECT id FROM auth.users WHERE email = 'system@aureon-internal.local';
```

Both queries should return one row.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260616000002_spec45_internal_operator_seed.sql
git commit -m "feat(spec-45): seed internal aureon-internal operator and system user"
```

### Task 1.3: Write failing SQL test for the activation tables

**Files:**
- Create: `packages/database/supabase/tests/spec45_module_activation_test.sql`

- [ ] **Step 1: Create the failing test file (schema portion only)**

```sql
-- spec-45 — Module Activation Layer test suite
-- Run inside a transaction; ROLLBACK at the end so the DB is unchanged.
-- Each section RAISE EXCEPTIONs on assertion failure.

BEGIN;

-- ─── Schema existence checks ────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'operator_enabled_modules'
  ) THEN
    RAISE EXCEPTION 'operator_enabled_modules table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'operator_module_audit'
  ) THEN
    RAISE EXCEPTION 'operator_module_audit table missing';
  END IF;
END $$;

-- ─── Partial unique index check ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'operator_enabled_modules'
      AND indexdef LIKE '%WHERE%disabled_at IS NULL%'
  ) THEN
    RAISE EXCEPTION 'partial unique index on (operator_id, module_key) missing';
  END IF;
END $$;

-- ─── RLS enabled, no policies for regular roles ─────────────────────────────
DO $$ BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.operator_enabled_modules'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on operator_enabled_modules';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.operator_module_audit'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on operator_module_audit';
  END IF;
END $$;

ROLLBACK;
```

- [ ] **Step 2: Run the test against a clean DB; confirm it FAILS**

Run via psql:
```bash
psql "$DATABASE_URL" -f packages/database/supabase/tests/spec45_module_activation_test.sql
```

Expected: `ERROR: operator_enabled_modules table missing`.

### Task 1.4: Implement the activation tables migration

**Files:**
- Create: `packages/database/supabase/migrations/20260616000003_spec45_module_activation_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- spec-45 — Module Activation Layer tables.
-- - operator_enabled_modules: soft-delete current-state table
-- - operator_module_audit:    append-only flip log
-- All direct access denied; RPCs in migration 4 own all reads/writes.

CREATE TABLE IF NOT EXISTS public.operator_enabled_modules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  module_key    TEXT NOT NULL,
  enabled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  enabled_by    UUID NOT NULL REFERENCES auth.users(id),
  disabled_at   TIMESTAMPTZ,
  disabled_by   UUID REFERENCES auth.users(id)
);

COMMENT ON TABLE public.operator_enabled_modules IS
  'Per-tenant module enablement (soft-delete). A row with disabled_at IS NULL = module enabled. Re-enabling inserts a fresh row.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_oem_active
  ON public.operator_enabled_modules (operator_id, module_key)
  WHERE disabled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oem_active_by_operator
  ON public.operator_enabled_modules (operator_id)
  WHERE disabled_at IS NULL;

ALTER TABLE public.operator_enabled_modules ENABLE ROW LEVEL SECURITY;
-- No policies = no access for any role except SECURITY DEFINER functions
-- (which run as table owner and bypass RLS).

CREATE TABLE IF NOT EXISTS public.operator_module_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  module_key      TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('enable','disable')),
  actor_user_id   UUID NOT NULL REFERENCES auth.users(id),
  at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason          TEXT
);

COMMENT ON TABLE public.operator_module_audit IS
  'Append-only audit log of module enable/disable actions. No updates, no deletes.';

CREATE INDEX IF NOT EXISTS idx_oma_operator_at
  ON public.operator_module_audit (operator_id, at DESC);

ALTER TABLE public.operator_module_audit ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Re-run the test from Task 1.3; confirm PASS**

```bash
psql "$DATABASE_URL" -f packages/database/supabase/tests/spec45_module_activation_test.sql
```

Expected: command completes silently (ROLLBACK at end). No errors raised.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260616000003_spec45_module_activation_tables.sql packages/database/supabase/tests/spec45_module_activation_test.sql
git commit -m "feat(spec-45): module activation tables with soft-delete + audit log"
```

---

## Chunk 2: RPCs

Goal: five `SECURITY DEFINER` RPCs that own all read and write access. Authorization is enforced inside each function.

### Task 2.1: Extend SQL test with RPC behavior assertions (failing)

**Files:**
- Modify: `packages/database/supabase/tests/spec45_module_activation_test.sql`

- [ ] **Step 1: Append RPC test sections before the ROLLBACK**

Add the following blocks (between the RLS checks and the `ROLLBACK;`):

```sql
-- ─── RPC: get_enabled_modules_for_operator exists ───────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_enabled_modules_for_operator'
  ) THEN
    RAISE EXCEPTION 'RPC get_enabled_modules_for_operator missing';
  END IF;
END $$;

-- ─── Test fixture: two operators + one super-admin + one regular admin ─────
INSERT INTO public.operators (id, name, slug, country_code) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Tenant C', 'tenant-c', 'CL'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Tenant D', 'tenant-d', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email, created_at, updated_at, raw_app_meta_data) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'super@aureon.test', NOW(), NOW(),
   jsonb_build_object('claims', jsonb_build_object('role','super_admin','operator_id','00000000-0000-0000-0000-00000000aure'))),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'admin-c@tenant.test', NOW(), NOW(),
   jsonb_build_object('claims', jsonb_build_object('role','admin','operator_id','cccccccc-cccc-cccc-cccc-cccccccccccc')))
ON CONFLICT (id) DO NOTHING;

-- ─── enable_module_for_operator: requires super-admin ───────────────────────
SET LOCAL request.jwt.claims = '{"role":"admin","sub":"ffffffff-ffff-ffff-ffff-ffffffffffff"}';
DO $$ BEGIN
  BEGIN
    PERFORM public.enable_module_for_operator(
      'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID, 'pickup', 'test'
    );
    RAISE EXCEPTION 'enable_module_for_operator should reject non-super-admin';
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    -- expected
  END;
END $$;

-- ─── enable_module_for_operator + get_enabled_modules round-trip ───────────
SET LOCAL request.jwt.claims = '{"role":"super_admin","sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
PERFORM public.enable_module_for_operator(
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID, 'pickup', 'phase-1 go-live'
);

DO $$
DECLARE
  enabled TEXT[];
BEGIN
  enabled := public.get_enabled_modules_for_operator(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID
  );
  IF NOT ('pickup' = ANY(enabled)) THEN
    RAISE EXCEPTION 'pickup should be in enabled list after enable';
  END IF;
END $$;

-- ─── Idempotency: second enable produces no second active row, audit row OK ─
PERFORM public.enable_module_for_operator(
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID, 'pickup', 'second attempt'
);
DO $$
DECLARE
  active_count INT;
  audit_count INT;
BEGIN
  SELECT COUNT(*) INTO active_count FROM public.operator_enabled_modules
   WHERE operator_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND module_key = 'pickup' AND disabled_at IS NULL;
  IF active_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 active row after idempotent enable, got %', active_count;
  END IF;

  SELECT COUNT(*) INTO audit_count FROM public.operator_module_audit
   WHERE operator_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND module_key = 'pickup' AND action = 'enable';
  IF audit_count <> 2 THEN
    RAISE EXCEPTION 'expected 2 enable audit rows after idempotent enable, got %', audit_count;
  END IF;
END $$;

-- ─── disable + re-enable: fresh row inserted, history preserved ────────────
PERFORM public.disable_module_for_operator(
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID, 'pickup', 'rolled back'
);
PERFORM public.enable_module_for_operator(
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID, 'pickup', 're-enable'
);
DO $$
DECLARE
  total_rows INT;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM public.operator_enabled_modules
   WHERE operator_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND module_key = 'pickup';
  IF total_rows <> 2 THEN
    RAISE EXCEPTION 'expected 2 rows (1 disabled + 1 active) after re-enable, got %', total_rows;
  END IF;
END $$;

-- ─── Empty reason rejected ──────────────────────────────────────────────────
DO $$ BEGIN
  BEGIN
    PERFORM public.enable_module_for_operator(
      'dddddddd-dddd-dddd-dddd-dddddddddddd'::UUID, 'pickup', ''
    );
    RAISE EXCEPTION 'empty reason should be rejected';
  EXCEPTION WHEN raise_exception THEN
    -- expected
  END;
END $$;
```

- [ ] **Step 2: Run; confirm FAILS at "RPC ... missing"**

```bash
psql "$DATABASE_URL" -f packages/database/supabase/tests/spec45_module_activation_test.sql
```

### Task 2.2: Implement the RPC migration

**Files:**
- Create: `packages/database/supabase/migrations/20260616000004_spec45_module_activation_rpcs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- spec-45 — Module Activation RPCs. All SECURITY DEFINER.
-- Authorization is enforced by reading auth.jwt() inside each function.

-- ── Helper: is current JWT a super-admin? ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT COALESCE((auth.jwt() -> 'claims' ->> 'role') = 'super_admin', FALSE);
$$;

-- ── get_enabled_modules_for_operator ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_enabled_modules_for_operator(
  p_operator_id UUID
) RETURNS TEXT[]
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  caller_operator UUID;
BEGIN
  caller_operator := NULLIF(auth.jwt() -> 'claims' ->> 'operator_id','')::UUID;
  IF NOT public.is_super_admin() AND caller_operator IS DISTINCT FROM p_operator_id THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(
    (SELECT array_agg(module_key)
       FROM public.operator_enabled_modules
      WHERE operator_id = p_operator_id AND disabled_at IS NULL),
    ARRAY[]::TEXT[]
  );
END $$;

-- ── enable_module_for_operator ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enable_module_for_operator(
  p_operator_id UUID,
  p_module_key  TEXT,
  p_reason      TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor UUID;
  already_active BOOLEAN;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  actor := NULLIF(auth.jwt() ->> 'sub','')::UUID;
  IF actor IS NULL THEN RAISE EXCEPTION 'no actor in JWT'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.operator_enabled_modules
     WHERE operator_id = p_operator_id
       AND module_key = p_module_key
       AND disabled_at IS NULL
  ) INTO already_active;

  IF NOT already_active THEN
    INSERT INTO public.operator_enabled_modules (operator_id, module_key, enabled_by)
    VALUES (p_operator_id, p_module_key, actor);
  END IF;

  -- Audit row is always written (including idempotent re-attempts) so the
  -- log reflects every super-admin action.
  INSERT INTO public.operator_module_audit
    (operator_id, module_key, action, actor_user_id, reason)
  VALUES (p_operator_id, p_module_key, 'enable', actor, p_reason);
END $$;

-- ── disable_module_for_operator ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.disable_module_for_operator(
  p_operator_id UUID,
  p_module_key  TEXT,
  p_reason      TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  actor UUID;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  actor := NULLIF(auth.jwt() ->> 'sub','')::UUID;
  IF actor IS NULL THEN RAISE EXCEPTION 'no actor in JWT'; END IF;

  UPDATE public.operator_enabled_modules
     SET disabled_at = NOW(), disabled_by = actor
   WHERE operator_id = p_operator_id
     AND module_key = p_module_key
     AND disabled_at IS NULL;

  INSERT INTO public.operator_module_audit
    (operator_id, module_key, action, actor_user_id, reason)
  VALUES (p_operator_id, p_module_key, 'disable', actor, p_reason);
END $$;

-- ── list_operators_with_module_state (super-admin only) ────────────────────
CREATE OR REPLACE FUNCTION public.list_operators_with_module_state()
RETURNS TABLE (
  operator_id UUID,
  operator_name TEXT,
  operator_slug TEXT,
  enabled_modules TEXT[]
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name::TEXT,
    o.slug::TEXT,
    COALESCE(
      (SELECT array_agg(oem.module_key)
         FROM public.operator_enabled_modules oem
        WHERE oem.operator_id = o.id AND oem.disabled_at IS NULL),
      ARRAY[]::TEXT[]
    )
  FROM public.operators o
  WHERE o.is_active = TRUE
  ORDER BY o.name;
END $$;

-- ── get_module_audit_for_operator ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_module_audit_for_operator(
  p_operator_id UUID
) RETURNS TABLE (
  id            UUID,
  module_key    TEXT,
  action        TEXT,
  actor_user_id UUID,
  at            TIMESTAMPTZ,
  reason        TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.module_key, a.action, a.actor_user_id, a.at, a.reason
    FROM public.operator_module_audit a
   WHERE a.operator_id = p_operator_id
   ORDER BY a.at DESC;
END $$;

-- Grant execute to authenticated; the functions themselves enforce authz.
GRANT EXECUTE ON FUNCTION public.get_enabled_modules_for_operator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enable_module_for_operator(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disable_module_for_operator(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_operators_with_module_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_module_audit_for_operator(UUID) TO authenticated;
```

- [ ] **Step 2: Re-run the SQL test; confirm PASS**

```bash
psql "$DATABASE_URL" -f packages/database/supabase/tests/spec45_module_activation_test.sql
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260616000004_spec45_module_activation_rpcs.sql packages/database/supabase/tests/spec45_module_activation_test.sql
git commit -m "feat(spec-45): SECURITY DEFINER RPCs for module activation"
```

---

## Chunk 3: Default-Enable Migration for Existing Operators

Goal: pre-existing operators (excluding the internal one) get `ops_control` + `late_order_alerts` enabled. New operators going forward get nothing.

### Task 3.1: Add failing assertion to test suite

**Files:**
- Modify: `packages/database/supabase/tests/spec45_module_activation_test.sql`

- [ ] **Step 1: Append before `ROLLBACK`**

```sql
-- ─── Default seed assertion ────────────────────────────────────────────────
-- Note: this asserts against EXISTING operators (not the test fixtures above,
-- since the migration runs at deploy time, not inside this transaction).
DO $$
DECLARE
  bad_op UUID;
BEGIN
  SELECT o.id INTO bad_op
    FROM public.operators o
   WHERE o.slug <> 'aureon-internal'
     AND o.created_at < '2026-06-16'::DATE  -- pre-existing operator
     AND NOT EXISTS (
       SELECT 1 FROM public.operator_enabled_modules oem
        WHERE oem.operator_id = o.id
          AND oem.module_key = 'ops_control'
          AND oem.disabled_at IS NULL
     )
   LIMIT 1;
  IF bad_op IS NOT NULL THEN
    RAISE EXCEPTION 'pre-existing operator % missing default ops_control seed', bad_op;
  END IF;
END $$;
```

- [ ] **Step 2: Run; confirm FAIL on a fresh DB that has pre-existing operators**

### Task 3.2: Implement seed migration

**Files:**
- Create: `packages/database/supabase/migrations/20260616000005_spec45_default_enable_existing_operators.sql`

- [ ] **Step 1: Write the migration**

```sql
-- spec-45 — Default-enable Phase 1 modules for any operator that existed
-- before this migration ran. The internal Aureon operator is excluded.
-- New operators created AFTER this migration get nothing seeded.

DO $$
DECLARE
  system_user UUID := '00000000-0000-0000-0000-0000000000sys';
  op_id UUID;
  mod TEXT;
BEGIN
  FOR op_id IN
    SELECT id FROM public.operators
     WHERE slug <> 'aureon-internal'
       AND is_active = TRUE
  LOOP
    FOREACH mod IN ARRAY ARRAY['ops_control','late_order_alerts'] LOOP
      INSERT INTO public.operator_enabled_modules (operator_id, module_key, enabled_by)
      VALUES (op_id, mod, system_user)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.operator_module_audit
        (operator_id, module_key, action, actor_user_id, reason)
      VALUES (op_id, mod, 'enable', system_user, 'spec-45 default seed for existing operators');
    END LOOP;
  END LOOP;
END $$;
```

- [ ] **Step 2: Run the test; confirm PASS**

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260616000005_spec45_default_enable_existing_operators.sql packages/database/supabase/tests/spec45_module_activation_test.sql
git commit -m "feat(spec-45): default-enable Phase 1 modules for existing operators"
```

---

## Chunk 4: Auth Type Updates

Goal: TS `UserRole` reflects the new `super_admin` value.

### Task 4.1: Extend `auth.types.test.ts` (failing)

**Files:**
- Modify: `apps/frontend/src/lib/types/auth.types.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import { UserRole, RolePermissions, isValidUserRole } from './auth.types';

describe('super_admin role (spec-45)', () => {
  it('is a valid UserRole', () => {
    expect(isValidUserRole('super_admin')).toBe(true);
    expect(UserRole.SUPER_ADMIN).toBe('super_admin');
  });

  it('isSuperAdmin returns true only for SUPER_ADMIN', () => {
    expect(RolePermissions.isSuperAdmin(UserRole.SUPER_ADMIN)).toBe(true);
    expect(RolePermissions.isSuperAdmin(UserRole.ADMIN)).toBe(false);
    expect(RolePermissions.isSuperAdmin(UserRole.OPERATIONS_MANAGER)).toBe(false);
  });

  it('has a human-readable display name', () => {
    expect(RolePermissions.getRoleDisplayName(UserRole.SUPER_ADMIN)).toBe('Super Admin');
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

```bash
pnpm --filter @aureon/frontend vitest run src/lib/types/auth.types.test.ts
```

### Task 4.2: Implement `SUPER_ADMIN` in `auth.types.ts`

**Files:**
- Modify: `apps/frontend/src/lib/types/auth.types.ts`

- [ ] **Step 1: Add to enum, helper, display map**

In the `UserRole` enum block, add:
```ts
  /** Aureon internal — cross-tenant role for module activation, support tooling. spec-45 */
  SUPER_ADMIN = 'super_admin',
```

In `RolePermissions`, add the helper:
```ts
  isSuperAdmin(role: UserRole): boolean {
    return role === UserRole.SUPER_ADMIN;
  },
```

In the `getRoleDisplayName` map, add:
```ts
  [UserRole.SUPER_ADMIN]: 'Super Admin',
```

- [ ] **Step 2: Re-run; confirm PASS**

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/types/auth.types.ts apps/frontend/src/lib/types/auth.types.test.ts
git commit -m "feat(spec-45): add SUPER_ADMIN to UserRole enum and helpers"
```

---

## Chunk 5: Module Registry + Helper API

Goal: typed module list + `getEnabledModulesForCurrentUser` + guards. Pure TS, no UI yet.

### Task 5.1: Write registry test

**Files:**
- Create: `apps/frontend/src/lib/modules/registry.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { MODULES, ModuleKey, ALL_MODULE_KEYS } from './registry';

describe('module registry (spec-45)', () => {
  it('exposes every ModuleKey value in MODULES', () => {
    for (const key of Object.values(ModuleKey)) {
      expect(MODULES[key as ModuleKey]).toBeDefined();
      expect(MODULES[key as ModuleKey].label.length).toBeGreaterThan(0);
    }
  });

  it('ALL_MODULE_KEYS lists every key exactly once', () => {
    expect(new Set(ALL_MODULE_KEYS).size).toBe(ALL_MODULE_KEYS.length);
    expect(ALL_MODULE_KEYS).toContain(ModuleKey.OPS_CONTROL);
    expect(ALL_MODULE_KEYS).toContain(ModuleKey.PICKUP);
  });

  it('does NOT include "admin" — admin is always-on infrastructure', () => {
    expect(Object.values(ModuleKey)).not.toContain('admin');
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

### Task 5.2: Implement registry

**Files:**
- Create: `apps/frontend/src/lib/modules/registry.ts`

- [ ] **Step 1: Write registry**

```ts
/**
 * spec-45 — Module Registry
 * Source of truth for which modules CAN be toggled. The DB activation tables
 * store TEXT keys; this enum validates them.
 */

export enum ModuleKey {
  OPS_CONTROL = 'ops_control',
  LATE_ORDER_ALERTS = 'late_order_alerts',
  PICKUP = 'pickup',
  RECEPTION = 'reception',
  DISTRIBUTION = 'distribution',
  PRE_ROUTE = 'pre_route',
  DISPATCH = 'dispatch',
  RETURNS = 'returns',
  CONVERSATIONS = 'conversations',
}

export interface ModuleMeta {
  label: string;
  description: string;
  navHref: string | null;
  navIcon?: string;
}

export const MODULES: Record<ModuleKey, ModuleMeta> = {
  [ModuleKey.OPS_CONTROL]: {
    label: 'Operations Control',
    description: 'Pipeline visibility dashboard for ops managers.',
    navHref: '/operations-control',
  },
  [ModuleKey.LATE_ORDER_ALERTS]: {
    label: 'Late Order Alerts',
    description: 'WhatsApp/email notifications when an order approaches or breaches its commercial deadline.',
    navHref: null,
  },
  [ModuleKey.PICKUP]: {
    label: 'Pickup',
    description: 'Tenant warehouse load verification with OCR.',
    navHref: '/pickup',
  },
  [ModuleKey.RECEPTION]: {
    label: 'Reception',
    description: 'Hub inbound package intake.',
    navHref: '/reception',
  },
  [ModuleKey.DISTRIBUTION]: {
    label: 'Distribution',
    description: 'Dock zone assignment and batch packaging.',
    navHref: '/distribution',
  },
  [ModuleKey.PRE_ROUTE]: {
    label: 'Pre-Route',
    description: 'Route planning visibility (andén → truck mapping).',
    navHref: '/pre-route',
  },
  [ModuleKey.DISPATCH]: {
    label: 'Dispatch',
    description: 'Route building, truck assignment, DispatchTrack push.',
    navHref: '/dispatch',
  },
  [ModuleKey.RETURNS]: {
    label: 'Returns',
    description: 'Failed-delivery handling and return-to-sender flows.',
    navHref: '/returns',
  },
  [ModuleKey.CONVERSATIONS]: {
    label: 'Conversations',
    description: 'WhatsApp/SMS agent conversation monitoring.',
    navHref: '/conversations',
  },
};

export const ALL_MODULE_KEYS: readonly ModuleKey[] = Object.values(ModuleKey);

export function isValidModuleKey(value: string): value is ModuleKey {
  return ALL_MODULE_KEYS.includes(value as ModuleKey);
}
```

- [ ] **Step 2: Run; confirm PASS**

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/modules/registry.ts apps/frontend/src/lib/modules/registry.test.ts
git commit -m "feat(spec-45): module registry with ModuleKey enum and metadata"
```

### Task 5.3: Write `enabled.ts` test

**Files:**
- Create: `apps/frontend/src/lib/modules/enabled.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ModuleKey } from './registry';

const rpcMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: {
      user: { app_metadata: { claims: { operator_id: 'op-1' } } }
    } } }) },
    rpc: rpcMock,
  })),
}));

beforeEach(() => { rpcMock.mockReset(); });

describe('getEnabledModulesForCurrentUser (spec-45)', () => {
  it('returns typed set of enabled modules', async () => {
    rpcMock.mockResolvedValue({ data: ['ops_control','pickup'], error: null });
    const { getEnabledModulesForCurrentUser } = await import('./enabled');
    const set = await getEnabledModulesForCurrentUser();
    expect(set.has(ModuleKey.OPS_CONTROL)).toBe(true);
    expect(set.has(ModuleKey.PICKUP)).toBe(true);
    expect(set.has(ModuleKey.DISPATCH)).toBe(false);
  });

  it('filters out unknown keys from DB', async () => {
    rpcMock.mockResolvedValue({ data: ['ops_control','rogue_module'], error: null });
    const { getEnabledModulesForCurrentUser } = await import('./enabled');
    const set = await getEnabledModulesForCurrentUser();
    expect(set.size).toBe(1);
  });

  it('throws on RPC error (fail-closed)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { getEnabledModulesForCurrentUser } = await import('./enabled');
    await expect(getEnabledModulesForCurrentUser()).rejects.toThrow();
  });
});
```

> **Note:** Vitest's React `cache()` memoization runs per call in tests since there is no React server-render boundary. The memoization is exercised in integration; per-request behavior is implicit.

- [ ] **Step 2: Run; confirm FAIL**

### Task 5.4: Implement `enabled.ts`

**Files:**
- Create: `apps/frontend/src/lib/modules/enabled.ts`

- [ ] **Step 1: Write helper**

```ts
import { cache } from 'react';
import * as Sentry from '@sentry/nextjs';
import { createSSRClient } from '@/lib/supabase/server';
import { ALL_MODULE_KEYS, ModuleKey, isValidModuleKey } from './registry';

export type EnabledModulesSet = ReadonlySet<ModuleKey>;

export const getEnabledModulesForCurrentUser = cache(
  async (): Promise<EnabledModulesSet> => {
    const supabase = await createSSRClient();
    const { data: { session } } = await supabase.auth.getSession();
    const operatorId = session?.user?.app_metadata?.claims?.operator_id;
    if (!operatorId) {
      // No session = no modules. Fail-closed.
      return new Set();
    }

    const { data, error } = await supabase.rpc(
      'get_enabled_modules_for_operator',
      { p_operator_id: operatorId }
    );
    if (error) {
      throw new Error(`get_enabled_modules_for_operator failed: ${error.message}`);
    }

    const keys = (data ?? []) as string[];
    const filtered: ModuleKey[] = [];
    for (const k of keys) {
      if (isValidModuleKey(k)) filtered.push(k);
      else {
        Sentry.captureMessage(`Unknown module_key from DB: ${k}`, 'warning');
      }
    }
    return new Set(filtered);
  }
);

export async function isModuleEnabled(key: ModuleKey): Promise<boolean> {
  const set = await getEnabledModulesForCurrentUser();
  return set.has(key);
}

// Re-exported for callers that want the registry-defined list of keys.
export { ALL_MODULE_KEYS };
```

- [ ] **Step 2: Run; confirm PASS**

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/modules/enabled.ts apps/frontend/src/lib/modules/enabled.test.ts
git commit -m "feat(spec-45): getEnabledModulesForCurrentUser helper with fail-closed semantics"
```

### Task 5.5: Test + implement `require-enabled.ts`

**Files:**
- Create: `apps/frontend/src/lib/modules/require-enabled.test.ts`
- Create: `apps/frontend/src/lib/modules/require-enabled.ts`

- [ ] **Step 1: Failing test**

```ts
import { vi, describe, it, expect } from 'vitest';
import { ModuleKey } from './registry';

const notFoundMock = vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); });
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));

vi.mock('./enabled', () => ({
  isModuleEnabled: vi.fn(),
}));

describe('requireModuleEnabled (spec-45)', () => {
  it('returns undefined when module enabled', async () => {
    const { isModuleEnabled } = await import('./enabled');
    (isModuleEnabled as any).mockResolvedValue(true);
    const { requireModuleEnabled } = await import('./require-enabled');
    await expect(requireModuleEnabled(ModuleKey.PICKUP)).resolves.toBeUndefined();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('calls notFound() when module disabled', async () => {
    const { isModuleEnabled } = await import('./enabled');
    (isModuleEnabled as any).mockResolvedValue(false);
    const { requireModuleEnabled } = await import('./require-enabled');
    await expect(requireModuleEnabled(ModuleKey.PICKUP)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

- [ ] **Step 3: Implement**

```ts
import { notFound } from 'next/navigation';
import { isModuleEnabled } from './enabled';
import type { ModuleKey } from './registry';

export async function requireModuleEnabled(key: ModuleKey): Promise<void> {
  if (!(await isModuleEnabled(key))) notFound();
}
```

- [ ] **Step 4: Run; confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/modules/require-enabled.ts apps/frontend/src/lib/modules/require-enabled.test.ts
git commit -m "feat(spec-45): requireModuleEnabled layout guard"
```

### Task 5.6: Test + implement `with-module.ts`

**Files:**
- Create: `apps/frontend/src/lib/modules/with-module.test.ts`
- Create: `apps/frontend/src/lib/modules/with-module.ts`

- [ ] **Step 1: Failing test**

```ts
import { vi, describe, it, expect } from 'vitest';
import { ModuleKey } from './registry';

vi.mock('./enabled', () => ({ isModuleEnabled: vi.fn() }));

describe('withModule (spec-45)', () => {
  it('invokes handler when enabled', async () => {
    const { isModuleEnabled } = await import('./enabled');
    (isModuleEnabled as any).mockResolvedValue(true);
    const { withModule } = await import('./with-module');
    const handler = vi.fn(async () => new Response('ok'));
    const wrapped = withModule(ModuleKey.DISPATCH, handler);
    const res = await wrapped(new Request('http://x'));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalled();
  });

  it('returns 404 when disabled', async () => {
    const { isModuleEnabled } = await import('./enabled');
    (isModuleEnabled as any).mockResolvedValue(false);
    const { withModule } = await import('./with-module');
    const handler = vi.fn();
    const wrapped = withModule(ModuleKey.DISPATCH, handler);
    const res = await wrapped(new Request('http://x'));
    expect(res.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

- [ ] **Step 3: Implement**

```ts
import { isModuleEnabled } from './enabled';
import type { ModuleKey } from './registry';

type RouteHandler<Args extends unknown[]> = (req: Request, ...rest: Args) => Promise<Response> | Response;

export function withModule<Args extends unknown[]>(
  key: ModuleKey,
  handler: RouteHandler<Args>
): RouteHandler<Args> {
  return async (req, ...rest) => {
    if (!(await isModuleEnabled(key))) {
      return new Response('Not Found', { status: 404 });
    }
    return handler(req, ...rest);
  };
}
```

- [ ] **Step 4: Run; confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/modules/with-module.ts apps/frontend/src/lib/modules/with-module.test.ts
git commit -m "feat(spec-45): withModule wrapper for API route guards"
```

---

## Chunk 6: Admin UI — Server Actions

Goal: server-side actions calling the RPCs, with super-admin enforcement at the server boundary.

### Task 6.1: Test for `actions.ts`

**Files:**
- Create: `apps/frontend/src/components/admin/modules/actions.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

const rpcMock = vi.fn();
const getSessionMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
  })),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

beforeEach(() => { rpcMock.mockReset(); getSessionMock.mockReset(); });

const superAdminSession = { data: { session: { user: { app_metadata: { claims: { role: 'super_admin' } } } } } };
const adminSession = { data: { session: { user: { app_metadata: { claims: { role: 'admin' } } } } } };

describe('module activation server actions (spec-45)', () => {
  it('enableModule rejects non-super-admin', async () => {
    getSessionMock.mockResolvedValue(adminSession);
    const { enableModule } = await import('./actions');
    await expect(enableModule('op-1', 'pickup', 'reason')).rejects.toThrow(/access denied/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('enableModule rejects empty reason', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    const { enableModule } = await import('./actions');
    await expect(enableModule('op-1', 'pickup', '')).rejects.toThrow(/reason/i);
  });

  it('enableModule calls RPC for super-admin', async () => {
    getSessionMock.mockResolvedValue(superAdminSession);
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { enableModule } = await import('./actions');
    await enableModule('op-1', 'pickup', 'phase-1 go-live');
    expect(rpcMock).toHaveBeenCalledWith('enable_module_for_operator', {
      p_operator_id: 'op-1', p_module_key: 'pickup', p_reason: 'phase-1 go-live'
    });
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

### Task 6.2: Implement `actions.ts`

**Files:**
- Create: `apps/frontend/src/components/admin/modules/actions.ts`

- [ ] **Step 1: Implementation**

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { createSSRClient } from '@/lib/supabase/server';
import { isValidModuleKey } from '@/lib/modules/registry';

async function assertSuperAdmin() {
  const supabase = await createSSRClient();
  const { data: { session } } = await supabase.auth.getSession();
  const role = session?.user?.app_metadata?.claims?.role;
  if (role !== 'super_admin') throw new Error('access denied');
  return supabase;
}

function assertReason(reason: string) {
  if (!reason || reason.trim().length === 0) {
    throw new Error('reason is required');
  }
}

export async function enableModule(operatorId: string, moduleKey: string, reason: string) {
  const supabase = await assertSuperAdmin();
  assertReason(reason);
  if (!isValidModuleKey(moduleKey)) throw new Error(`invalid module: ${moduleKey}`);

  const { error } = await supabase.rpc('enable_module_for_operator', {
    p_operator_id: operatorId, p_module_key: moduleKey, p_reason: reason,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/modules');
}

export async function disableModule(operatorId: string, moduleKey: string, reason: string) {
  const supabase = await assertSuperAdmin();
  assertReason(reason);
  if (!isValidModuleKey(moduleKey)) throw new Error(`invalid module: ${moduleKey}`);

  const { error } = await supabase.rpc('disable_module_for_operator', {
    p_operator_id: operatorId, p_module_key: moduleKey, p_reason: reason,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/modules');
}

export async function fetchOperatorsWithState() {
  const supabase = await assertSuperAdmin();
  const { data, error } = await supabase.rpc('list_operators_with_module_state');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchAudit(operatorId: string) {
  const supabase = await assertSuperAdmin();
  const { data, error } = await supabase.rpc('get_module_audit_for_operator', {
    p_operator_id: operatorId,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}
```

- [ ] **Step 2: Run; confirm PASS**

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/admin/modules/actions.ts apps/frontend/src/components/admin/modules/actions.test.ts
git commit -m "feat(spec-45): server actions for module activation"
```

---

## Chunk 7: Admin UI — Components

Goal: route + components that let a super-admin flip toggles.

### Task 7.1: Route page with super-admin gate

**Files:**
- Create: `apps/frontend/src/app/admin/modules/page.tsx`

- [ ] **Step 1: Write page (no separate test — gate behavior is exercised by the component test below)**

```tsx
import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import { ModulesAdminPage } from '@/components/admin/modules/ModulesAdminPage';
import { fetchOperatorsWithState } from '@/components/admin/modules/actions';

export const metadata = {
  title: 'Módulos | Aureon Last Mile',
  description: 'Activate or deactivate modules per operator (super-admin only).',
};

export default async function ModulesAdminRoute() {
  const supabase = await createSSRClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/login');
  const role = session.user.app_metadata?.claims?.role;
  if (role !== 'super_admin') redirect('/admin?error=unauthorized');

  const operators = await fetchOperatorsWithState();
  return <ModulesAdminPage operators={operators} />;
}
```

- [ ] **Step 2: Commit (will follow with components)**

```bash
git add apps/frontend/src/app/admin/modules/page.tsx
git commit -m "feat(spec-45): /admin/modules route with super-admin redirect"
```

### Task 7.2: `ModulesAdminPage` component test

**Files:**
- Create: `apps/frontend/src/components/admin/modules/ModulesAdminPage.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModulesAdminPage } from './ModulesAdminPage';

vi.mock('./actions', () => ({
  enableModule: vi.fn(),
  disableModule: vi.fn(),
  fetchAudit: vi.fn(async () => []),
}));

const ops = [
  { operator_id: 'op-1', operator_name: 'Tenant One', operator_slug: 't1', enabled_modules: ['ops_control'] },
  { operator_id: 'op-2', operator_name: 'Tenant Two', operator_slug: 't2', enabled_modules: [] },
];

describe('ModulesAdminPage (spec-45)', () => {
  it('renders operator picker', () => {
    render(<ModulesAdminPage operators={ops} />);
    expect(screen.getByRole('combobox', { name: /operator/i })).toBeInTheDocument();
  });

  it('shows a card per ModuleKey for the selected operator', () => {
    render(<ModulesAdminPage operators={ops} />);
    expect(screen.getAllByTestId('module-card').length).toBeGreaterThanOrEqual(9);
  });

  it('shows enabled state for ops_control when selected operator has it', () => {
    render(<ModulesAdminPage operators={ops} />);
    expect(screen.getByTestId('module-card-ops_control')).toHaveAttribute('data-enabled', 'true');
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

### Task 7.3: Implement `ModulesAdminPage`

**Files:**
- Create: `apps/frontend/src/components/admin/modules/ModulesAdminPage.tsx`

- [ ] **Step 1: Write component**

```tsx
'use client';

import { useState } from 'react';
import { ALL_MODULE_KEYS, MODULES, ModuleKey } from '@/lib/modules/registry';
import { ModuleCard } from './ModuleCard';

interface OperatorState {
  operator_id: string;
  operator_name: string;
  operator_slug: string;
  enabled_modules: string[];
}

interface Props { operators: OperatorState[]; }

export function ModulesAdminPage({ operators }: Props) {
  const [selectedId, setSelectedId] = useState(operators[0]?.operator_id ?? '');
  const selected = operators.find(o => o.operator_id === selectedId);
  const enabledSet = new Set(selected?.enabled_modules ?? []);

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-foreground mb-6">Activación de Módulos</h1>

        <label className="block mb-4">
          <span className="text-sm font-medium">Operator</span>
          <select
            role="combobox"
            aria-label="operator"
            className="mt-1 w-full max-w-md rounded border bg-background px-3 py-2"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {operators.map(o => (
              <option key={o.operator_id} value={o.operator_id}>{o.operator_name}</option>
            ))}
          </select>
        </label>

        {selected && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {ALL_MODULE_KEYS.map((key: ModuleKey) => (
              <ModuleCard
                key={key}
                operatorId={selected.operator_id}
                moduleKey={key}
                meta={MODULES[key]}
                enabled={enabledSet.has(key)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run; confirm PASS**

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/admin/modules/ModulesAdminPage.tsx apps/frontend/src/components/admin/modules/ModulesAdminPage.test.tsx
git commit -m "feat(spec-45): ModulesAdminPage with operator picker and grid"
```

### Task 7.4: `ModuleCard` test + implementation

**Files:**
- Create: `apps/frontend/src/components/admin/modules/ModuleCard.test.tsx`
- Create: `apps/frontend/src/components/admin/modules/ModuleCard.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModuleCard } from './ModuleCard';
import { ModuleKey, MODULES } from '@/lib/modules/registry';

describe('ModuleCard (spec-45)', () => {
  it('renders label and description', () => {
    render(
      <ModuleCard
        operatorId="op-1"
        moduleKey={ModuleKey.PICKUP}
        meta={MODULES[ModuleKey.PICKUP]}
        enabled={false}
      />
    );
    expect(screen.getByText(MODULES[ModuleKey.PICKUP].label)).toBeInTheDocument();
  });

  it('clicking the toggle opens the reason dialog', () => {
    render(
      <ModuleCard
        operatorId="op-1"
        moduleKey={ModuleKey.PICKUP}
        meta={MODULES[ModuleKey.PICKUP]}
        enabled={false}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /enable/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

- [ ] **Step 3: Implementation**

```tsx
'use client';

import { useState } from 'react';
import type { ModuleKey, ModuleMeta } from '@/lib/modules/registry';
import { ToggleDialog } from './ToggleDialog';
import { AuditDrawer } from './AuditDrawer';

interface Props {
  operatorId: string;
  moduleKey: ModuleKey;
  meta: ModuleMeta;
  enabled: boolean;
}

export function ModuleCard({ operatorId, moduleKey, meta, enabled }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);

  return (
    <div
      data-testid="module-card"
      data-testid-key={`module-card-${moduleKey}`}
      data-enabled={enabled ? 'true' : 'false'}
      className="rounded-lg border bg-card p-4 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold">{meta.label}</h3>
          <p className="text-sm text-muted-foreground">{meta.description}</p>
        </div>
        <span className={`px-2 py-0.5 text-xs rounded ${enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
          {enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <div className="flex gap-2 mt-2">
        <button
          className="rounded bg-primary text-primary-foreground px-3 py-1 text-sm"
          onClick={() => setDialogOpen(true)}
        >
          {enabled ? 'Disable' : 'Enable'}
        </button>
        <button
          className="rounded border px-3 py-1 text-sm"
          onClick={() => setAuditOpen(true)}
        >
          View audit
        </button>
      </div>
      {dialogOpen && (
        <ToggleDialog
          operatorId={operatorId}
          moduleKey={moduleKey}
          currentlyEnabled={enabled}
          onClose={() => setDialogOpen(false)}
        />
      )}
      {auditOpen && (
        <AuditDrawer
          operatorId={operatorId}
          moduleKey={moduleKey}
          onClose={() => setAuditOpen(false)}
        />
      )}
    </div>
  );
}
```

> Note: the testing-library `getByTestId('module-card-ops_control')` lookup uses the `data-testid-key` attribute — we use a separate attribute to keep `data-testid` stable across cards while still allowing per-key lookup. If tests need standard `data-testid` per key, replace `data-testid` with the keyed value and add `data-card="true"` for the multi-select test.

- [ ] **Step 4: Adjust to whichever testid scheme the tests in 7.2 + 7.4 expect; run; confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/admin/modules/ModuleCard.tsx apps/frontend/src/components/admin/modules/ModuleCard.test.tsx
git commit -m "feat(spec-45): ModuleCard with enable/disable + audit buttons"
```

### Task 7.5: `ToggleDialog` test + implementation

**Files:**
- Create: `apps/frontend/src/components/admin/modules/ToggleDialog.test.tsx`
- Create: `apps/frontend/src/components/admin/modules/ToggleDialog.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToggleDialog } from './ToggleDialog';
import { ModuleKey } from '@/lib/modules/registry';

const enable = vi.fn();
const disable = vi.fn();
vi.mock('./actions', () => ({ enableModule: (...a:unknown[]) => enable(...a), disableModule: (...a:unknown[]) => disable(...a) }));

beforeEach(() => { enable.mockReset(); disable.mockReset(); });

describe('ToggleDialog (spec-45)', () => {
  it('blocks submit with empty reason', async () => {
    render(<ToggleDialog operatorId="op-1" moduleKey={ModuleKey.PICKUP} currentlyEnabled={false} onClose={() => {}} />);
    const submit = screen.getByRole('button', { name: /confirm/i });
    expect(submit).toBeDisabled();
  });

  it('calls enableModule with reason when currently disabled', async () => {
    enable.mockResolvedValue(undefined);
    render(<ToggleDialog operatorId="op-1" moduleKey={ModuleKey.PICKUP} currentlyEnabled={false} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'phase-1 go-live' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(enable).toHaveBeenCalledWith('op-1', 'pickup', 'phase-1 go-live'));
  });

  it('calls disableModule when currently enabled', async () => {
    disable.mockResolvedValue(undefined);
    render(<ToggleDialog operatorId="op-1" moduleKey={ModuleKey.PICKUP} currentlyEnabled={true} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'rolling back' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(disable).toHaveBeenCalledWith('op-1', 'pickup', 'rolling back'));
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

- [ ] **Step 3: Implementation**

```tsx
'use client';

import { useState } from 'react';
import { ModuleKey } from '@/lib/modules/registry';
import { enableModule, disableModule } from './actions';

interface Props {
  operatorId: string;
  moduleKey: ModuleKey;
  currentlyEnabled: boolean;
  onClose: () => void;
}

export function ToggleDialog({ operatorId, moduleKey, currentlyEnabled, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setPending(true); setError(null);
    try {
      if (currentlyEnabled) await disableModule(operatorId, moduleKey, reason);
      else await enableModule(operatorId, moduleKey, reason);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'unknown error');
    } finally {
      setPending(false);
    }
  }

  return (
    <div role="dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-2">
          {currentlyEnabled ? 'Disable' : 'Enable'} {moduleKey}
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          A reason is required. It is stored in the audit log.
        </p>
        <textarea
          role="textbox"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded border bg-background p-2 text-sm"
          rows={3}
          placeholder="e.g. phase-1 go-live"
        />
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-3 py-1 text-sm border rounded">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={pending || reason.trim().length === 0}
            className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run; confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/admin/modules/ToggleDialog.tsx apps/frontend/src/components/admin/modules/ToggleDialog.test.tsx
git commit -m "feat(spec-45): ToggleDialog enforcing mandatory reason"
```

### Task 7.6: `AuditDrawer` test + implementation

**Files:**
- Create: `apps/frontend/src/components/admin/modules/AuditDrawer.test.tsx`
- Create: `apps/frontend/src/components/admin/modules/AuditDrawer.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuditDrawer } from './AuditDrawer';
import { ModuleKey } from '@/lib/modules/registry';

const rows = [
  { id: '1', module_key: 'pickup', action: 'enable', actor_user_id: 'u1', at: '2026-06-16T10:00:00Z', reason: 'phase-1 go-live' },
  { id: '2', module_key: 'pickup', action: 'disable', actor_user_id: 'u1', at: '2026-06-15T10:00:00Z', reason: 'pre-launch test' },
];
vi.mock('./actions', () => ({ fetchAudit: vi.fn(async () => rows) }));

describe('AuditDrawer (spec-45)', () => {
  it('renders entries in reverse chronological order', async () => {
    render(<AuditDrawer operatorId="op-1" moduleKey={ModuleKey.PICKUP} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('phase-1 go-live')).toBeInTheDocument());
    const entries = screen.getAllByTestId('audit-entry');
    expect(entries[0]).toHaveTextContent('enable');
    expect(entries[1]).toHaveTextContent('disable');
  });

  it('filters by the supplied moduleKey', async () => {
    render(<AuditDrawer operatorId="op-1" moduleKey={ModuleKey.DISPATCH} onClose={() => {}} />);
    await waitFor(() => expect(screen.queryByText('phase-1 go-live')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run; confirm FAIL**

- [ ] **Step 3: Implementation**

```tsx
'use client';

import { useEffect, useState } from 'react';
import type { ModuleKey } from '@/lib/modules/registry';
import { fetchAudit } from './actions';

interface AuditRow {
  id: string; module_key: string; action: string;
  actor_user_id: string; at: string; reason: string | null;
}

interface Props { operatorId: string; moduleKey: ModuleKey; onClose: () => void; }

export function AuditDrawer({ operatorId, moduleKey, onClose }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  useEffect(() => { fetchAudit(operatorId).then(setRows); }, [operatorId]);
  const filtered = rows.filter(r => r.module_key === moduleKey);

  return (
    <div role="dialog" className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-background border-l p-6 overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Audit — {moduleKey}</h2>
        <button onClick={onClose} className="text-sm">Close</button>
      </div>
      <ul className="space-y-3">
        {filtered.map(r => (
          <li key={r.id} data-testid="audit-entry" className="border rounded p-3">
            <div className="text-sm font-medium">{r.action} · {new Date(r.at).toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">by {r.actor_user_id}</div>
            {r.reason && <div className="text-sm mt-1">{r.reason}</div>}
          </li>
        ))}
        {filtered.length === 0 && <li className="text-sm text-muted-foreground">No audit entries yet.</li>}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run; confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/admin/modules/AuditDrawer.tsx apps/frontend/src/components/admin/modules/AuditDrawer.test.tsx
git commit -m "feat(spec-45): AuditDrawer for module activation history"
```

### Task 7.7: Add "Módulos" tab to existing AdminPage for super-admin

**Files:**
- Modify: `apps/frontend/src/components/admin/AdminPage.tsx`

- [ ] **Step 1: Add test in `AdminPage.test.tsx`**

Add a test asserting the "Módulos" tab is rendered only when `userRole === 'super_admin'`. (Look at the existing test file for the test pattern and add an analogous case.)

- [ ] **Step 2: Run; confirm FAIL**

- [ ] **Step 3: Modify `AdminPage.tsx`**

Inside the `TabsList`, add (gated):

```tsx
{userRole === 'super_admin' && (
  <TabsTrigger value="modules">Módulos</TabsTrigger>
)}
```

The tab itself routes to `/admin/modules` via a `<Link>` rather than rendering inline (since the modules UI is a server-rendered route). Implement the trigger as a navigation:

```tsx
{userRole === 'super_admin' && (
  <Link href="/admin/modules" className="...trigger-style">
    Módulos
  </Link>
)}
```

(Match the visual style of existing `<TabsTrigger>` so the tab row stays consistent.)

- [ ] **Step 4: Run; confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/admin/AdminPage.tsx apps/frontend/src/components/admin/AdminPage.test.tsx
git commit -m "feat(spec-45): expose Módulos tab to super-admin in AdminPage"
```

---

## Chunk 8: End-to-End Verification + Spec Status

Goal: confirm the whole loop works against a local Supabase, then flip the spec to `in progress` so it's picked up by sprint tracking.

### Task 8.1: Full local verification

- [ ] **Step 1: Reset local DB and apply all migrations**

```bash
pnpm --filter database supabase db reset
```

- [ ] **Step 2: Confirm fixtures**

```sql
-- Confirm internal operator and system user exist
SELECT id, slug FROM public.operators WHERE slug = 'aureon-internal';
-- Confirm pre-existing operator(s) seeded with Phase 1 modules
SELECT operator_id, array_agg(module_key)
  FROM public.operator_enabled_modules
 WHERE disabled_at IS NULL
 GROUP BY operator_id;
```

Pre-existing operators should each show `{ops_control, late_order_alerts}`.

- [ ] **Step 3: Create a test super-admin user**

Use the Supabase Studio (or `supabase.auth.admin.createUser` from a one-off script) to create a user with email `admin@aureon-internal.local`, then update `public.users` to set `operator_id = aureon-internal.id`, `role = 'super_admin'`.

- [ ] **Step 4: Log in as the super-admin in the dev server**

```bash
pnpm --filter @aureon/frontend dev
```

Navigate to `/admin/modules`. Confirm:
- Operator picker renders with all operators
- Module grid renders nine `ModuleCard`s
- For pre-existing tenant: `ops_control` and `late_order_alerts` show as Enabled; others as Disabled
- Toggle Pickup ON with reason `verification: spec-45 manual`; confirm card flips to Enabled
- Click "View audit"; confirm the entry appears in the drawer with the reason
- Toggle Pickup OFF; confirm card flips to Disabled; confirm both entries visible in audit

- [ ] **Step 5: Log in as a non-super-admin user**

Navigate to `/admin/modules` directly; confirm redirect to `/admin?error=unauthorized`.

- [ ] **Step 6: Confirm helper API behavior**

Add a temporary debug endpoint or run via Vitest:
```ts
import { getEnabledModulesForCurrentUser } from '@/lib/modules/enabled';
console.log(await getEnabledModulesForCurrentUser());
// When session belongs to a pre-existing tenant:
// → Set(2) { 'ops_control', 'late_order_alerts' }
```

Remove any debug code before commit.

### Task 8.2: Run full test suite + typecheck

- [ ] **Step 1: Vitest**

```bash
pnpm --filter @aureon/frontend test
```

Expected: all new tests pass; no pre-existing tests regress.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @aureon/frontend typecheck
```

- [ ] **Step 3: Lint**

```bash
pnpm --filter @aureon/frontend lint
```

- [ ] **Step 4: SQL test**

```bash
psql "$DATABASE_URL" -f packages/database/supabase/tests/spec45_module_activation_test.sql
```

### Task 8.3: Flip spec to `in progress`, push, PR

- [ ] **Step 1: Update spec status**

```diff
- **Status:** backlog
+ **Status:** in progress
```

- [ ] **Step 2: Push branch + open PR with auto-merge per project rule**

```bash
git push -u origin spec-45-module-activation-layer
gh pr create --title "feat(spec-45): per-tenant module activation layer" \
  --body "$(cat <<'EOF'
## Summary
- Per-tenant module activation primitive (spec-45 of phased rollout strategy).
- Two new tables, five SECURITY DEFINER RPCs, super_admin role, helper API, guards.
- Admin UI tab visible only to super-admin.
- Existing operators seeded with ops_control + late_order_alerts; new operators get nothing.

## Test plan
- [ ] `pnpm test` green
- [ ] `pnpm typecheck` green
- [ ] `pnpm lint` green
- [ ] SQL test suite passes against local Supabase
- [ ] Manual verification per spec § Verification, steps 1–7
EOF
)"
gh pr merge --auto --squash
```

- [ ] **Step 3: Poll CI and confirm merge** (per `feedback_wait_for_merge.md`)

```bash
gh pr checks <N>
gh pr view <N> --json state,mergedAt
```

Only after `mergedAt` is non-null and CI is green, update the spec status to `completed` in a follow-up PR. Do **not** self-declare complete; wait for user confirmation per `docs/specs/CLAUDE.md`.

---

## Out-of-Scope Reminder

- Wiring activation guards into existing module layouts → **spec-46**
- Ops Control preset architecture + Visibility preset → **spec-47, spec-48**
- Late-order alerts agent → **spec-49**
- DispatchTrack reconciliation job → **spec-50**

See `docs/architecture/phased-rollout-strategy.md` § "Spec Map" for the full breakdown and dependency graph.

