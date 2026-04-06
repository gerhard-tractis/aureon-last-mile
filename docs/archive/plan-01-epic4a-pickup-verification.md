# Epic 4A: Pickup Verification — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable pickup crews to verify packages at retailer DCs using hardware barcode scanners, track discrepancies, and capture digital signatures for legal custody transfer.

**Architecture:** Next.js 15 App Router pages under `/pickup/*`, protected by permissions-based access. Supabase tables with RLS for manifests, scans, and discrepancy notes. TanStack Query for server state. Web Audio API for scan feedback.

**Tech Stack:** Next.js 15, Supabase (PostgreSQL + RLS), TanStack Query v5, shadcn/ui, Web Audio API, Vibration API, canvas signature pad.

**Spec:** `docs/plans/spec-01-epic4a-pickup-verification.md`

---

## File Structure

### Database migrations
```
apps/frontend/supabase/migrations/
  20260311000001_add_user_permissions.sql          → Task 1 (Story 4.0)
  20260311000002_create_pickup_tables.sql           → Task 3 (Story 4.1)
```

### Auth & permissions
```
apps/frontend/src/lib/types/auth.types.ts          → Task 2: Update CustomClaims + permission helpers
apps/frontend/src/components/AppLayout.tsx          → Task 2: Update nav to use permissions
```

### Pickup pages
```
apps/frontend/src/app/pickup/layout.tsx            → Task 4: Permission guard
apps/frontend/src/app/pickup/page.tsx              → Task 5: Manifest list page
apps/frontend/src/app/pickup/scan/[loadId]/page.tsx → Task 7: Scanning page
apps/frontend/src/app/pickup/review/[loadId]/page.tsx → Task 10: Discrepancy review
apps/frontend/src/app/pickup/complete/[loadId]/page.tsx → Task 11: Signature + completion
```

### Pickup components
```
apps/frontend/src/components/pickup/
  ManifestCard.tsx             → Task 5: Single manifest card
  ManifestTabs.tsx             → Task 5: Active/Completed tabs
  ScannerInput.tsx             → Task 7: Auto-focused scanner input
  ScanHistoryList.tsx          → Task 7: Recent scan list
  ProgressBar.tsx              → Task 7: Animated progress bar
  ScanResultPopup.tsx          → Task 7: Error/duplicate popup
  DiscrepancyItem.tsx          → Task 10: Missing package + note input
  SignaturePad.tsx             → Task 11: Canvas signature capture
```

### Pickup hooks
```
apps/frontend/src/hooks/pickup/
  useManifests.ts              → Task 6: TanStack Query for manifests (includes useManifest, useCreateManifest, useManifestPackages)
  useManifests.test.ts         → Task 6: Tests
  usePickupScans.ts            → Task 8: Scan mutations
  usePickupScans.test.ts       → Task 8: Tests
  useDiscrepancies.ts          → Task 10: Missing packages + notes
  useDiscrepancies.test.ts     → Task 10: Tests
  useFeedback.ts               → Task 9: Audio/haptic hook
  useFeedback.test.ts          → Task 9: Tests
```

### Pickup lib
```
apps/frontend/src/lib/pickup/
  audio.ts                     → Task 9: Web Audio API beep generation
  audio.test.ts                → Task 9: Tests
  scan-validator.ts            → Task 8: Barcode → package/order lookup
  scan-validator.test.ts       → Task 8: Tests
```

---

## Chunk 1: Permissions Migration (Story 4.0)

### Task 1: Database migration — Add permissions column to users

**Files:**
- Create: `apps/frontend/supabase/migrations/20260311000001_add_user_permissions.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration: Add permissions array to users table
-- Story: 4.0 - Migrate RBAC from roles to permissions
-- Epic: 4A - Pickup Verification
-- Purpose: Support multiple permissions per user (e.g., pickup + loading)
-- Dependencies: 20260216170542_create_users_table_with_rbac.sql

-- ============================================================================
-- PART 1: Add permissions column
-- ============================================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT '{}';

COMMENT ON COLUMN public.users.permissions IS 'Array of permission flags: pickup, warehouse, loading, operations, admin. Users can have multiple permissions.';

-- ============================================================================
-- PART 2: Backfill permissions from existing role
-- ============================================================================

UPDATE public.users SET permissions = CASE role
  WHEN 'pickup_crew' THEN ARRAY['pickup']
  WHEN 'warehouse_staff' THEN ARRAY['warehouse']
  WHEN 'loading_crew' THEN ARRAY['loading']
  WHEN 'operations_manager' THEN ARRAY['operations']
  WHEN 'admin' THEN ARRAY['pickup', 'warehouse', 'loading', 'operations', 'admin']
  ELSE '{}'
END
WHERE permissions = '{}' OR permissions IS NULL;

-- ============================================================================
-- PART 3: Create index for permission lookups
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_users_permissions ON public.users USING GIN (permissions);

-- ============================================================================
-- PART 4: Update custom_access_token_hook to include permissions in JWT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims jsonb;
  user_operator_id uuid;
  user_role text;
  user_permissions text[];
BEGIN
  -- Query public.users for operator_id, role, and permissions (exclude soft-deleted)
  SELECT u.operator_id, u.role::text, u.permissions
  INTO user_operator_id, user_role, user_permissions
  FROM public.users u
  WHERE u.id = (event->>'user_id')::uuid
    AND u.deleted_at IS NULL;

  -- Build custom claims object
  claims := jsonb_build_object(
    'operator_id', user_operator_id,
    'role', user_role,
    'permissions', COALESCE(user_permissions, '{}')
  );

  -- Merge claims into event and return (same path as existing hook)
  RETURN jsonb_set(event, '{claims}', claims);
EXCEPTION
  WHEN OTHERS THEN
    -- Fail-secure: Return event without custom claims (auth will fail downstream)
    RAISE WARNING 'custom_access_token_hook failed: %', SQLERRM;
    RETURN event;
END;
$$;

-- ============================================================================
-- PART 5: Validation
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'permissions'
  ) THEN
    RAISE EXCEPTION 'permissions column not found on users table!';
  END IF;

  RAISE NOTICE '✓ Story 4.0 migration complete — permissions column added to users';
  RAISE NOTICE '  - Backfilled from existing role values';
  RAISE NOTICE '  - GIN index created for array lookups';
  RAISE NOTICE '  - JWT hook updated to include permissions in claims';
END $$;
```

- [ ] **Step 2: Verify migration locally**

Run: `cd apps/frontend && npx supabase db diff --local`
Expected: Shows the migration changes

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/supabase/migrations/20260311000001_add_user_permissions.sql
git commit -m "feat(4.0): add permissions column to users table with backfill"
```

---

### Task 2: Update auth types and permission helpers

**Files:**
- Modify: `apps/frontend/src/lib/types/auth.types.ts`
- Modify: `apps/frontend/src/components/AppLayout.tsx`
- Modify: `apps/frontend/src/components/AppLayout.test.tsx`

- [ ] **Step 1: Write failing test for hasPermission helper**

Add to a new test file `apps/frontend/src/lib/types/auth.types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hasPermission, Permission } from './auth.types';

describe('hasPermission', () => {
  it('returns true when permission exists in array', () => {
    expect(hasPermission(['pickup', 'loading'], 'pickup')).toBe(true);
  });

  it('returns false when permission not in array', () => {
    expect(hasPermission(['loading'], 'pickup')).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasPermission([], 'pickup')).toBe(false);
  });

  it('returns false for undefined/null', () => {
    expect(hasPermission(undefined, 'pickup')).toBe(false);
    expect(hasPermission(null as unknown as string[], 'pickup')).toBe(false);
  });

  it('admin permission grants access', () => {
    expect(hasPermission(['admin'], 'pickup')).toBe(true);
    expect(hasPermission(['admin'], 'operations')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/lib/types/auth.types.test.ts`
Expected: FAIL — `hasPermission` not exported

- [ ] **Step 3: Update auth.types.ts with permissions support**

Update `apps/frontend/src/lib/types/auth.types.ts`:

```typescript
// Add after UserRole enum
export type Permission = 'pickup' | 'warehouse' | 'loading' | 'operations' | 'admin';

// REPLACE the existing CustomClaims interface (around line 47) with this version:

export interface CustomClaims {
  operator_id: string;
  role: UserRole;
  permissions: Permission[];
}

/**
 * Check if user has a specific permission.
 * Admin permission grants access to everything.
 */
export function hasPermission(
  permissions: Permission[] | undefined | null,
  required: Permission
): boolean {
  if (!permissions || !Array.isArray(permissions)) return false;
  if (permissions.includes('admin')) return true;
  return permissions.includes(required);
}
```

Update existing `RolePermissions` methods to add deprecation comments pointing to `hasPermission`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/lib/types/auth.types.test.ts`
Expected: PASS — all 5 tests pass

- [ ] **Step 5: Update AppLayout.tsx to use permissions**

In `apps/frontend/src/components/AppLayout.tsx`, change:

```typescript
// OLD (line 29-36):
const [userRole, setUserRole] = useState<string | null>(null);
React.useEffect(() => {
    const supabase = createSPAClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
        setUserRole(session?.user?.app_metadata?.claims?.role ?? null);
    });
}, []);

// NEW:
const [userPermissions, setUserPermissions] = useState<string[]>([]);
const [userRole, setUserRole] = useState<string | null>(null);
React.useEffect(() => {
    const supabase = createSPAClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
        const claims = session?.user?.app_metadata?.claims;
        setUserRole(claims?.role ?? null);
        setUserPermissions(claims?.permissions ?? []);
    });
}, []);
```

Update the navigation array (line 59-66):

```typescript
// OLD:
const dashboardAllowed = userRole === 'operations_manager' || userRole === 'admin';

// NEW:
import { hasPermission } from '@/lib/types/auth.types';
import { ScanBarcode } from 'lucide-react';

const navigation = [
    ...(hasPermission(userPermissions, 'operations')
        ? [{ name: 'Dashboard', href: '/app/dashboard', icon: BarChart3 }]
        : []),
    ...(hasPermission(userPermissions, 'pickup')
        ? [{ name: 'Pickup', href: '/pickup', icon: ScanBarcode }]
        : []),
    { name: 'User Settings', href: '/app/user-settings', icon: User },
];
```

- [ ] **Step 6: Update AppLayout tests**

Update `apps/frontend/src/components/AppLayout.test.tsx` to mock permissions array in session claims instead of role-only checks.

- [ ] **Step 7: Run all tests**

Run: `cd apps/frontend && npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/lib/types/auth.types.ts apps/frontend/src/lib/types/auth.types.test.ts apps/frontend/src/components/AppLayout.tsx apps/frontend/src/components/AppLayout.test.tsx
git commit -m "feat(4.0): add permissions-based access control with hasPermission helper"
```

---

## Chunk 2: Database Tables (Story 4.1)

### Task 3: Create manifests, pickup_scans, discrepancy_notes tables

**Files:**
- Create: `apps/frontend/supabase/migrations/20260311000002_create_pickup_tables.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration: Create Pickup Verification Tables
-- Story: 4.1 - Create manifests, pickup_scans, discrepancy_notes tables
-- Epic: 4A - Pickup Verification
-- Purpose: Track pickup manifests, barcode scans, and discrepancy notes
-- Dependencies:
--   - 20260217000003_create_orders_table.sql (orders, packages tables)
--   - 20260311000001_add_user_permissions.sql (users.permissions)

-- ============================================================================
-- PART 1: Create ENUM Types
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE manifest_status_enum AS ENUM (
    'pending',
    'in_progress',
    'completed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE manifest_status_enum IS 'Pickup manifest lifecycle status';

DO $$ BEGIN
  CREATE TYPE scan_result_enum AS ENUM (
    'verified',
    'not_found',
    'duplicate'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE scan_result_enum IS 'Result of barcode scan validation against manifest';

-- ============================================================================
-- PART 2: Create manifests table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.manifests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id             UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  external_load_id        VARCHAR(100) NOT NULL,
  retailer_name           VARCHAR(50),
  pickup_location         TEXT,
  total_orders            INT DEFAULT 0,
  total_packages          INT DEFAULT 0,
  assigned_to_user_id     UUID REFERENCES public.users(id),
  status                  manifest_status_enum NOT NULL DEFAULT 'pending',
  signature_operator      TEXT,
  signature_operator_name VARCHAR(255),
  signature_client        TEXT,
  signature_client_name   VARCHAR(255),
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,

  CONSTRAINT unique_manifest_per_operator UNIQUE (operator_id, external_load_id)
);

COMMENT ON TABLE public.manifests IS 'Pickup verification sessions. One per external_load_id. Lazily created on first tap.';
COMMENT ON COLUMN public.manifests.external_load_id IS 'Client manifest/load ID — matches orders.external_load_id';
COMMENT ON COLUMN public.manifests.signature_operator IS 'URL to operator signature PNG in Supabase Storage';
COMMENT ON COLUMN public.manifests.signature_client IS 'URL to client representative signature PNG in Supabase Storage (optional)';

-- ============================================================================
-- PART 3: Create pickup_scans table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pickup_scans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  manifest_id         UUID NOT NULL REFERENCES public.manifests(id) ON DELETE CASCADE,
  package_id          UUID REFERENCES public.packages(id),
  barcode_scanned     VARCHAR(100) NOT NULL,
  scan_result         scan_result_enum NOT NULL,
  scanned_by_user_id  UUID REFERENCES public.users(id),
  scanned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE public.pickup_scans IS 'Individual barcode scan events during pickup verification';
COMMENT ON COLUMN public.pickup_scans.package_id IS 'FK to packages — NULL when scan_result is not_found (barcode not in manifest)';
COMMENT ON COLUMN public.pickup_scans.barcode_scanned IS 'Raw barcode string from hardware scanner';

-- ============================================================================
-- PART 4: Create discrepancy_notes table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.discrepancy_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  manifest_id         UUID NOT NULL REFERENCES public.manifests(id) ON DELETE CASCADE,
  package_id          UUID NOT NULL REFERENCES public.packages(id),
  note                TEXT NOT NULL,
  created_by_user_id  UUID REFERENCES public.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT unique_note_per_package UNIQUE (manifest_id, package_id)
);

COMMENT ON TABLE public.discrepancy_notes IS 'Crew notes explaining why a package is missing — appears on pickup receipt for dispute resolution';

-- ============================================================================
-- PART 5: Indexes
-- ============================================================================

-- manifests indexes
CREATE INDEX IF NOT EXISTS idx_manifests_operator_id ON public.manifests(operator_id);
CREATE INDEX IF NOT EXISTS idx_manifests_external_load_id ON public.manifests(operator_id, external_load_id);
CREATE INDEX IF NOT EXISTS idx_manifests_status ON public.manifests(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_manifests_deleted_at ON public.manifests(deleted_at);

-- pickup_scans indexes
CREATE INDEX IF NOT EXISTS idx_pickup_scans_operator_id ON public.pickup_scans(operator_id);
CREATE INDEX IF NOT EXISTS idx_pickup_scans_manifest_id ON public.pickup_scans(manifest_id);
CREATE INDEX IF NOT EXISTS idx_pickup_scans_package_id ON public.pickup_scans(package_id);
CREATE INDEX IF NOT EXISTS idx_pickup_scans_barcode ON public.pickup_scans(manifest_id, barcode_scanned);
CREATE INDEX IF NOT EXISTS idx_pickup_scans_deleted_at ON public.pickup_scans(deleted_at);

-- discrepancy_notes indexes
CREATE INDEX IF NOT EXISTS idx_discrepancy_notes_operator_id ON public.discrepancy_notes(operator_id);
CREATE INDEX IF NOT EXISTS idx_discrepancy_notes_manifest_id ON public.discrepancy_notes(manifest_id);
CREATE INDEX IF NOT EXISTS idx_discrepancy_notes_deleted_at ON public.discrepancy_notes(deleted_at);

-- ============================================================================
-- PART 6: Enable RLS
-- ============================================================================

ALTER TABLE public.manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pickup_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discrepancy_notes ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART 7: RLS Policies (tenant isolation via get_operator_id, idempotent)
-- ============================================================================

DO $$ BEGIN
  CREATE POLICY "manifests_tenant_isolation" ON public.manifests
    FOR ALL USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pickup_scans_tenant_isolation" ON public.pickup_scans
    FOR ALL USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "discrepancy_notes_tenant_isolation" ON public.discrepancy_notes
    FOR ALL USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- PART 8: GRANT/REVOKE (including service_role for edge functions)
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manifests TO authenticated;
GRANT ALL ON public.manifests TO service_role;
REVOKE ALL ON public.manifests FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pickup_scans TO authenticated;
GRANT ALL ON public.pickup_scans TO service_role;
REVOKE ALL ON public.pickup_scans FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discrepancy_notes TO authenticated;
GRANT ALL ON public.discrepancy_notes TO service_role;
REVOKE ALL ON public.discrepancy_notes FROM anon;

-- ============================================================================
-- PART 9: Audit triggers (idempotent — drop if exists first)
-- ============================================================================

DROP TRIGGER IF EXISTS audit_manifests_changes ON public.manifests;
CREATE TRIGGER audit_manifests_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.manifests
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS audit_pickup_scans_changes ON public.pickup_scans;
CREATE TRIGGER audit_pickup_scans_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.pickup_scans
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

DROP TRIGGER IF EXISTS audit_discrepancy_notes_changes ON public.discrepancy_notes;
CREATE TRIGGER audit_discrepancy_notes_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.discrepancy_notes
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ============================================================================
-- PART 10: updated_at triggers (idempotent — drop if exists first)
-- ============================================================================

DROP TRIGGER IF EXISTS set_manifests_updated_at ON public.manifests;
CREATE TRIGGER set_manifests_updated_at
  BEFORE UPDATE ON public.manifests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_pickup_scans_updated_at ON public.pickup_scans;
CREATE TRIGGER set_pickup_scans_updated_at
  BEFORE UPDATE ON public.pickup_scans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_discrepancy_notes_updated_at ON public.discrepancy_notes;
CREATE TRIGGER set_discrepancy_notes_updated_at
  BEFORE UPDATE ON public.discrepancy_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- PART 11: RPC — get unconsumed manifests for manifest list screen
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unconsumed_manifests(p_operator_id UUID)
RETURNS TABLE (
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  order_count BIGINT,
  package_count BIGINT,
  manifest_id UUID,
  manifest_status manifest_status_enum
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.external_load_id,
    o.retailer_name,
    COUNT(DISTINCT o.id) AS order_count,
    COUNT(DISTINCT p.id) AS package_count,
    m.id AS manifest_id,
    m.status AS manifest_status
  FROM public.orders o
  LEFT JOIN public.packages p ON p.order_id = o.id AND p.deleted_at IS NULL
  LEFT JOIN public.manifests m ON m.external_load_id = o.external_load_id
    AND m.operator_id = p_operator_id
    AND m.deleted_at IS NULL
  WHERE o.operator_id = p_operator_id
    AND o.external_load_id IS NOT NULL
    AND o.deleted_at IS NULL
    AND (m.id IS NULL OR m.status != 'completed')
  GROUP BY o.external_load_id, o.retailer_name, m.id, m.status
  ORDER BY o.external_load_id;
$$;

COMMENT ON FUNCTION public.get_unconsumed_manifests IS 'Returns manifest groups that are not yet completed for the manifest list screen (Story 4.2)';
GRANT EXECUTE ON FUNCTION public.get_unconsumed_manifests TO authenticated;

-- ============================================================================
-- PART 12: RPC — get completed manifests for history tab
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_completed_manifests(p_operator_id UUID)
RETURNS TABLE (
  external_load_id VARCHAR(100),
  retailer_name VARCHAR(50),
  order_count BIGINT,
  package_count BIGINT,
  manifest_id UUID,
  completed_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.external_load_id,
    m.retailer_name,
    m.total_orders::BIGINT AS order_count,
    m.total_packages::BIGINT AS package_count,
    m.id AS manifest_id,
    m.completed_at
  FROM public.manifests m
  WHERE m.operator_id = p_operator_id
    AND m.status = 'completed'
    AND m.deleted_at IS NULL
  ORDER BY m.completed_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_completed_manifests TO authenticated;

-- ============================================================================
-- PART 13: Validation
-- ============================================================================

DO $$
BEGIN
  -- Verify tables exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'manifests' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'manifests table not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pickup_scans' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'pickup_scans table not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'discrepancy_notes' AND table_schema = 'public') THEN
    RAISE EXCEPTION 'discrepancy_notes table not created!';
  END IF;

  -- Verify RLS enabled
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'manifests' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS not enabled on manifests!';
  END IF;

  RAISE NOTICE '✓ Story 4.1 migration complete — pickup verification tables created';
  RAISE NOTICE '  - manifests: pickup sessions with signature storage';
  RAISE NOTICE '  - pickup_scans: barcode scan events with validation results';
  RAISE NOTICE '  - discrepancy_notes: crew notes for missing packages';
  RAISE NOTICE '  - RLS, audit triggers, updated_at triggers, indexes all configured';
  RAISE NOTICE '  - RPC functions: get_unconsumed_manifests, get_completed_manifests';
END $$;
```

- [ ] **Step 2: Regenerate Supabase types**

Run: `cd apps/frontend && npx supabase gen types typescript --local > src/lib/types.ts`
Expected: Updated types include manifests, pickup_scans, discrepancy_notes

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/supabase/migrations/20260311000002_create_pickup_tables.sql apps/frontend/src/lib/types.ts
git commit -m "feat(4.1): create manifests, pickup_scans, discrepancy_notes tables with RLS"
```

---

## Chunk 3: Manifest List Screen (Story 4.2)

> **Task ordering:** Tasks 4-6 must be committed together or hooks (Task 6) before pages (Task 5), since the page imports hooks. When implementing, complete Task 6 before Task 5.

### Task 4: Create pickup layout with permission guard

**Files:**
- Create: `apps/frontend/src/app/pickup/layout.tsx`

- [ ] **Step 1: Create the pickup layout**

```typescript
import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/types/auth.types';

export default async function PickupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSSRClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    redirect('/auth/login');
  }

  const permissions = session.user?.app_metadata?.claims?.permissions ?? [];

  if (!hasPermission(permissions, 'pickup')) {
    redirect('/app/dashboard');
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/pickup/layout.tsx
git commit -m "feat(4.2): add pickup route layout with permission guard"
```

---

### Task 5: Build manifest list page and components

**Files:**
- Create: `apps/frontend/src/app/pickup/page.tsx`
- Create: `apps/frontend/src/components/pickup/ManifestCard.tsx`
- Create: `apps/frontend/src/components/pickup/ManifestTabs.tsx`

- [ ] **Step 1: Write ManifestCard component**

```typescript
// apps/frontend/src/components/pickup/ManifestCard.tsx
'use client';

import { Package, MapPin, Clock } from 'lucide-react';

interface ManifestCardProps {
  externalLoadId: string;
  retailerName: string | null;
  orderCount: number;
  packageCount: number;
  status?: 'pending' | 'in_progress' | null;
  onClick: () => void;
}

export default function ManifestCard({
  externalLoadId,
  retailerName,
  orderCount,
  packageCount,
  status,
  onClick,
}: ManifestCardProps) {
  const statusLabel = status === 'in_progress' ? 'In Progress' : 'Available';
  const statusColor = status === 'in_progress'
    ? 'text-yellow-700 bg-yellow-50'
    : 'text-green-700 bg-green-50';

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white rounded-xl p-5 border-2 border-slate-200 hover:border-primary-400 hover:shadow-md transition-all active:scale-[0.98]"
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 bg-primary-50 rounded-lg flex items-center justify-center">
          <Package className="w-6 h-6 text-primary-600" />
        </div>
        <div className="flex-1">
          <div className="text-lg font-bold text-slate-900">
            {retailerName || externalLoadId}
          </div>
          <div className="text-sm text-slate-500">{externalLoadId}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-primary-600">{packageCount}</div>
          <div className="text-xs text-slate-500">packages</div>
        </div>
      </div>
      <div className="flex items-center gap-4 pt-3 border-t border-slate-100">
        <span className="text-sm text-slate-500">{orderCount} orders</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor}`}>
          {statusLabel}
        </span>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Write ManifestTabs component**

```typescript
// apps/frontend/src/components/pickup/ManifestTabs.tsx
'use client';

interface ManifestTabsProps {
  activeTab: 'active' | 'completed';
  onTabChange: (tab: 'active' | 'completed') => void;
  activeCount: number;
  completedCount: number;
}

export default function ManifestTabs({
  activeTab,
  onTabChange,
  activeCount,
  completedCount,
}: ManifestTabsProps) {
  return (
    <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
      <button
        onClick={() => onTabChange('active')}
        className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors ${
          activeTab === 'active'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        Active ({activeCount})
      </button>
      <button
        onClick={() => onTabChange('completed')}
        className={`flex-1 py-2 px-4 text-sm font-medium rounded-md transition-colors ${
          activeTab === 'completed'
            ? 'bg-white text-slate-900 shadow-sm'
            : 'text-slate-500 hover:text-slate-700'
        }`}
      >
        Completed ({completedCount})
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write the manifest list page**

```typescript
// apps/frontend/src/app/pickup/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package } from 'lucide-react';
import ManifestCard from '@/components/pickup/ManifestCard';
import ManifestTabs from '@/components/pickup/ManifestTabs';
import { useUnconsumedManifests, useCompletedManifests } from '@/hooks/pickup/useManifests';

export default function PickupPage() {
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  const router = useRouter();
  const { data: activeManifests, isLoading: loadingActive } = useUnconsumedManifests();
  const { data: completedManifests, isLoading: loadingCompleted } = useCompletedManifests();

  const handleManifestClick = (externalLoadId: string) => {
    router.push(`/pickup/scan/${encodeURIComponent(externalLoadId)}`);
  };

  const isLoading = activeTab === 'active' ? loadingActive : loadingCompleted;
  const manifests = activeTab === 'active' ? activeManifests : completedManifests;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Pickups</h1>
      <p className="text-sm text-slate-500 mb-6">
        Select a manifest to start verification
      </p>

      <ManifestTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeCount={activeManifests?.length ?? 0}
        completedCount={completedManifests?.length ?? 0}
      />

      <div className="mt-4 space-y-3">
        {isLoading && (
          <div className="text-center py-12 text-slate-400">Loading...</div>
        )}

        {!isLoading && (!manifests || manifests.length === 0) && (
          <div className="text-center py-12">
            <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">
              {activeTab === 'active'
                ? 'No pending pickups'
                : 'No completed pickups yet'}
            </p>
          </div>
        )}

        {manifests?.map((m) => (
          <ManifestCard
            key={m.external_load_id}
            externalLoadId={m.external_load_id}
            retailerName={m.retailer_name}
            orderCount={Number(m.order_count)}
            packageCount={Number(m.package_count)}
            status={activeTab === 'active' ? m.manifest_status : undefined}
            onClick={() => activeTab === 'active'
              ? handleManifestClick(m.external_load_id)
              : router.push(`/pickup/review/${encodeURIComponent(m.external_load_id)}`)
            }
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/pickup/page.tsx apps/frontend/src/components/pickup/ManifestCard.tsx apps/frontend/src/components/pickup/ManifestTabs.tsx
git commit -m "feat(4.2): build manifest list page with active/completed tabs"
```

---

### Task 6: Create useManifests hooks with tests

**Files:**
- Create: `apps/frontend/src/hooks/pickup/useManifests.ts`
- Create: `apps/frontend/src/hooks/pickup/useManifests.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/frontend/src/hooks/pickup/useManifests.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useUnconsumedManifests } from './useManifests';

const mockRpc = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    auth: { getSession: mockGetSession },
    rpc: mockRpc,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useUnconsumedManifests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: { session: { user: { app_metadata: { claims: { operator_id: 'op-1' } } } } },
    });
  });

  it('fetches unconsumed manifests via RPC', async () => {
    const mockData = [
      { external_load_id: 'CARGA-001', retailer_name: 'Falabella', order_count: 10, package_count: 15, manifest_id: null, manifest_status: null },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(() => useUnconsumedManifests(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_unconsumed_manifests', { p_operator_id: 'op-1' });
  });

  it('returns empty array when no manifests', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useUnconsumedManifests(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/hooks/pickup/useManifests.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the hook**

```typescript
// apps/frontend/src/hooks/pickup/useManifests.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { createSPAClient } from '@/lib/supabase/client';

function useOperatorId() {
  const [operatorId, setOperatorId] = useState<string | null>(null);
  useEffect(() => {
    createSPAClient().auth.getSession().then(({ data: { session } }) => {
      setOperatorId(session?.user?.app_metadata?.claims?.operator_id ?? null);
    });
  }, []);
  return operatorId;
}

export function useUnconsumedManifests() {
  const operatorId = useOperatorId();

  return useQuery({
    queryKey: ['pickup', 'manifests', 'active', operatorId],
    queryFn: async () => {
      const { data, error } = await createSPAClient().rpc('get_unconsumed_manifests', {
        p_operator_id: operatorId!,
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!operatorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useCompletedManifests() {
  const operatorId = useOperatorId();

  return useQuery({
    queryKey: ['pickup', 'manifests', 'completed', operatorId],
    queryFn: async () => {
      const { data, error } = await createSPAClient().rpc('get_completed_manifests', {
        p_operator_id: operatorId!,
      });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!operatorId,
    staleTime: 30_000,
  });
}

/**
 * Fetches manifest by loadId. Does NOT upsert — use useCreateManifest for that.
 */
export function useManifest(loadId: string) {
  const operatorId = useOperatorId();

  return useQuery({
    queryKey: ['pickup', 'manifest', loadId, operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('manifests')
        .select('*')
        .eq('operator_id', operatorId!)
        .eq('external_load_id', loadId)
        .is('deleted_at', null)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!operatorId && !!loadId,
  });
}

/**
 * Creates or resumes a manifest (upsert). Call once when entering scan page.
 */
export function useCreateManifest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ operatorId, loadId }: { operatorId: string; loadId: string }) => {
      const supabase = createSPAClient();

      // Upsert manifest
      const { data, error } = await supabase
        .from('manifests')
        .upsert(
          {
            operator_id: operatorId,
            external_load_id: loadId,
            status: 'in_progress',
            started_at: new Date().toISOString(),
          },
          { onConflict: 'operator_id,external_load_id', ignoreDuplicates: false }
        )
        .select()
        .single();

      if (error) throw error;

      // Compute totals if not set
      if (!data.total_orders || !data.total_packages) {
        const { count: orderCount } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('operator_id', operatorId)
          .eq('external_load_id', loadId)
          .is('deleted_at', null);

        const { count: packageCount } = await supabase
          .from('packages')
          .select('id', { count: 'exact', head: true })
          .eq('operator_id', operatorId)
          .is('deleted_at', null)
          .in('order_id',
            supabase
              .from('orders')
              .select('id')
              .eq('operator_id', operatorId)
              .eq('external_load_id', loadId)
              .is('deleted_at', null)
          );

        await supabase
          .from('manifests')
          .update({ total_orders: orderCount ?? 0, total_packages: packageCount ?? 0 })
          .eq('id', data.id);

        data.total_orders = orderCount ?? 0;
        data.total_packages = packageCount ?? 0;
      }

      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['pickup', 'manifest', variables.loadId] });
      queryClient.invalidateQueries({ queryKey: ['pickup', 'manifests'] });
    },
  });
}

/**
 * Fetches all packages for a given external_load_id (manifest).
 */
export function useManifestPackages(loadId: string) {
  const operatorId = useOperatorId();

  return useQuery({
    queryKey: ['pickup', 'packages', loadId, operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('packages')
        .select('id, label, order_id, orders!inner(order_number, external_load_id)')
        .eq('operator_id', operatorId!)
        .eq('orders.external_load_id', loadId)
        .is('deleted_at', null);

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!operatorId && !!loadId,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/hooks/pickup/useManifests.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/pickup/useManifests.ts apps/frontend/src/hooks/pickup/useManifests.test.ts
git commit -m "feat(4.2): add useManifests hooks for manifest list queries"
```

---

## Chunk 4: Scanning Screen (Stories 4.3, 4.4)

> **Task ordering:** Tasks 8-9 (hooks) must be completed before Task 7 (page), since the page imports the hooks. When implementing, complete Tasks 8 → 9 → 7.

### Task 7: Build scanning page and components

**Files:**
- Create: `apps/frontend/src/app/pickup/scan/[loadId]/page.tsx`
- Create: `apps/frontend/src/components/pickup/ScannerInput.tsx`
- Create: `apps/frontend/src/components/pickup/ProgressBar.tsx`
- Create: `apps/frontend/src/components/pickup/ScanHistoryList.tsx`
- Create: `apps/frontend/src/components/pickup/ScanResultPopup.tsx`

- [ ] **Step 1: Write ScannerInput component**

```typescript
// apps/frontend/src/components/pickup/ScannerInput.tsx
'use client';

import { useRef, useEffect } from 'react';
import { Radio } from 'lucide-react';

interface ScannerInputProps {
  onScan: (barcode: string) => void;
  disabled?: boolean;
}

export default function ScannerInput({ onScan, disabled }: ScannerInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep input focused at all times
  useEffect(() => {
    const refocus = () => {
      if (!disabled && inputRef.current) {
        inputRef.current.focus();
      }
    };
    refocus();
    const interval = setInterval(refocus, 1000);
    return () => clearInterval(interval);
  }, [disabled]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = inputRef.current?.value.trim();
      if (value) {
        onScan(value);
        if (inputRef.current) inputRef.current.value = '';
      }
    }
  };

  return (
    <div className="px-4 py-3 bg-amber-50 border-b border-amber-200">
      <div className="flex items-center gap-2">
        <Radio className="w-5 h-5 text-amber-600" />
        <input
          ref={inputRef}
          type="text"
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Waiting for scanner..."
          className="flex-1 bg-white border-2 border-primary-400 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
          autoComplete="off"
          autoFocus
        />
      </div>
      <p className="text-xs text-amber-700 text-center mt-1">
        Scanner input auto-focused · Press Enter after scan
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write ProgressBar component**

```typescript
// apps/frontend/src/components/pickup/ProgressBar.tsx
'use client';

interface ProgressBarProps {
  scanned: number;
  total: number;
  verified: number;
  errors: number;
  elapsedSeconds: number;
}

export default function ProgressBar({
  scanned,
  total,
  verified,
  errors,
  elapsedSeconds,
}: ProgressBarProps) {
  const percentage = total > 0 ? (scanned / total) * 100 : 0;
  const barColor = percentage >= 90 ? 'from-green-400 to-green-500'
    : percentage >= 50 ? 'from-yellow-400 to-amber-500'
    : 'from-red-400 to-red-500';

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className="bg-white p-4 border-b-2 border-slate-200">
      <div className="flex justify-between items-baseline mb-2">
        <span className="text-3xl font-extrabold text-slate-900">
          {scanned} <span className="text-base text-slate-400 font-normal">/ {total}</span>
        </span>
        <span className="text-sm font-semibold text-slate-600">
          {percentage.toFixed(1)}%
        </span>
      </div>
      <div className="bg-slate-200 h-3 rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-300`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <div className="flex justify-between mt-2 text-xs text-slate-500">
        <span>✓ {verified} verified</span>
        <span>✗ {errors} not found</span>
        <span>⏱ {timeStr}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write ScanHistoryList component**

```typescript
// apps/frontend/src/components/pickup/ScanHistoryList.tsx
'use client';

import { CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

export interface ScanEntry {
  id: string;
  barcode: string;
  result: 'verified' | 'not_found' | 'duplicate';
  orderNumber?: string;
  scannedAt: Date;
}

interface ScanHistoryListProps {
  scans: ScanEntry[];
  maxItems?: number;
}

export default function ScanHistoryList({ scans, maxItems = 5 }: ScanHistoryListProps) {
  const visible = scans.slice(0, maxItems);

  const getIcon = (result: ScanEntry['result']) => {
    switch (result) {
      case 'verified':
        return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'not_found':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'duplicate':
        return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
    }
  };

  const getMessage = (entry: ScanEntry) => {
    switch (entry.result) {
      case 'verified':
        return entry.orderNumber ? `Order #${entry.orderNumber}` : 'Verified';
      case 'not_found':
        return 'Package not included';
      case 'duplicate':
        return 'Already scanned';
    }
  };

  const getTimeAgo = (date: Date) => {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
  };

  const getBgColor = (result: ScanEntry['result']) => {
    switch (result) {
      case 'verified': return 'bg-white border-slate-200';
      case 'not_found': return 'bg-red-50 border-red-200';
      case 'duplicate': return 'bg-yellow-50 border-yellow-200';
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="text-xs font-semibold text-slate-400 mb-2 uppercase">
        Recent Scans
      </div>
      <div className="space-y-1.5">
        {visible.map((entry) => (
          <div
            key={entry.id}
            className={`flex items-center gap-2 rounded-lg border p-2.5 ${getBgColor(entry.result)}`}
          >
            {getIcon(entry.result)}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate">{entry.barcode}</div>
              <div className="text-xs text-slate-500">{getMessage(entry)}</div>
            </div>
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {getTimeAgo(entry.scannedAt)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write ScanResultPopup component**

```typescript
// apps/frontend/src/components/pickup/ScanResultPopup.tsx
'use client';

import { useEffect } from 'react';

interface ScanResultPopupProps {
  barcode: string;
  isOpen: boolean;
  onDismiss: () => void;
  autoCloseMs?: number;
}

export default function ScanResultPopup({
  barcode,
  isOpen,
  onDismiss,
  autoCloseMs = 5000,
}: ScanResultPopupProps) {
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(onDismiss, autoCloseMs);
    return () => clearTimeout(timer);
  }, [isOpen, onDismiss, autoCloseMs]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6"
      onClick={onDismiss}
    >
      <div
        className="bg-white rounded-2xl p-8 text-center w-full max-w-sm border-3 border-red-600"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-6xl mb-3">❌</div>
        <div className="text-xl font-extrabold text-red-600 mb-2">
          Package Not Included
        </div>
        <div className="text-lg font-semibold font-mono bg-slate-100 rounded-lg py-2 px-4 mb-1">
          {barcode}
        </div>
        <p className="text-sm text-slate-500 mb-5">
          This barcode is not in the manifest.<br />It has been logged for review.
        </p>
        <button
          onClick={onDismiss}
          className="px-8 py-3 bg-red-600 text-white rounded-lg font-bold text-sm"
        >
          Dismiss
        </button>
        <p className="text-xs text-slate-400 mt-2">
          Auto-dismisses in {autoCloseMs / 1000} seconds
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write the scanning page**

```typescript
// apps/frontend/src/app/pickup/scan/[loadId]/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Settings } from 'lucide-react';
import ScannerInput from '@/components/pickup/ScannerInput';
import ProgressBar from '@/components/pickup/ProgressBar';
import ScanHistoryList, { type ScanEntry } from '@/components/pickup/ScanHistoryList';
import ScanResultPopup from '@/components/pickup/ScanResultPopup';
import { useManifest, useCreateManifest, useManifestPackages } from '@/hooks/pickup/useManifests';
import { useSubmitScan } from '@/hooks/pickup/usePickupScans';
import { useFeedback } from '@/hooks/pickup/useFeedback';
import { createSPAClient } from '@/lib/supabase/client';

export default function ScanningPage() {
  const params = useParams<{ loadId: string }>();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId);

  const [scanHistory, setScanHistory] = useState<ScanEntry[]>([]);
  const [errorPopup, setErrorPopup] = useState<{ barcode: string } | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const { data: manifest } = useManifest(loadId);
  const createManifest = useCreateManifest();
  const { data: packages } = useManifestPackages(loadId);

  // Create/resume manifest on first visit
  useEffect(() => {
    if (!manifest && createManifest.isIdle) {
      const supabase = createSPAClient();
      supabase.auth.getSession().then(({ data: { session } }) => {
        const operatorId = session?.user?.app_metadata?.claims?.operator_id;
        if (operatorId) {
          createManifest.mutate({ operatorId, loadId });
        }
      });
    }
  }, [manifest, loadId, createManifest]);
  const submitScan = useSubmitScan();
  const { playSuccess, playError, playDuplicate } = useFeedback();

  // Timer
  useEffect(() => {
    if (!startTime) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const verifiedCount = scanHistory.filter((s) => s.result === 'verified').length;
  const errorCount = scanHistory.filter((s) => s.result === 'not_found').length;
  const totalPackages = packages?.length ?? 0;

  const handleScan = useCallback(async (barcode: string) => {
    if (!startTime) setStartTime(Date.now());

    try {
      const result = await submitScan.mutateAsync({
        manifestLoadId: loadId,
        barcode,
      });

      const entry: ScanEntry = {
        id: result.id,
        barcode,
        result: result.scan_result,
        orderNumber: result.order_number,
        scannedAt: new Date(),
      };

      setScanHistory((prev) => [entry, ...prev]);

      switch (result.scan_result) {
        case 'verified':
          playSuccess();
          break;
        case 'not_found':
          playError();
          setErrorPopup({ barcode });
          break;
        case 'duplicate':
          playDuplicate();
          break;
      }
    } catch (err) {
      console.error('Scan failed:', err);
    }
  }, [loadId, startTime, submitScan, playSuccess, playError, playDuplicate]);

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white px-4 py-3 border-b-2 border-slate-200 flex items-center gap-2">
        <button onClick={() => router.push('/pickup')} className="text-slate-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 text-center">
          <div className="font-bold text-sm">
            {manifest?.retailer_name ?? loadId}
          </div>
          <div className="text-xs text-slate-500">
            {manifest?.total_orders ?? '—'} orders · {totalPackages} packages
          </div>
        </div>
        <Settings className="w-5 h-5 text-slate-400" />
      </div>

      {/* Progress */}
      <ProgressBar
        scanned={verifiedCount}
        total={totalPackages}
        verified={verifiedCount}
        errors={errorCount}
        elapsedSeconds={elapsed}
      />

      {/* Scanner input */}
      <ScannerInput onScan={handleScan} />

      {/* Scan history */}
      <div className="flex-1 overflow-y-auto">
        <ScanHistoryList scans={scanHistory} />
      </div>

      {/* Complete button */}
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
        <button
          onClick={() => router.push(`/pickup/review/${encodeURIComponent(loadId)}`)}
          className="w-full py-3.5 bg-primary-500 text-slate-900 rounded-xl font-bold text-sm"
        >
          Complete Pickup →
        </button>
      </div>

      {/* Error popup */}
      <ScanResultPopup
        barcode={errorPopup?.barcode ?? ''}
        isOpen={!!errorPopup}
        onDismiss={() => setErrorPopup(null)}
      />
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/pickup/scan/ apps/frontend/src/components/pickup/ScannerInput.tsx apps/frontend/src/components/pickup/ProgressBar.tsx apps/frontend/src/components/pickup/ScanHistoryList.tsx apps/frontend/src/components/pickup/ScanResultPopup.tsx
git commit -m "feat(4.3): build scanning page with scanner input, progress bar, and scan history"
```

---

### Task 8: Create scan validation logic and hooks

**Files:**
- Create: `apps/frontend/src/lib/pickup/scan-validator.ts`
- Create: `apps/frontend/src/lib/pickup/scan-validator.test.ts`
- Create: `apps/frontend/src/hooks/pickup/usePickupScans.ts`
- Create: `apps/frontend/src/hooks/pickup/usePickupScans.test.ts`

- [ ] **Step 1: Write failing test for scan-validator**

```typescript
// apps/frontend/src/lib/pickup/scan-validator.test.ts
import { describe, it, expect } from 'vitest';
import { determineScanResult } from './scan-validator';

const mockPackages = [
  { id: 'pkg-1', label: 'CTN-001', order_id: 'ord-1' },
  { id: 'pkg-2', label: 'CTN-002', order_id: 'ord-1' },
  { id: 'pkg-3', label: 'CTN-003', order_id: 'ord-2' },
];

const mockOrders = [
  { id: 'ord-1', order_number: 'FA-001' },
  { id: 'ord-2', order_number: 'FA-002' },
];

describe('determineScanResult', () => {
  it('returns verified when barcode matches package label', () => {
    const result = determineScanResult('CTN-001', mockPackages, mockOrders, []);
    expect(result).toEqual({
      scan_result: 'verified',
      package_id: 'pkg-1',
      matched_packages: ['pkg-1'],
    });
  });

  it('returns duplicate when barcode already scanned', () => {
    const existingScans = [{ barcode_scanned: 'CTN-001', scan_result: 'verified' as const }];
    const result = determineScanResult('CTN-001', mockPackages, mockOrders, existingScans);
    expect(result.scan_result).toBe('duplicate');
  });

  it('returns verified for all packages when barcode matches order_number', () => {
    const result = determineScanResult('FA-001', mockPackages, mockOrders, []);
    expect(result.scan_result).toBe('verified');
    expect(result.matched_packages).toEqual(['pkg-1', 'pkg-2']);
  });

  it('returns not_found when barcode matches nothing', () => {
    const result = determineScanResult('UNKNOWN-999', mockPackages, mockOrders, []);
    expect(result).toEqual({
      scan_result: 'not_found',
      package_id: null,
      matched_packages: [],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/lib/pickup/scan-validator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement scan-validator**

```typescript
// apps/frontend/src/lib/pickup/scan-validator.ts

interface PackageInfo {
  id: string;
  label: string;
  order_id: string;
}

interface OrderInfo {
  id: string;
  order_number: string;
}

interface ExistingScan {
  barcode_scanned: string;
  scan_result: 'verified' | 'not_found' | 'duplicate';
}

export interface ScanResult {
  scan_result: 'verified' | 'not_found' | 'duplicate';
  package_id: string | null;
  matched_packages: string[];
}

export function determineScanResult(
  barcode: string,
  packages: PackageInfo[],
  orders: OrderInfo[],
  existingScans: ExistingScan[]
): ScanResult {
  // Step 1: Check for duplicate
  const alreadyScanned = existingScans.some(
    (s) => s.barcode_scanned === barcode && s.scan_result === 'verified'
  );
  if (alreadyScanned) {
    return { scan_result: 'duplicate', package_id: null, matched_packages: [] };
  }

  // Step 2: Match by package label
  const matchedPackage = packages.find((p) => p.label === barcode);
  if (matchedPackage) {
    return {
      scan_result: 'verified',
      package_id: matchedPackage.id,
      matched_packages: [matchedPackage.id],
    };
  }

  // Step 3: Match by order number
  const matchedOrder = orders.find((o) => o.order_number === barcode);
  if (matchedOrder) {
    const orderPackages = packages
      .filter((p) => p.order_id === matchedOrder.id)
      .map((p) => p.id);
    return {
      scan_result: 'verified',
      package_id: orderPackages[0] ?? null,
      matched_packages: orderPackages,
    };
  }

  // Step 4: Not found
  return { scan_result: 'not_found', package_id: null, matched_packages: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/lib/pickup/scan-validator.test.ts`
Expected: PASS — all 4 tests pass

- [ ] **Step 5: Write usePickupScans hook**

```typescript
// apps/frontend/src/hooks/pickup/usePickupScans.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

interface SubmitScanInput {
  manifestLoadId: string;
  barcode: string;
}

interface ScanResponse {
  id: string;
  scan_result: 'verified' | 'not_found' | 'duplicate';
  package_id: string | null;
  order_number: string | null;
}

export function useSubmitScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ manifestLoadId, barcode }: SubmitScanInput): Promise<ScanResponse> => {
      const supabase = createSPAClient();
      const { data: { session } } = await supabase.auth.getSession();
      const claims = session?.user?.app_metadata?.claims;
      const operatorId = claims?.operator_id;

      if (!operatorId) throw new Error('No operator ID in session');

      // Get or create manifest
      const { data: manifest, error: mErr } = await supabase
        .from('manifests')
        .upsert(
          { operator_id: operatorId, external_load_id: manifestLoadId, status: 'in_progress' },
          { onConflict: 'operator_id,external_load_id' }
        )
        .select('id')
        .single();

      if (mErr) throw mErr;

      // Get packages for this manifest's orders
      const { data: packages } = await supabase
        .from('packages')
        .select('id, label, order_id')
        .eq('operator_id', operatorId)
        .is('deleted_at', null)
        .in('order_id',
          supabase
            .from('orders')
            .select('id')
            .eq('operator_id', operatorId)
            .eq('external_load_id', manifestLoadId)
            .is('deleted_at', null)
        );

      // Get existing scans for duplicate check
      const { data: existingScans } = await supabase
        .from('pickup_scans')
        .select('barcode_scanned, scan_result')
        .eq('manifest_id', manifest.id)
        .is('deleted_at', null);

      // Get orders for order_number fallback
      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_number')
        .eq('operator_id', operatorId)
        .eq('external_load_id', manifestLoadId)
        .is('deleted_at', null);

      // Validate
      const { determineScanResult } = await import('@/lib/pickup/scan-validator');
      const result = determineScanResult(
        barcode,
        packages ?? [],
        orders ?? [],
        existingScans ?? []
      );

      // Insert scan record(s)
      if (result.scan_result === 'verified' && result.matched_packages.length > 1) {
        // Order-level match — insert a scan for each package
        const scans = result.matched_packages.map((pkgId) => ({
          operator_id: operatorId,
          manifest_id: manifest.id,
          package_id: pkgId,
          barcode_scanned: barcode,
          scan_result: 'verified' as const,
          scanned_by_user_id: session?.user?.id,
          scanned_at: new Date().toISOString(),
        }));

        const { error: scanErr } = await supabase.from('pickup_scans').insert(scans);
        if (scanErr) throw scanErr;
      } else {
        // Single scan
        const { error: scanErr } = await supabase.from('pickup_scans').insert({
          operator_id: operatorId,
          manifest_id: manifest.id,
          package_id: result.package_id,
          barcode_scanned: barcode,
          scan_result: result.scan_result,
          scanned_by_user_id: session?.user?.id,
          scanned_at: new Date().toISOString(),
        });
        if (scanErr) throw scanErr;
      }

      // Find order_number for display
      let orderNumber: string | null = null;
      if (result.package_id) {
        const pkg = (packages ?? []).find((p) => p.id === result.package_id);
        if (pkg) {
          const order = (orders ?? []).find((o) => o.id === pkg.order_id);
          orderNumber = order?.order_number ?? null;
        }
      }

      return {
        id: crypto.randomUUID(),
        scan_result: result.scan_result,
        package_id: result.package_id,
        order_number: orderNumber,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup', 'scans'] });
    },
  });
}
```

- [ ] **Step 6: Write usePickupScans test**

```typescript
// apps/frontend/src/hooks/pickup/usePickupScans.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { determineScanResult } from '@/lib/pickup/scan-validator';

// Test the core validation logic (hook integration tested via E2E)
describe('usePickupScans - validation logic', () => {
  it('handles rapid sequential scans without double-counting', () => {
    const packages = [
      { id: 'p1', label: 'CTN-001', order_id: 'o1' },
      { id: 'p2', label: 'CTN-002', order_id: 'o1' },
    ];
    const orders = [{ id: 'o1', order_number: 'ORD-1' }];

    // First scan
    const r1 = determineScanResult('CTN-001', packages, orders, []);
    expect(r1.scan_result).toBe('verified');

    // Second scan of same barcode (simulating existing scans)
    const r2 = determineScanResult('CTN-001', packages, orders, [
      { barcode_scanned: 'CTN-001', scan_result: 'verified' },
    ]);
    expect(r2.scan_result).toBe('duplicate');
  });
});
```

- [ ] **Step 7: Run tests**

Run: `cd apps/frontend && npx vitest run src/lib/pickup/ src/hooks/pickup/usePickupScans.test.ts`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/lib/pickup/ apps/frontend/src/hooks/pickup/usePickupScans.ts apps/frontend/src/hooks/pickup/usePickupScans.test.ts
git commit -m "feat(4.3): add scan validation logic and usePickupScans mutation hook"
```

---

### Task 9: Implement audio/haptic feedback system

**Files:**
- Create: `apps/frontend/src/lib/pickup/audio.ts`
- Create: `apps/frontend/src/lib/pickup/audio.test.ts`
- Create: `apps/frontend/src/hooks/pickup/useFeedback.ts`
- Create: `apps/frontend/src/hooks/pickup/useFeedback.test.ts`

- [ ] **Step 1: Write failing test for audio module**

```typescript
// apps/frontend/src/lib/pickup/audio.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { playBeep, playSuccessBeep, playErrorBeep, playDuplicateBeep } from './audio';

// Mock Web Audio API
const mockOscillator = { connect: vi.fn(), frequency: { value: 0 }, type: '', start: vi.fn(), stop: vi.fn() };
const mockGain = { connect: vi.fn(), gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };

const mockAudioContext = {
  createOscillator: vi.fn(() => mockOscillator),
  createGain: vi.fn(() => mockGain),
  destination: {},
  currentTime: 0,
};

vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));

describe('audio', () => {
  beforeEach(() => vi.clearAllMocks());

  it('playBeep creates oscillator with correct frequency', () => {
    playBeep(800, 150);
    expect(mockOscillator.frequency.value).toBe(800);
  });

  it('playSuccessBeep plays single 800Hz beep', () => {
    playSuccessBeep();
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(1);
    expect(mockOscillator.frequency.value).toBe(800);
  });

  it('playErrorBeep plays three 400Hz beeps', () => {
    playErrorBeep();
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(3);
    expect(mockOscillator.frequency.value).toBe(400);
  });

  it('playDuplicateBeep plays two 600Hz beeps', () => {
    playDuplicateBeep();
    expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(2);
    expect(mockOscillator.frequency.value).toBe(600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/lib/pickup/audio.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement audio module**

```typescript
// apps/frontend/src/lib/pickup/audio.ts

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function playBeep(frequency: number, durationMs: number, delayMs = 0): void {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';

    const startTime = ctx.currentTime + delayMs / 1000;
    const endTime = startTime + durationMs / 1000;

    gain.gain.setValueAtTime(0.3, startTime);
    gain.gain.exponentialRampToValueAtTime(0.01, endTime);

    oscillator.start(startTime);
    oscillator.stop(endTime);
  } catch {
    // Audio not supported — fail silently
  }
}

export function playSuccessBeep(): void {
  playBeep(800, 150);
}

export function playErrorBeep(): void {
  playBeep(400, 200, 0);
  playBeep(400, 200, 300);
  playBeep(400, 200, 600);
}

export function playDuplicateBeep(): void {
  playBeep(600, 200, 0);
  playBeep(600, 200, 300);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/lib/pickup/audio.test.ts`
Expected: PASS

- [ ] **Step 5: Write useFeedback hook**

```typescript
// apps/frontend/src/hooks/pickup/useFeedback.ts
import { useCallback } from 'react';
import { playSuccessBeep, playErrorBeep, playDuplicateBeep } from '@/lib/pickup/audio';

function vibrate(pattern: number[]): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Vibration not supported
  }
}

export function useFeedback() {
  const playSuccess = useCallback(() => {
    playSuccessBeep();
    vibrate([100]);
  }, []);

  const playError = useCallback(() => {
    playErrorBeep();
    vibrate([100, 100, 100, 100, 100]);
  }, []);

  const playDuplicate = useCallback(() => {
    playDuplicateBeep();
    vibrate([100, 100, 100]);
  }, []);

  return { playSuccess, playError, playDuplicate };
}
```

- [ ] **Step 6: Write useFeedback test**

```typescript
// apps/frontend/src/hooks/pickup/useFeedback.test.ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFeedback } from './useFeedback';

vi.mock('@/lib/pickup/audio', () => ({
  playSuccessBeep: vi.fn(),
  playErrorBeep: vi.fn(),
  playDuplicateBeep: vi.fn(),
}));

vi.stubGlobal('navigator', { vibrate: vi.fn() });

describe('useFeedback', () => {
  it('returns playSuccess, playError, playDuplicate functions', () => {
    const { result } = renderHook(() => useFeedback());
    expect(typeof result.current.playSuccess).toBe('function');
    expect(typeof result.current.playError).toBe('function');
    expect(typeof result.current.playDuplicate).toBe('function');
  });
});
```

- [ ] **Step 7: Run tests**

Run: `cd apps/frontend && npx vitest run src/lib/pickup/audio.test.ts src/hooks/pickup/useFeedback.test.ts`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/lib/pickup/audio.ts apps/frontend/src/lib/pickup/audio.test.ts apps/frontend/src/hooks/pickup/useFeedback.ts apps/frontend/src/hooks/pickup/useFeedback.test.ts
git commit -m "feat(4.4): implement audio/haptic feedback for scan results"
```

---

## Chunk 5: Discrepancy Review & Completion (Stories 4.7a, 4.7b)

### Task 10: Build discrepancy review page

**Files:**
- Create: `apps/frontend/src/app/pickup/review/[loadId]/page.tsx`
- Create: `apps/frontend/src/components/pickup/DiscrepancyItem.tsx`
- Create: `apps/frontend/src/hooks/pickup/useDiscrepancies.ts`
- Create: `apps/frontend/src/hooks/pickup/useDiscrepancies.test.ts`

- [ ] **Step 1: Write DiscrepancyItem component**

```typescript
// apps/frontend/src/components/pickup/DiscrepancyItem.tsx
'use client';

import { CheckCircle2, AlertTriangle } from 'lucide-react';

interface DiscrepancyItemProps {
  packageLabel: string;
  orderNumber?: string;
  note: string;
  onNoteChange: (note: string) => void;
}

export default function DiscrepancyItem({
  packageLabel,
  orderNumber,
  note,
  onNoteChange,
}: DiscrepancyItemProps) {
  const hasNote = note.trim().length > 0;

  return (
    <div
      className={`bg-white rounded-lg border-2 p-3 ${
        hasNote ? 'border-slate-200' : 'border-red-500'
      }`}
    >
      <div className="flex justify-between items-center mb-2">
        <div>
          <span className="font-bold text-sm">{packageLabel}</span>
          {orderNumber && (
            <span className="text-xs text-slate-500 ml-2">Order #{orderNumber}</span>
          )}
        </div>
        {hasNote ? (
          <span className="text-xs text-green-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> noted
          </span>
        ) : (
          <span className="text-xs text-red-600 font-semibold flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> note required
          </span>
        )}
      </div>
      {hasNote ? (
        <div className="bg-orange-50 border border-orange-200 rounded-md p-2 text-sm text-orange-900">
          &ldquo;{note}&rdquo;
        </div>
      ) : (
        <textarea
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Why is this package missing?"
          className="w-full border border-slate-200 rounded-md p-2 text-sm min-h-[36px] resize-none focus:outline-none focus:ring-2 focus:ring-primary-300"
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write useDiscrepancies hook**

```typescript
// apps/frontend/src/hooks/pickup/useDiscrepancies.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export function useMissingPackages(manifestId: string | null, loadId: string) {
  return useQuery({
    queryKey: ['pickup', 'missing', manifestId, loadId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data: { session } } = await supabase.auth.getSession();
      const operatorId = session?.user?.app_metadata?.claims?.operator_id;

      // Get all packages for this manifest's orders
      const { data: allPackages } = await supabase
        .from('packages')
        .select('id, label, order_id, orders!inner(order_number)')
        .eq('operator_id', operatorId)
        .eq('orders.external_load_id', loadId)
        .is('deleted_at', null);

      // Get verified scans
      const { data: verifiedScans } = await supabase
        .from('pickup_scans')
        .select('package_id')
        .eq('manifest_id', manifestId!)
        .eq('scan_result', 'verified')
        .is('deleted_at', null);

      const scannedIds = new Set((verifiedScans ?? []).map((s) => s.package_id));

      // Missing = packages without a verified scan
      return (allPackages ?? [])
        .filter((p) => !scannedIds.has(p.id))
        .map((p) => ({
          id: p.id,
          label: p.label,
          orderNumber: (p.orders as { order_number: string })?.order_number,
        }));
    },
    enabled: !!manifestId,
  });
}

export function useNotFoundScans(manifestId: string | null) {
  return useQuery({
    queryKey: ['pickup', 'not-found', manifestId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data } = await supabase
        .from('pickup_scans')
        .select('barcode_scanned')
        .eq('manifest_id', manifestId!)
        .eq('scan_result', 'not_found')
        .is('deleted_at', null);
      return data ?? [];
    },
    enabled: !!manifestId,
  });
}

export function useSaveDiscrepancyNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      manifestId,
      packageId,
      note,
    }: {
      manifestId: string;
      packageId: string;
      note: string;
    }) => {
      const supabase = createSPAClient();
      const { data: { session } } = await supabase.auth.getSession();
      const operatorId = session?.user?.app_metadata?.claims?.operator_id;

      const { error } = await supabase.from('discrepancy_notes').upsert(
        {
          operator_id: operatorId,
          manifest_id: manifestId,
          package_id: packageId,
          note,
          created_by_user_id: session?.user?.id,
        },
        { onConflict: 'manifest_id,package_id' }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup', 'discrepancy-notes'] });
    },
  });
}
```

- [ ] **Step 3: Write useDiscrepancies test**

```typescript
// apps/frontend/src/hooks/pickup/useDiscrepancies.test.ts
import { describe, it, expect } from 'vitest';

describe('useDiscrepancies', () => {
  it('module exports expected hooks', async () => {
    const mod = await import('./useDiscrepancies');
    expect(typeof mod.useMissingPackages).toBe('function');
    expect(typeof mod.useNotFoundScans).toBe('function');
    expect(typeof mod.useSaveDiscrepancyNote).toBe('function');
  });
});
```

- [ ] **Step 4: Write the review page**

```typescript
// apps/frontend/src/app/pickup/review/[loadId]/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import DiscrepancyItem from '@/components/pickup/DiscrepancyItem';
import { useMissingPackages, useNotFoundScans, useSaveDiscrepancyNote } from '@/hooks/pickup/useDiscrepancies';
import { useManifest } from '@/hooks/pickup/useManifests';

export default function DiscrepancyReviewPage() {
  const params = useParams<{ loadId: string }>();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId);

  const { data: manifest } = useManifest(loadId);
  const { data: missingPackages } = useMissingPackages(manifest?.id ?? null, loadId);
  const { data: notFoundScans } = useNotFoundScans(manifest?.id ?? null);
  const saveNote = useSaveDiscrepancyNote();

  const [notes, setNotes] = useState<Record<string, string>>({});

  const allNotesProvided = (missingPackages ?? []).every(
    (pkg) => (notes[pkg.id] ?? '').trim().length > 0
  );

  const verifiedCount = (manifest?.total_packages ?? 0) - (missingPackages?.length ?? 0);
  const hasMissing = (missingPackages?.length ?? 0) > 0;

  const handleProceedToSign = async () => {
    // Save all notes
    if (manifest?.id) {
      for (const pkg of missingPackages ?? []) {
        const note = notes[pkg.id];
        if (note?.trim()) {
          await saveNote.mutateAsync({
            manifestId: manifest.id,
            packageId: pkg.id,
            note: note.trim(),
          });
        }
      }
    }
    router.push(`/pickup/complete/${encodeURIComponent(loadId)}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white px-4 py-3 border-b-2 border-slate-200 flex items-center gap-2">
        <button onClick={() => router.push(`/pickup/scan/${encodeURIComponent(loadId)}`)}>
          <ArrowLeft className="w-5 h-5 text-slate-500" />
        </button>
        <div className="flex-1 text-center">
          <div className="font-bold text-sm">Review — {loadId}</div>
          <div className="text-xs text-slate-500">{manifest?.retailer_name} · Before signing</div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="p-4 grid grid-cols-3 gap-2">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-extrabold text-green-600">{verifiedCount}</div>
          <div className="text-[10px] text-green-700">Verified</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-extrabold text-red-600">{missingPackages?.length ?? 0}</div>
          <div className="text-[10px] text-red-700">Missing</div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
          <div className="text-2xl font-extrabold text-yellow-600">{notFoundScans?.length ?? 0}</div>
          <div className="text-[10px] text-yellow-700">Not in manifest</div>
        </div>
      </div>

      {/* Missing packages */}
      {hasMissing && (
        <div className="px-4">
          <div className="text-xs font-bold text-red-600 mb-2 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            MISSING PACKAGES — Notes required
          </div>
          <div className="space-y-2">
            {missingPackages?.map((pkg) => (
              <DiscrepancyItem
                key={pkg.id}
                packageLabel={pkg.label}
                orderNumber={pkg.orderNumber}
                note={notes[pkg.id] ?? ''}
                onNoteChange={(note) => setNotes((prev) => ({ ...prev, [pkg.id]: note }))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Not in manifest scans */}
      {(notFoundScans?.length ?? 0) > 0 && (
        <div className="px-4 mt-4">
          <div className="text-xs font-semibold text-yellow-700 mb-2">
            SCANNED BUT NOT IN MANIFEST ({notFoundScans?.length})
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            {notFoundScans?.map((s) => s.barcode_scanned).join(' · ')} — Logged for review
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-4 mt-4 flex gap-2">
        <button
          onClick={() => router.push(`/pickup/scan/${encodeURIComponent(loadId)}`)}
          className="flex-1 py-3 bg-white text-slate-700 border-2 border-slate-300 rounded-xl font-semibold text-sm"
        >
          ← Back to Scanning
        </button>
        <button
          onClick={handleProceedToSign}
          disabled={hasMissing && !allNotesProvided}
          className={`flex-1 py-3 rounded-xl font-bold text-sm ${
            hasMissing && !allNotesProvided
              ? 'bg-slate-300 text-white cursor-not-allowed'
              : 'bg-primary-500 text-slate-900'
          }`}
        >
          Proceed to Sign →
        </button>
      </div>
      {hasMissing && !allNotesProvided && (
        <p className="text-center text-xs text-red-600 pb-4">
          All missing packages must have notes before signing
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/pickup/review/ apps/frontend/src/components/pickup/DiscrepancyItem.tsx apps/frontend/src/hooks/pickup/useDiscrepancies.ts apps/frontend/src/hooks/pickup/useDiscrepancies.test.ts
git commit -m "feat(4.7a): build discrepancy review page with required notes for missing packages"
```

---

### Task 11: Build signature and completion page

**Files:**
- Create: `apps/frontend/src/app/pickup/complete/[loadId]/page.tsx`
- Create: `apps/frontend/src/components/pickup/SignaturePad.tsx`

- [ ] **Step 1: Write SignaturePad component**

```typescript
// apps/frontend/src/components/pickup/SignaturePad.tsx
'use client';

import { useRef, useEffect, useCallback, useState } from 'react';

interface SignaturePadProps {
  onSignatureChange: (dataUrl: string | null) => void;
  width?: number;
  height?: number;
}

export default function SignaturePad({
  onSignatureChange,
  width = 300,
  height = 120,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  const getContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }
    return ctx;
  }, []);

  const getCoords = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    const ctx = getContext();
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = getContext();
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setHasSignature(true);
    const canvas = canvasRef.current;
    if (canvas) {
      onSignatureChange(canvas.toDataURL('image/png'));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasSignature(false);
    onSignatureChange(null);
  };

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full border-2 border-primary-400 rounded-lg bg-white touch-none"
          style={{ height }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {hasSignature && (
          <button
            onClick={clear}
            className="absolute top-1 right-1 bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the completion page**

```typescript
// apps/frontend/src/app/pickup/complete/[loadId]/page.tsx
'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import SignaturePad from '@/components/pickup/SignaturePad';
import { useManifest } from '@/hooks/pickup/useManifests';
import { useMissingPackages } from '@/hooks/pickup/useDiscrepancies';
import { createSPAClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

export default function CompletionPage() {
  const params = useParams<{ loadId: string }>();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId);

  const { data: manifest } = useManifest(loadId);
  const { data: missingPackages } = useMissingPackages(manifest?.id ?? null, loadId);

  const [operatorSig, setOperatorSig] = useState<string | null>(null);
  const [clientSig, setClientSig] = useState<string | null>(null);
  const [clientName, setClientName] = useState('');
  const [showClientSig, setShowClientSig] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const verifiedCount = (manifest?.total_packages ?? 0) - (missingPackages?.length ?? 0);
  const missingCount = missingPackages?.length ?? 0;
  const precision = manifest?.total_packages
    ? ((verifiedCount / manifest.total_packages) * 100).toFixed(1)
    : '0';

  const canComplete = !!operatorSig;

  const handleComplete = async () => {
    if (!manifest?.id || !operatorSig) return;
    setSubmitting(true);

    try {
      const supabase = createSPAClient();
      const { data: { session } } = await supabase.auth.getSession();

      // Tech debt: Signatures stored as base64 data URLs for now.
      // Epic 4B will upload to Supabase Storage and store URLs instead.
      // Tracked in spec: docs/plans/spec-01-epic4a-pickup-verification.md

      const { error } = await supabase
        .from('manifests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          signature_operator: operatorSig,
          signature_operator_name: session?.user?.user_metadata?.full_name ?? session?.user?.email ?? '',
          signature_client: clientSig,
          signature_client_name: clientName || null,
          total_orders: manifest.total_orders,
          total_packages: manifest.total_packages,
        })
        .eq('id', manifest.id);

      if (error) throw error;

      toast.success('Pickup completed successfully');
      router.push('/pickup');
    } catch (err) {
      toast.error('Failed to complete pickup');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white px-4 py-3 border-b-2 border-slate-200 flex items-center gap-2">
        <button onClick={() => router.push(`/pickup/review/${encodeURIComponent(loadId)}`)}>
          <ArrowLeft className="w-5 h-5 text-slate-500" />
        </button>
        <div className="flex-1 text-center">
          <div className="font-bold text-sm">Complete Pickup</div>
          <div className="text-xs text-slate-500">{manifest?.retailer_name} · {loadId}</div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="p-4 grid grid-cols-2 gap-2">
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-center">
          <div className="text-3xl font-extrabold text-green-600">{verifiedCount}</div>
          <div className="text-xs text-slate-500">Packages Verified</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-center">
          <div className="text-3xl font-extrabold text-red-600">{missingCount}</div>
          <div className="text-xs text-slate-500">Missing (noted)</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-center">
          <div className="text-3xl font-extrabold text-primary-600">{precision}%</div>
          <div className="text-xs text-slate-500">Precision</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3 text-center">
          <div className="text-3xl font-extrabold text-slate-900">—</div>
          <div className="text-xs text-slate-500">Time Elapsed</div>
        </div>
      </div>

      {/* Legal notice */}
      <div className="mx-4 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
        ⚖️ By signing below, the operator accepts custody and responsibility for all verified packages listed in this manifest.
      </div>

      {/* Operator signature */}
      <div className="p-4">
        <div className="text-xs font-bold text-slate-900 mb-1">OPERATOR SIGNATURE *</div>
        <SignaturePad onSignatureChange={setOperatorSig} />
        <div className="text-xs text-slate-500 mt-1">
          {manifest?.retailer_name} · Pickup Crew
        </div>
      </div>

      {/* Client signature (optional) */}
      <div className="px-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs font-bold text-slate-900">CLIENT SIGNATURE</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Optional</span>
            <button
              onClick={() => setShowClientSig(!showClientSig)}
              className={`w-9 h-5 rounded-full transition-colors ${
                showClientSig ? 'bg-primary-500' : 'bg-slate-300'
              } relative`}
            >
              <div
                className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${
                  showClientSig ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
        {showClientSig && (
          <>
            <SignaturePad onSignatureChange={setClientSig} height={80} />
            <input
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Client representative name"
              className="w-full mt-2 border border-slate-200 rounded-md px-2 py-1.5 text-sm"
            />
          </>
        )}
      </div>

      {/* Complete button */}
      <div className="p-4 mt-4">
        <button
          onClick={handleComplete}
          disabled={!canComplete || submitting}
          className={`w-full py-4 rounded-xl font-bold text-base ${
            canComplete && !submitting
              ? 'bg-green-600 text-white'
              : 'bg-slate-300 text-white cursor-not-allowed'
          }`}
        >
          {submitting ? 'Completing...' : '✓ Complete & Generate Receipt'}
        </button>
        <p className="text-center text-xs text-slate-500 mt-2">
          Receipt will be saved and available for download
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run all tests**

> **Note:** `useManifest`, `useCreateManifest`, and `useManifestPackages` hooks were already defined in Task 6 (Chunk 3). No additional hook code needed here.

Run: `cd apps/frontend && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/pickup/complete/ apps/frontend/src/app/pickup/review/ apps/frontend/src/components/pickup/SignaturePad.tsx apps/frontend/src/components/pickup/DiscrepancyItem.tsx apps/frontend/src/hooks/pickup/
git commit -m "feat(4.7): build discrepancy review and signature completion pages"
```

---

### Task 12: Final integration test and cleanup

**Files:**
- Verify all pages, hooks, and components work together

- [ ] **Step 1: Run full test suite**

Run: `cd apps/frontend && npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `cd apps/frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Run lint**

Run: `cd apps/frontend && npx next lint`
Expected: No errors

- [ ] **Step 4: Run build**

Run: `cd apps/frontend && npx next build`
Expected: Build succeeds

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(4A): address type/lint issues from integration"
```
