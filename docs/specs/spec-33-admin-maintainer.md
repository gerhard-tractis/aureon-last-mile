# Spec 33 — Admin Maintainer

**Status:** backlog

## Overview

Unified admin maintenance panel for managing core platform entities: users, clients, and pickup points. Replaces the standalone `/admin/users` page with a tab-based `/admin` experience. Designed for non-technical admin users — minimal fields, clear actions, consistent patterns.

## Goals

- Single `/admin` page with tabs: Users | Clients | Pickup Points
- Consistent CRUD experience across all entities (table + sheet form + soft delete)
- Role-based access: only `admin` and `operations_manager` can access
- Reuse existing component patterns (DataTable, Sheet, React Hook Form + Zod, Zustand store, TanStack Query)

## Non-Goals

- Granular permissions UI (future spec)
- Connector configuration for clients (future spec)
- Intake method configuration for pickup points (future spec)
- Custom role creation

## Route & Layout

**Route:** `/admin` with query param `?tab=users|clients|pickup-points`

- Default tab: `users`
- Tab state in URL query param (shareable, bookmarkable)
- Auth check at page level (SSR): redirect to `/` if role is not `admin` or `operations_manager`
- Existing `/admin/users` route removed; replaced by `/admin?tab=users`
- Existing `/admin/audit-logs` route remains as a separate page — not part of the tab layout (it's a cross-cutting concern, not an entity to manage)

## Migrations

No new tables, but minor schema adjustments are required:

### Migration 1: `add_deleted_at_to_tenant_clients`

```sql
ALTER TABLE tenant_clients ADD COLUMN deleted_at TIMESTAMPTZ;
```

The architecture mandates soft deletes via `deleted_at` on all tables. `tenant_clients` currently lacks this column.

### Migration 2: `make_connector_type_nullable`

```sql
ALTER TABLE tenant_clients ALTER COLUMN connector_type DROP NOT NULL;
```

Clients created via admin won't have a connector configured yet. Connector setup is a future spec. Default remains `null` until configured.

### Migration 3: `add_write_rls_policies_for_admin`

```sql
-- pickup_points: allow admin/operations_manager to insert, update, delete
CREATE POLICY pickup_points_admin_write ON pickup_points
  FOR ALL
  TO authenticated
  USING (
    operator_id = get_operator_id()
    AND (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role') IN ('admin', 'operations_manager')
  )
  WITH CHECK (
    operator_id = get_operator_id()
    AND (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role') IN ('admin', 'operations_manager')
  );
```

Currently `pickup_points` only has a SELECT policy for authenticated users. Write operations require admin/operations_manager role. Verify that `tenant_clients` existing RLS policies already permit writes for these roles — if not, add an equivalent policy.

## Data Model

### Users (`users` table)

| Field | UI Control | Notes |
|-------|-----------|-------|
| full_name | Text input | Required |
| email | Text input | Required, unique per operator, read-only on edit |
| role | Select dropdown | 5 roles from `user_role` enum |
| active status | Shown via `deleted_at` | Soft delete toggle |

### Clients (`tenant_clients` table)

| Field | UI Control | Notes |
|-------|-----------|-------|
| name | Text input | Required |
| slug | Auto-generated | From name, kebab-case, read-only |
| is_active | Toggle switch | Default true |

`connector_type` defaults to `null` after migration (was NOT NULL). `connector_config` defaults to `'{}'::jsonb`. Both out of scope — configured in future connector spec.

**Slug generation:** Auto-generated from `name` using kebab-case (lowercase, accented chars normalized, e.g., "Logística Rápida" → "logistica-rapida"). On collision, append numeric suffix (`-2`, `-3`). Slug is **immutable after creation** — renaming the client does not change the slug.

### Pickup Points (`pickup_points` table)

| Field | UI Control | Notes |
|-------|-----------|-------|
| name | Text input | Required |
| code | Text input | Required, unique per operator |
| tenant_client_id | Select dropdown | Pick from active clients |
| pickup_locations | Location form | JSONB array — see structure below |
| is_active | Toggle switch | Default true |

`intake_method` defaults to `manual` on creation. Not exposed in UI — future spec will add intake configuration.

**Pickup location structure** (single location per pickup point for now):

| Sub-field | UI Control | Required | Notes |
|-----------|-----------|----------|-------|
| name | Text input | Yes | Location label (e.g., "Bodega Principal") |
| address | Text input | Yes | Street address |
| comuna | Text input | No | Chilean commune |
| contact_name | Text input | No | On-site contact |
| contact_phone | Text input | No | Contact phone |

`lat`/`lng` not exposed in form — geocoding is a future enhancement. `operating_hours` not exposed — future spec. Form renders as a single location section within the pickup point form. Add/remove multiple locations is deferred.

## API Routes

All routes follow existing patterns: JWT claim validation, `operator_id` from JWT, structured error responses `{ code, message, field?, timestamp }`.

### Users — `/api/users` (existing, no changes)

- `GET` — fetch all users for operator
- `POST` — create user (admin/operations_manager only)
- `PUT /api/users/[id]` — update full_name, role
- `DELETE /api/users/[id]` — soft delete

### Clients — `/api/clients` (new)

- `GET` — fetch all clients for operator (RLS filters by `operator_id`)
- `POST` — create client (admin/operations_manager only). Auto-generates slug from name
- `PUT /api/clients/[id]` — update name, is_active
- `DELETE /api/clients/[id]` — soft delete (sets `deleted_at`)

### Pickup Points — `/api/pickup-points` (new)

- `GET` — fetch all pickup points for operator, joined with client name for display
- `POST` — create pickup point (admin/operations_manager only). Sets `intake_method = 'manual'` by default
- `PUT /api/pickup-points/[id]` — update name, code, client, location, is_active
- `DELETE /api/pickup-points/[id]` — soft delete

## Frontend Components

### Shared / Reused

- `DataTable` — existing custom component
- `Sheet` — shadcn, slide-over for create/edit forms
- `DeleteConfirmationModal` — existing component
- `Tabs` — shadcn

### New Components

```
components/admin/
  AdminPage.tsx              — Tab container, renders active tab's management component

  # Users (existing, refactored to fit tab pattern)
  UserManagement.tsx         — renamed from UserManagementPage.tsx
  UserTable.tsx              — as-is
  UserForm.tsx               — as-is

  # Clients (new)
  ClientManagement.tsx       — container: table + sheet + delete modal
  ClientTable.tsx            — columns: name, slug, pickup point count, status, actions
  ClientForm.tsx             — React Hook Form + Zod: name field, active toggle

  # Pickup Points (new)
  PickupPointManagement.tsx  — container: table + sheet + delete modal
  PickupPointTable.tsx       — columns: name, code, client, location, status, actions
  PickupPointForm.tsx        — React Hook Form + Zod: name, code, client select, location, active toggle
```

### Hooks (new, following `useUsers` pattern)

- `useClients()`, `useCreateClient()`, `useUpdateClient()`, `useDeleteClient()`
- `usePickupPoints()`, `useCreatePickupPoint()`, `useUpdatePickupPoint()`, `useDeletePickupPoint()`

### Store

One Zustand store per entity (cleaner separation):
- `useClientStore` — modal state for client CRUD
- `usePickupPointStore` — modal state for pickup point CRUD
- `useAdminStore` — existing, stays for user CRUD

## UX Behavior

### Tab Navigation

- Default tab: Users
- Switching tabs closes any open sheets/modals
- Active tab highlighted
- URL updates with `?tab=` param

### Table Behavior (consistent across all three)

- Client-side search across all visible columns
- Sortable columns (tri-state: asc/desc/none)
- "New" button top-right opens Sheet
- Inline Edit/Delete action buttons per row
- Skeleton loading state while data fetches
- Empty state message when no records exist
- Pagination: 20 rows per page using existing `DataTablePagination` component

### Forms (Sheet slide-over from right)

- Create and Edit share the same form component (mode prop)
- Validation on blur + on submit
- Save button disabled while submitting
- Toast on success ("Client created", "Pickup point updated", etc.)
- Sheet closes on successful save

### Delete Flow

- Confirmation modal with entity name displayed
- Soft delete only (sets `deleted_at`)
- Toast on success
- Prevent deleting a client that has active pickup points (show warning)

**Authorization per action:**

| Action | Users | Clients | Pickup Points |
|--------|-------|---------|---------------|
| View | admin, operations_manager | admin, operations_manager | admin, operations_manager |
| Create | admin, operations_manager | admin, operations_manager | admin, operations_manager |
| Update | admin, operations_manager | admin, operations_manager | admin, operations_manager |
| Delete | admin only | admin only | admin only |

`operations_manager` can create and edit but **cannot delete** any entity. This follows the existing user deletion pattern.

### Client–Pickup Point Relationship

- Pickup Point form shows a dropdown of active clients
- Client table shows a count of associated pickup points
- Deleting a client warns if it has pickup points attached

## Testing Strategy

TDD — write failing tests before implementation.

- **Unit tests (Vitest + RTL):** form validation, table rendering, store actions
- **Hook tests:** mock Supabase client, test query/mutation behavior
- **API route tests:** validate auth checks, CRUD operations, error responses
- Collocated test files next to components (existing pattern)

---

# Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified `/admin` tab-based panel for managing users, clients, and pickup points.

**Architecture:** Tab-based SPA page at `/admin` with three management sections sharing consistent DataTable + Sheet + Zustand patterns. API routes follow existing `/api/users` conventions. Three small DB migrations for RLS and schema gaps.

**Tech Stack:** Next.js 15 App Router, Supabase (PostgreSQL + RLS), shadcn/ui (Tabs, Sheet), TanStack Query v5, Zustand, React Hook Form + Zod, Vitest + RTL

---

## File Map

### Migrations (new)
- `packages/database/supabase/migrations/YYYYMMDD000001_spec33_tenant_clients_deleted_at.sql`
- `packages/database/supabase/migrations/YYYYMMDD000002_spec33_connector_type_nullable.sql`
- `packages/database/supabase/migrations/YYYYMMDD000003_spec33_pickup_points_write_rls.sql`

### Types (new)
- `apps/frontend/src/lib/api/clients.ts` — Client type + API client functions
- `apps/frontend/src/lib/api/pickup-points.ts` — PickupPoint type + API client functions

### API Routes (new)
- `apps/frontend/src/app/api/clients/route.ts` — GET + POST
- `apps/frontend/src/app/api/clients/[id]/route.ts` — PUT + DELETE
- `apps/frontend/src/app/api/pickup-points/route.ts` — GET + POST
- `apps/frontend/src/app/api/pickup-points/[id]/route.ts` — PUT + DELETE

### Hooks (new)
- `apps/frontend/src/hooks/useClients.ts` — useClients, useCreateClient, useUpdateClient, useDeleteClient
- `apps/frontend/src/hooks/usePickupPoints.ts` — usePickupPoints, useCreatePickupPoint, useUpdatePickupPoint, useDeletePickupPoint

### Stores (new)
- `apps/frontend/src/lib/stores/clientStore.ts`
- `apps/frontend/src/lib/stores/pickupPointStore.ts`

### Components (new)
- `apps/frontend/src/components/admin/AdminPage.tsx` — tab container
- `apps/frontend/src/components/admin/ClientManagement.tsx`
- `apps/frontend/src/components/admin/ClientTable.tsx`
- `apps/frontend/src/components/admin/ClientForm.tsx`
- `apps/frontend/src/components/admin/PickupPointManagement.tsx`
- `apps/frontend/src/components/admin/PickupPointTable.tsx`
- `apps/frontend/src/components/admin/PickupPointForm.tsx`

### Components (modified)
- `apps/frontend/src/components/admin/UserManagementPage.tsx` → renamed to `UserManagement.tsx`, remove outer page wrapper
- `apps/frontend/src/components/admin/DeleteConfirmationModal.tsx` — generalize to accept entity type

### Pages (modified)
- `apps/frontend/src/app/admin/page.tsx` — new unified admin page (replaces `/admin/users/page.tsx`)
- `apps/frontend/src/app/admin/users/page.tsx` — redirect to `/admin?tab=users`

### Utilities (new)
- `apps/frontend/src/lib/utils/slugify.ts` — slug generation with accent normalization

---

## Chunk 1: Database Migrations + Types

### Task 1: Database migrations

**Files:**
- Create: `packages/database/supabase/migrations/20260413000001_spec33_tenant_clients_deleted_at.sql`
- Create: `packages/database/supabase/migrations/20260413000002_spec33_connector_type_nullable.sql`
- Create: `packages/database/supabase/migrations/20260413000003_spec33_pickup_points_write_rls.sql`

- [ ] **Step 1: Create migration — add deleted_at to tenant_clients**

```sql
-- 20260413000001_spec33_tenant_clients_deleted_at.sql
ALTER TABLE public.tenant_clients ADD COLUMN deleted_at TIMESTAMPTZ;
```

- [ ] **Step 2: Create migration — make connector_type nullable**

```sql
-- 20260413000002_spec33_connector_type_nullable.sql
ALTER TABLE public.tenant_clients ALTER COLUMN connector_type DROP NOT NULL;
```

- [ ] **Step 3: Create migration — add write RLS for pickup_points**

```sql
-- 20260413000003_spec33_pickup_points_write_rls.sql

-- Allow admin/operations_manager to write pickup_points within their operator
CREATE POLICY pickup_points_admin_write ON public.pickup_points
  FOR ALL
  TO authenticated
  USING (
    operator_id = public.get_operator_id()
    AND (
      (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role')
      IN ('admin', 'operations_manager')
    )
  )
  WITH CHECK (
    operator_id = public.get_operator_id()
    AND (
      (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'role')
      IN ('admin', 'operations_manager')
    )
  );
```

- [ ] **Step 4: Run migrations locally**

Run: `npx supabase db push` (from `packages/database/`)
Expected: All 3 migrations applied successfully.

- [ ] **Step 5: Commit**

```bash
git add packages/database/supabase/migrations/20260413000001_spec33_tenant_clients_deleted_at.sql \
        packages/database/supabase/migrations/20260413000002_spec33_connector_type_nullable.sql \
        packages/database/supabase/migrations/20260413000003_spec33_pickup_points_write_rls.sql
git commit -m "feat(spec-33): add migrations for tenant_clients soft delete, nullable connector, pickup_points write RLS"
```

### Task 2: Slugify utility

**Files:**
- Create: `apps/frontend/src/lib/utils/slugify.ts`
- Create: `apps/frontend/src/lib/utils/slugify.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/frontend/src/lib/utils/slugify.test.ts
import { describe, it, expect } from 'vitest';
import { slugify } from './slugify';

describe('slugify', () => {
  it('converts basic string to kebab-case', () => {
    expect(slugify('My Client')).toBe('my-client');
  });

  it('normalizes accented characters', () => {
    expect(slugify('Logística Rápida')).toBe('logistica-rapida');
  });

  it('removes special characters', () => {
    expect(slugify('Client & Sons (LLC)')).toBe('client-sons-llc');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('foo  --  bar')).toBe('foo-bar');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify(' -hello- ')).toBe('hello');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/lib/utils/slugify.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/frontend/src/lib/utils/slugify.ts
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')    // non-alphanumeric → hyphen
    .replace(/-+/g, '-')            // collapse hyphens
    .replace(/^-|-$/g, '');         // trim edges
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/lib/utils/slugify.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/utils/slugify.ts apps/frontend/src/lib/utils/slugify.test.ts
git commit -m "feat(spec-33): add slugify utility with accent normalization"
```

### Task 3: Client API types and client functions

**Files:**
- Create: `apps/frontend/src/lib/api/clients.ts`

- [ ] **Step 1: Create types and API client**

```typescript
// apps/frontend/src/lib/api/clients.ts

export interface Client {
  id: string;
  operator_id: string;
  name: string;
  slug: string;
  connector_type: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  pickup_point_count?: number;
}

export interface CreateClientInput {
  name: string;
}

export interface UpdateClientInput {
  name?: string;
  is_active?: boolean;
}

export async function getClients(): Promise<Client[]> {
  const res = await fetch('/api/clients');
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to fetch clients');
  }
  return res.json();
}

export async function createClient(input: CreateClientInput): Promise<Client> {
  const res = await fetch('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to create client');
  }
  return res.json();
}

export async function updateClient(id: string, input: UpdateClientInput): Promise<Client> {
  const res = await fetch(`/api/clients/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to update client');
  }
  return res.json();
}

export async function deleteClient(id: string): Promise<void> {
  const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to delete client');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/lib/api/clients.ts
git commit -m "feat(spec-33): add client API types and client functions"
```

### Task 4: Pickup Point API types and client functions

**Files:**
- Create: `apps/frontend/src/lib/api/pickup-points.ts`

- [ ] **Step 1: Create types and API client**

```typescript
// apps/frontend/src/lib/api/pickup-points.ts

export interface PickupLocation {
  name: string;
  address: string;
  comuna?: string;
  contact_name?: string;
  contact_phone?: string;
}

export interface PickupPoint {
  id: string;
  operator_id: string;
  tenant_client_id: string;
  name: string;
  code: string;
  intake_method: string;
  pickup_locations: PickupLocation[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  client_name?: string; // joined from tenant_clients
}

export interface CreatePickupPointInput {
  name: string;
  code: string;
  tenant_client_id: string;
  pickup_locations: PickupLocation[];
}

export interface UpdatePickupPointInput {
  name?: string;
  code?: string;
  tenant_client_id?: string;
  pickup_locations?: PickupLocation[];
  is_active?: boolean;
}

export async function getPickupPoints(): Promise<PickupPoint[]> {
  const res = await fetch('/api/pickup-points');
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to fetch pickup points');
  }
  return res.json();
}

export async function createPickupPoint(input: CreatePickupPointInput): Promise<PickupPoint> {
  const res = await fetch('/api/pickup-points', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to create pickup point');
  }
  return res.json();
}

export async function updatePickupPoint(id: string, input: UpdatePickupPointInput): Promise<PickupPoint> {
  const res = await fetch(`/api/pickup-points/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to update pickup point');
  }
  return res.json();
}

export async function deletePickupPoint(id: string): Promise<void> {
  const res = await fetch(`/api/pickup-points/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to delete pickup point');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/lib/api/pickup-points.ts
git commit -m "feat(spec-33): add pickup point API types and client functions"
```

## Chunk 2: API Routes

### Task 5: Clients API — GET + POST

**Files:**
- Create: `apps/frontend/src/app/api/clients/route.ts`

- [ ] **Step 1: Create GET and POST handlers**

```typescript
// apps/frontend/src/app/api/clients/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';
import { slugify } from '@/lib/utils/slugify';

export async function GET() {
  const supabase = await createSSRClient();
  const { data: { session }, error: authError } = await supabase.auth.getSession();

  if (authError || !session) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
      { status: 401 }
    );
  }

  const userRole = session.user.app_metadata?.claims?.role;
  if (userRole !== 'admin' && userRole !== 'operations_manager') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin or operations_manager role required', timestamp: new Date().toISOString() },
      { status: 403 }
    );
  }

  // Fetch clients with pickup point count — RLS filters by operator_id
  const { data: clients, error } = await supabase
    .from('tenant_clients')
    .select('*, pickup_points(count)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { code: 'FETCH_ERROR', message: error.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }

  // Flatten pickup point count
  const result = (clients || []).map((c: Record<string, unknown>) => ({
    ...c,
    pickup_point_count: Array.isArray(c.pickup_points) ? (c.pickup_points[0] as { count: number })?.count ?? 0 : 0,
    pickup_points: undefined,
  }));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const supabase = await createSSRClient();
  const { data: { session }, error: authError } = await supabase.auth.getSession();

  if (authError || !session) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
      { status: 401 }
    );
  }

  const userRole = session.user.app_metadata?.claims?.role;
  if (userRole !== 'admin' && userRole !== 'operations_manager') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin or operations_manager role required', timestamp: new Date().toISOString() },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { name } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Client name is required', field: 'name', timestamp: new Date().toISOString() },
      { status: 400 }
    );
  }

  const operatorId = session.user.app_metadata?.claims?.operator_id;
  let slug = slugify(name.trim());

  // Handle slug collision — append numeric suffix
  const { data: existing } = await supabase
    .from('tenant_clients')
    .select('slug')
    .eq('slug', slug)
    .is('deleted_at', null);

  if (existing && existing.length > 0) {
    let suffix = 2;
    let candidateSlug = `${slug}-${suffix}`;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data: check } = await supabase
        .from('tenant_clients')
        .select('slug')
        .eq('slug', candidateSlug)
        .is('deleted_at', null);
      if (!check || check.length === 0) break;
      suffix++;
      candidateSlug = `${slug}-${suffix}`;
    }
    slug = candidateSlug;
  }

  const { data: client, error } = await supabase
    .from('tenant_clients')
    .insert({
      operator_id: operatorId,
      name: name.trim(),
      slug,
      is_active: true,
      connector_config: {},
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { code: 'CREATE_ERROR', message: error.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }

  return NextResponse.json(client, { status: 201 });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/api/clients/route.ts
git commit -m "feat(spec-33): add clients API GET + POST routes"
```

### Task 6: Clients API — PUT + DELETE

**Files:**
- Create: `apps/frontend/src/app/api/clients/[id]/route.ts`

- [ ] **Step 1: Create PUT and DELETE handlers**

```typescript
// apps/frontend/src/app/api/clients/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSSRClient();
  const { data: { session }, error: authError } = await supabase.auth.getSession();

  if (authError || !session) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
      { status: 401 }
    );
  }

  const userRole = session.user.app_metadata?.claims?.role;
  if (userRole !== 'admin' && userRole !== 'operations_manager') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin or operations_manager role required', timestamp: new Date().toISOString() },
      { status: 403 }
    );
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Client name cannot be empty', field: 'name', timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }
    updates.name = body.name.trim();
  }

  if (body.is_active !== undefined) {
    updates.is_active = Boolean(body.is_active);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'No fields to update', timestamp: new Date().toISOString() },
      { status: 400 }
    );
  }

  const { data: client, error } = await supabase
    .from('tenant_clients')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { code: 'UPDATE_ERROR', message: error.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }

  return NextResponse.json(client);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSSRClient();
  const { data: { session }, error: authError } = await supabase.auth.getSession();

  if (authError || !session) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
      { status: 401 }
    );
  }

  const userRole = session.user.app_metadata?.claims?.role;
  if (userRole !== 'admin') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Only admins can delete clients', timestamp: new Date().toISOString() },
      { status: 403 }
    );
  }

  // Check for active pickup points
  const { data: activePoints } = await supabase
    .from('pickup_points')
    .select('id')
    .eq('tenant_client_id', id)
    .is('deleted_at', null)
    .eq('is_active', true);

  if (activePoints && activePoints.length > 0) {
    return NextResponse.json(
      { code: 'HAS_DEPENDENCIES', message: `Cannot delete client with ${activePoints.length} active pickup point(s). Deactivate or delete them first.`, timestamp: new Date().toISOString() },
      { status: 409 }
    );
  }

  // Soft delete
  const { error } = await supabase
    .from('tenant_clients')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);

  if (error) {
    return NextResponse.json(
      { code: 'DELETE_ERROR', message: error.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/api/clients/[id]/route.ts
git commit -m "feat(spec-33): add clients API PUT + DELETE routes"
```

### Task 7: Pickup Points API — GET + POST

**Files:**
- Create: `apps/frontend/src/app/api/pickup-points/route.ts`

- [ ] **Step 1: Create GET and POST handlers**

```typescript
// apps/frontend/src/app/api/pickup-points/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSSRClient();
  const { data: { session }, error: authError } = await supabase.auth.getSession();

  if (authError || !session) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
      { status: 401 }
    );
  }

  const userRole = session.user.app_metadata?.claims?.role;
  if (userRole !== 'admin' && userRole !== 'operations_manager') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin or operations_manager role required', timestamp: new Date().toISOString() },
      { status: 403 }
    );
  }

  // Fetch pickup points with client name
  const { data: points, error } = await supabase
    .from('pickup_points')
    .select('*, tenant_clients(name)')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json(
      { code: 'FETCH_ERROR', message: error.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }

  // Flatten client name
  const result = (points || []).map((p: Record<string, unknown>) => ({
    ...p,
    client_name: (p.tenant_clients as { name: string } | null)?.name ?? null,
    tenant_clients: undefined,
  }));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const supabase = await createSSRClient();
  const { data: { session }, error: authError } = await supabase.auth.getSession();

  if (authError || !session) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
      { status: 401 }
    );
  }

  const userRole = session.user.app_metadata?.claims?.role;
  if (userRole !== 'admin' && userRole !== 'operations_manager') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin or operations_manager role required', timestamp: new Date().toISOString() },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { name, code, tenant_client_id, pickup_locations } = body;

  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Pickup point name is required', field: 'name', timestamp: new Date().toISOString() },
      { status: 400 }
    );
  }
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Pickup point code is required', field: 'code', timestamp: new Date().toISOString() },
      { status: 400 }
    );
  }
  if (!tenant_client_id) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'Client is required', field: 'tenant_client_id', timestamp: new Date().toISOString() },
      { status: 400 }
    );
  }

  // Validate pickup_locations structure
  if (!Array.isArray(pickup_locations) || pickup_locations.length === 0) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'At least one pickup location is required', field: 'pickup_locations', timestamp: new Date().toISOString() },
      { status: 400 }
    );
  }

  for (const loc of pickup_locations) {
    if (!loc.name || !loc.address) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Each location must have a name and address', field: 'pickup_locations', timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }
  }

  const operatorId = session.user.app_metadata?.claims?.operator_id;

  // Check code uniqueness within operator
  const { data: existingCode } = await supabase
    .from('pickup_points')
    .select('id')
    .eq('code', code.trim())
    .is('deleted_at', null);

  if (existingCode && existingCode.length > 0) {
    return NextResponse.json(
      { code: 'DUPLICATE_CODE', message: 'A pickup point with this code already exists', field: 'code', timestamp: new Date().toISOString() },
      { status: 409 }
    );
  }

  const { data: point, error } = await supabase
    .from('pickup_points')
    .insert({
      operator_id: operatorId,
      name: name.trim(),
      code: code.trim(),
      tenant_client_id,
      intake_method: 'manual',
      pickup_locations,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { code: 'CREATE_ERROR', message: error.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }

  return NextResponse.json(point, { status: 201 });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/api/pickup-points/route.ts
git commit -m "feat(spec-33): add pickup points API GET + POST routes"
```

### Task 8: Pickup Points API — PUT + DELETE

**Files:**
- Create: `apps/frontend/src/app/api/pickup-points/[id]/route.ts`

- [ ] **Step 1: Create PUT and DELETE handlers**

```typescript
// apps/frontend/src/app/api/pickup-points/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createSSRClient } from '@/lib/supabase/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSSRClient();
  const { data: { session }, error: authError } = await supabase.auth.getSession();

  if (authError || !session) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
      { status: 401 }
    );
  }

  const userRole = session.user.app_metadata?.claims?.role;
  if (userRole !== 'admin' && userRole !== 'operations_manager') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Admin or operations_manager role required', timestamp: new Date().toISOString() },
      { status: 403 }
    );
  }

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Name cannot be empty', field: 'name', timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }
    updates.name = body.name.trim();
  }
  if (body.code !== undefined) {
    if (typeof body.code !== 'string' || body.code.trim().length === 0) {
      return NextResponse.json(
        { code: 'VALIDATION_ERROR', message: 'Code cannot be empty', field: 'code', timestamp: new Date().toISOString() },
        { status: 400 }
      );
    }
    // Check uniqueness excluding current record
    const { data: existingCode } = await supabase
      .from('pickup_points')
      .select('id')
      .eq('code', body.code.trim())
      .neq('id', id)
      .is('deleted_at', null);
    if (existingCode && existingCode.length > 0) {
      return NextResponse.json(
        { code: 'DUPLICATE_CODE', message: 'A pickup point with this code already exists', field: 'code', timestamp: new Date().toISOString() },
        { status: 409 }
      );
    }
    updates.code = body.code.trim();
  }
  if (body.tenant_client_id !== undefined) updates.tenant_client_id = body.tenant_client_id;
  if (body.pickup_locations !== undefined) updates.pickup_locations = body.pickup_locations;
  if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { code: 'VALIDATION_ERROR', message: 'No fields to update', timestamp: new Date().toISOString() },
      { status: 400 }
    );
  }

  const { data: point, error } = await supabase
    .from('pickup_points')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { code: 'UPDATE_ERROR', message: error.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }

  return NextResponse.json(point);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSSRClient();
  const { data: { session }, error: authError } = await supabase.auth.getSession();

  if (authError || !session) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication required', timestamp: new Date().toISOString() },
      { status: 401 }
    );
  }

  const userRole = session.user.app_metadata?.claims?.role;
  if (userRole !== 'admin') {
    return NextResponse.json(
      { code: 'FORBIDDEN', message: 'Only admins can delete pickup points', timestamp: new Date().toISOString() },
      { status: 403 }
    );
  }

  const { error } = await supabase
    .from('pickup_points')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null);

  if (error) {
    return NextResponse.json(
      { code: 'DELETE_ERROR', message: error.message, timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/api/pickup-points/[id]/route.ts
git commit -m "feat(spec-33): add pickup points API PUT + DELETE routes"
```

## Chunk 3: Hooks + Stores

### Task 9: Client hooks

**Files:**
- Create: `apps/frontend/src/hooks/useClients.ts`

- [ ] **Step 1: Create hooks following useUsers pattern**

```typescript
// apps/frontend/src/hooks/useClients.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClients, createClient, updateClient, deleteClient, type CreateClientInput, type UpdateClientInput } from '@/lib/api/clients';
import { toast } from 'sonner';

export const useClients = () => {
  return useQuery({
    queryKey: ['clients'],
    queryFn: getClients,
    staleTime: 300000,
    refetchInterval: 300000,
    refetchOnWindowFocus: false,
  });
};

export const useCreateClient = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateClientInput) => createClient(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success(`Cliente "${data.name}" creado exitosamente`);
    },
    onError: (error: Error) => {
      toast.error(`Error al crear cliente: ${error.message}`);
    },
  });
};

export const useUpdateClient = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateClientInput }) => updateClient(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Cliente actualizado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(`Error al actualizar cliente: ${error.message}`);
    },
  });
};

export const useDeleteClient = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['pickup-points'] });
      toast.success('Cliente eliminado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(`Error al eliminar cliente: ${error.message}`);
    },
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/hooks/useClients.ts
git commit -m "feat(spec-33): add client TanStack Query hooks"
```

### Task 10: Pickup Point hooks

**Files:**
- Create: `apps/frontend/src/hooks/usePickupPoints.ts`

- [ ] **Step 1: Create hooks**

```typescript
// apps/frontend/src/hooks/usePickupPoints.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPickupPoints, createPickupPoint, updatePickupPoint, deletePickupPoint, type CreatePickupPointInput, type UpdatePickupPointInput } from '@/lib/api/pickup-points';
import { toast } from 'sonner';

export const usePickupPoints = () => {
  return useQuery({
    queryKey: ['pickup-points'],
    queryFn: getPickupPoints,
    staleTime: 300000,
    refetchInterval: 300000,
    refetchOnWindowFocus: false,
  });
};

export const useCreatePickupPoint = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePickupPointInput) => createPickupPoint(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pickup-points'] });
      toast.success(`Punto de retiro "${data.name}" creado exitosamente`);
    },
    onError: (error: Error) => {
      toast.error(`Error al crear punto de retiro: ${error.message}`);
    },
  });
};

export const useUpdatePickupPoint = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePickupPointInput }) => updatePickupPoint(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup-points'] });
      toast.success('Punto de retiro actualizado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(`Error al actualizar punto de retiro: ${error.message}`);
    },
  });
};

export const useDeletePickupPoint = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePickupPoint,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup-points'] });
      toast.success('Punto de retiro eliminado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(`Error al eliminar punto de retiro: ${error.message}`);
    },
  });
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/hooks/usePickupPoints.ts
git commit -m "feat(spec-33): add pickup point TanStack Query hooks"
```

### Task 11: Zustand stores

**Files:**
- Create: `apps/frontend/src/lib/stores/clientStore.ts`
- Create: `apps/frontend/src/lib/stores/pickupPointStore.ts`

- [ ] **Step 1: Create client store**

```typescript
// apps/frontend/src/lib/stores/clientStore.ts
import { create } from 'zustand';

interface ClientStore {
  isCreateFormOpen: boolean;
  isEditFormOpen: boolean;
  isDeleteConfirmOpen: boolean;
  selectedClientId: string | null;
  setCreateFormOpen: (open: boolean) => void;
  setEditFormOpen: (open: boolean, clientId?: string) => void;
  setDeleteConfirmOpen: (open: boolean, clientId?: string) => void;
  resetAll: () => void;
}

export const useClientStore = create<ClientStore>((set) => ({
  isCreateFormOpen: false,
  isEditFormOpen: false,
  isDeleteConfirmOpen: false,
  selectedClientId: null,
  setCreateFormOpen: (open) => set({ isCreateFormOpen: open }),
  setEditFormOpen: (open, clientId) => set({ isEditFormOpen: open, selectedClientId: clientId || null }),
  setDeleteConfirmOpen: (open, clientId) => set({ isDeleteConfirmOpen: open, selectedClientId: clientId || null }),
  resetAll: () => set({ isCreateFormOpen: false, isEditFormOpen: false, isDeleteConfirmOpen: false, selectedClientId: null }),
}));
```

- [ ] **Step 2: Create pickup point store**

```typescript
// apps/frontend/src/lib/stores/pickupPointStore.ts
import { create } from 'zustand';

interface PickupPointStore {
  isCreateFormOpen: boolean;
  isEditFormOpen: boolean;
  isDeleteConfirmOpen: boolean;
  selectedPickupPointId: string | null;
  setCreateFormOpen: (open: boolean) => void;
  setEditFormOpen: (open: boolean, pointId?: string) => void;
  setDeleteConfirmOpen: (open: boolean, pointId?: string) => void;
  resetAll: () => void;
}

export const usePickupPointStore = create<PickupPointStore>((set) => ({
  isCreateFormOpen: false,
  isEditFormOpen: false,
  isDeleteConfirmOpen: false,
  selectedPickupPointId: null,
  setCreateFormOpen: (open) => set({ isCreateFormOpen: open }),
  setEditFormOpen: (open, pointId) => set({ isEditFormOpen: open, selectedPickupPointId: pointId || null }),
  setDeleteConfirmOpen: (open, pointId) => set({ isDeleteConfirmOpen: open, selectedPickupPointId: pointId || null }),
  resetAll: () => set({ isCreateFormOpen: false, isEditFormOpen: false, isDeleteConfirmOpen: false, selectedPickupPointId: null }),
}));
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/lib/stores/clientStore.ts apps/frontend/src/lib/stores/pickupPointStore.ts
git commit -m "feat(spec-33): add Zustand stores for client and pickup point modal state"
```

## Chunk 4: Client Management UI

### Task 12: ClientTable component

**Files:**
- Create: `apps/frontend/src/components/admin/ClientTable.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/frontend/src/components/admin/ClientTable.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientTable } from './ClientTable';

vi.mock('@/lib/stores/clientStore', () => ({
  useClientStore: () => ({
    setEditFormOpen: vi.fn(),
    setDeleteConfirmOpen: vi.fn(),
  }),
}));

const mockClients = [
  { id: '1', name: 'Easy', slug: 'easy', is_active: true, pickup_point_count: 3, created_at: '2026-01-01', operator_id: 'op1', connector_type: null, updated_at: '2026-01-01', deleted_at: null },
  { id: '2', name: 'Flash', slug: 'flash', is_active: false, pickup_point_count: 0, created_at: '2026-01-02', operator_id: 'op1', connector_type: null, updated_at: '2026-01-02', deleted_at: null },
];

describe('ClientTable', () => {
  it('renders client rows', () => {
    render(<ClientTable clients={mockClients} isLoading={false} userRole="admin" />);
    expect(screen.getByText('Easy')).toBeDefined();
    expect(screen.getByText('Flash')).toBeDefined();
  });

  it('shows loading skeleton when loading', () => {
    render(<ClientTable clients={[]} isLoading={true} userRole="admin" />);
    expect(screen.queryByText('Easy')).toBeNull();
  });

  it('shows empty message when no clients', () => {
    render(<ClientTable clients={[]} isLoading={false} userRole="admin" />);
    expect(screen.getByText('No hay clientes')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/admin/ClientTable.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// apps/frontend/src/components/admin/ClientTable.tsx
'use client';

import { useMemo } from 'react';
import { useClientStore } from '@/lib/stores/clientStore';
import { DataTable, type ColumnDef } from '@/components/data-table/DataTable';
import type { Client } from '@/lib/api/clients';

interface ClientTableProps {
  clients: Client[];
  isLoading: boolean;
  userRole: string;
}

export const ClientTable = ({ clients, isLoading, userRole }: ClientTableProps) => {
  const { setEditFormOpen, setDeleteConfirmOpen } = useClientStore();

  const columns: ColumnDef<Client>[] = useMemo(() => [
    { accessorKey: 'name', header: 'Nombre' },
    { accessorKey: 'slug', header: 'Slug' },
    {
      accessorKey: 'pickup_point_count',
      header: 'Puntos de Retiro',
      cell: (row) => <span className="font-mono text-xs">{row.pickup_point_count ?? 0}</span>,
    },
    {
      accessorKey: 'is_active',
      header: 'Estado',
      cell: (row) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${row.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'}`}>
          {row.is_active ? 'Activo' : 'Inactivo'}
        </span>
      ),
    },
    {
      accessorKey: 'id',
      header: 'Acciones',
      sortable: false,
      cell: (row) => (
        <div className="flex gap-2">
          <button onClick={() => setEditFormOpen(true, row.id)} className="text-xs text-accent hover:underline">
            Editar
          </button>
          {userRole === 'admin' && (
            <button onClick={() => setDeleteConfirmOpen(true, row.id)} className="text-xs text-[var(--color-status-error)] hover:underline">
              Eliminar
            </button>
          )}
        </div>
      ),
    },
  ], [setEditFormOpen, setDeleteConfirmOpen, userRole]);

  return (
    <DataTable
      columns={columns as unknown as ColumnDef<Record<string, unknown>>[]}
      data={(clients ?? []) as unknown as Record<string, unknown>[]}
      isLoading={isLoading}
      searchPlaceholder="Buscar por nombre..."
      emptyMessage="No hay clientes"
    />
  );
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/components/admin/ClientTable.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/admin/ClientTable.tsx apps/frontend/src/components/admin/ClientTable.test.tsx
git commit -m "feat(spec-33): add ClientTable component with tests"
```

### Task 13: ClientForm component

**Files:**
- Create: `apps/frontend/src/components/admin/ClientForm.tsx`
- Create: `apps/frontend/src/components/admin/ClientForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/frontend/src/components/admin/ClientForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClientForm } from './ClientForm';

vi.mock('@/lib/stores/clientStore', () => ({
  useClientStore: () => ({
    isCreateFormOpen: true,
    isEditFormOpen: false,
    selectedClientId: null,
    setCreateFormOpen: vi.fn(),
    setEditFormOpen: vi.fn(),
  }),
}));

vi.mock('@/hooks/useClients', () => ({
  useClients: () => ({ data: [] }),
  useCreateClient: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateClient: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('ClientForm', () => {
  it('renders create form with name field', () => {
    render(<ClientForm mode="create" />);
    expect(screen.getByLabelText('Nombre')).toBeDefined();
  });

  it('validates name is required', async () => {
    const user = userEvent.setup();
    render(<ClientForm mode="create" />);
    const submitBtn = screen.getByRole('button', { name: /guardar/i });
    await user.click(submitBtn);
    expect(screen.getByText(/nombre.*requerido/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/admin/ClientForm.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// apps/frontend/src/components/admin/ClientForm.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useClientStore } from '@/lib/stores/clientStore';
import { useClients, useCreateClient, useUpdateClient } from '@/hooks/useClients';

const clientSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(100),
  is_active: z.boolean(),
});

type ClientFormValues = z.infer<typeof clientSchema>;

interface ClientFormProps {
  mode: 'create' | 'edit';
  clientId?: string;
}

export const ClientForm = ({ mode, clientId }: ClientFormProps) => {
  const { setCreateFormOpen, setEditFormOpen } = useClientStore();
  const { data: clients } = useClients();
  const { mutate: create, isPending: isCreating } = useCreateClient();
  const { mutate: update, isPending: isUpdating } = useUpdateClient();

  const existingClient = mode === 'edit' ? clients?.find((c) => c.id === clientId) : null;

  const { register, handleSubmit, formState: { errors } } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: existingClient?.name ?? '',
      is_active: existingClient?.is_active ?? true,
    },
  });

  const isPending = isCreating || isUpdating;

  const onSubmit = (values: ClientFormValues) => {
    if (mode === 'create') {
      create({ name: values.name }, {
        onSuccess: () => setCreateFormOpen(false),
      });
    } else if (clientId) {
      update({ id: clientId, data: { name: values.name, is_active: values.is_active } }, {
        onSuccess: () => setEditFormOpen(false),
      });
    }
  };

  const handleClose = () => {
    if (mode === 'create') setCreateFormOpen(false);
    else setEditFormOpen(false);
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) handleClose(); }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{mode === 'create' ? 'Nuevo Cliente' : 'Editar Cliente'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1">Nombre</label>
            <input
              id="name"
              type="text"
              {...register('name')}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
              disabled={isPending}
            />
            {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
          </div>

          {mode === 'edit' && existingClient && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Slug</label>
                <div className="px-3 py-2 border border-border rounded-md bg-muted text-muted-foreground text-sm">
                  {existingClient.slug}
                </div>
                <p className="text-xs text-muted-foreground mt-1">El slug no se puede modificar</p>
              </div>

              <div className="flex items-center gap-2">
                <input id="is_active" type="checkbox" {...register('is_active')} className="rounded" />
                <label htmlFor="is_active" className="text-sm font-medium">Activo</label>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending}
              className="flex-1 px-4 py-2 border border-border rounded-md hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 px-4 py-2 bg-accent text-accent-foreground rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/components/admin/ClientForm.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/admin/ClientForm.tsx apps/frontend/src/components/admin/ClientForm.test.tsx
git commit -m "feat(spec-33): add ClientForm component with tests"
```

### Task 14: ClientManagement container

**Files:**
- Create: `apps/frontend/src/components/admin/ClientManagement.tsx`

- [ ] **Step 1: Create container component**

```typescript
// apps/frontend/src/components/admin/ClientManagement.tsx
'use client';

import { useClients, useDeleteClient } from '@/hooks/useClients';
import { useClientStore } from '@/lib/stores/clientStore';
import { ClientTable } from './ClientTable';
import { ClientForm } from './ClientForm';

interface ClientManagementProps {
  userRole: string;
}

export const ClientManagement = ({ userRole }: ClientManagementProps) => {
  const { data: clients, isLoading } = useClients();
  const { isCreateFormOpen, isEditFormOpen, selectedClientId, isDeleteConfirmOpen, setCreateFormOpen, setDeleteConfirmOpen } = useClientStore();
  const { mutate: deleteClient, isPending: isDeleting } = useDeleteClient();

  const handleDelete = () => {
    if (selectedClientId) {
      deleteClient(selectedClientId, {
        onSuccess: () => setDeleteConfirmOpen(false),
      });
    }
  };

  const selectedClient = clients?.find((c) => c.id === selectedClientId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Clientes</h2>
          <p className="text-sm text-muted-foreground mt-1">Crear y administrar clientes</p>
        </div>
        <button
          onClick={() => setCreateFormOpen(true)}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md hover:opacity-90 font-medium"
          style={{ minHeight: '44px' }}
        >
          Nuevo Cliente
        </button>
      </div>

      <ClientTable clients={clients || []} isLoading={isLoading} userRole={userRole} />

      {isCreateFormOpen && <ClientForm mode="create" />}
      {isEditFormOpen && selectedClientId && <ClientForm mode="edit" clientId={selectedClientId} />}

      {/* Delete confirmation */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-card rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold text-foreground mb-4">Eliminar Cliente</h2>
            <p className="text-foreground mb-4">
              {'\u00BF'}Estás seguro de que quieres eliminar el cliente <strong>{selectedClient?.name}</strong>?
            </p>
            {(selectedClient?.pickup_point_count ?? 0) > 0 && (
              <div className="bg-[var(--color-status-warning-bg)] border border-[var(--color-status-warning-border)] rounded-md p-4 mb-4">
                <p className="text-sm"><strong>Advertencia:</strong> Este cliente tiene {selectedClient?.pickup_point_count} punto(s) de retiro activo(s). Deben ser eliminados o desactivados primero.</p>
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setDeleteConfirmOpen(false)} disabled={isDeleting} className="px-4 py-2 border border-border rounded-md hover:bg-muted disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={handleDelete} disabled={isDeleting || (selectedClient?.pickup_point_count ?? 0) > 0} className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50">
                {isDeleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/admin/ClientManagement.tsx
git commit -m "feat(spec-33): add ClientManagement container component"
```

## Chunk 5: Pickup Point Management UI

### Task 15: PickupPointTable component

**Files:**
- Create: `apps/frontend/src/components/admin/PickupPointTable.tsx`
- Create: `apps/frontend/src/components/admin/PickupPointTable.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/frontend/src/components/admin/PickupPointTable.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PickupPointTable } from './PickupPointTable';

vi.mock('@/lib/stores/pickupPointStore', () => ({
  usePickupPointStore: () => ({
    setEditFormOpen: vi.fn(),
    setDeleteConfirmOpen: vi.fn(),
  }),
}));

const mockPoints = [
  { id: '1', name: 'Bodega Central', code: 'BC-001', client_name: 'Easy', is_active: true, pickup_locations: [{ name: 'Main', address: 'Av Libertador 123' }], operator_id: 'op1', tenant_client_id: 'c1', intake_method: 'manual', created_at: '2026-01-01', updated_at: '2026-01-01', deleted_at: null },
];

describe('PickupPointTable', () => {
  it('renders pickup point rows', () => {
    render(<PickupPointTable pickupPoints={mockPoints} isLoading={false} userRole="admin" />);
    expect(screen.getByText('Bodega Central')).toBeDefined();
    expect(screen.getByText('BC-001')).toBeDefined();
    expect(screen.getByText('Easy')).toBeDefined();
  });

  it('shows empty message', () => {
    render(<PickupPointTable pickupPoints={[]} isLoading={false} userRole="admin" />);
    expect(screen.getByText('No hay puntos de retiro')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/admin/PickupPointTable.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// apps/frontend/src/components/admin/PickupPointTable.tsx
'use client';

import { useMemo } from 'react';
import { usePickupPointStore } from '@/lib/stores/pickupPointStore';
import { DataTable, type ColumnDef } from '@/components/data-table/DataTable';
import type { PickupPoint } from '@/lib/api/pickup-points';

interface PickupPointTableProps {
  pickupPoints: PickupPoint[];
  isLoading: boolean;
  userRole: string;
}

export const PickupPointTable = ({ pickupPoints, isLoading, userRole }: PickupPointTableProps) => {
  const { setEditFormOpen, setDeleteConfirmOpen } = usePickupPointStore();

  const columns: ColumnDef<PickupPoint>[] = useMemo(() => [
    { accessorKey: 'name', header: 'Nombre' },
    { accessorKey: 'code', header: 'Código' },
    { accessorKey: 'client_name', header: 'Cliente' },
    {
      accessorKey: 'pickup_locations',
      header: 'Ubicación',
      sortable: false,
      cell: (row) => {
        const loc = row.pickup_locations?.[0];
        return loc ? <span className="text-xs">{loc.address}</span> : <span className="text-xs text-muted-foreground">—</span>;
      },
    },
    {
      accessorKey: 'is_active',
      header: 'Estado',
      cell: (row) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${row.is_active ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'}`}>
          {row.is_active ? 'Activo' : 'Inactivo'}
        </span>
      ),
    },
    {
      accessorKey: 'id',
      header: 'Acciones',
      sortable: false,
      cell: (row) => (
        <div className="flex gap-2">
          <button onClick={() => setEditFormOpen(true, row.id)} className="text-xs text-accent hover:underline">
            Editar
          </button>
          {userRole === 'admin' && (
            <button onClick={() => setDeleteConfirmOpen(true, row.id)} className="text-xs text-[var(--color-status-error)] hover:underline">
              Eliminar
            </button>
          )}
        </div>
      ),
    },
  ], [setEditFormOpen, setDeleteConfirmOpen, userRole]);

  return (
    <DataTable
      columns={columns as unknown as ColumnDef<Record<string, unknown>>[]}
      data={(pickupPoints ?? []) as unknown as Record<string, unknown>[]}
      isLoading={isLoading}
      searchPlaceholder="Buscar por nombre, código o cliente..."
      emptyMessage="No hay puntos de retiro"
    />
  );
};
```

- [ ] **Step 4: Run tests**

Run: `cd apps/frontend && npx vitest run src/components/admin/PickupPointTable.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/admin/PickupPointTable.tsx apps/frontend/src/components/admin/PickupPointTable.test.tsx
git commit -m "feat(spec-33): add PickupPointTable component with tests"
```

### Task 16: PickupPointForm component

**Files:**
- Create: `apps/frontend/src/components/admin/PickupPointForm.tsx`
- Create: `apps/frontend/src/components/admin/PickupPointForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/frontend/src/components/admin/PickupPointForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PickupPointForm } from './PickupPointForm';

vi.mock('@/lib/stores/pickupPointStore', () => ({
  usePickupPointStore: () => ({
    setCreateFormOpen: vi.fn(),
    setEditFormOpen: vi.fn(),
  }),
}));

vi.mock('@/hooks/useClients', () => ({
  useClients: () => ({ data: [{ id: 'c1', name: 'Easy', is_active: true }] }),
}));

vi.mock('@/hooks/usePickupPoints', () => ({
  usePickupPoints: () => ({ data: [] }),
  useCreatePickupPoint: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePickupPoint: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('PickupPointForm', () => {
  it('renders create form with all required fields', () => {
    render(<PickupPointForm mode="create" />);
    expect(screen.getByLabelText('Nombre')).toBeDefined();
    expect(screen.getByLabelText('Código')).toBeDefined();
    expect(screen.getByLabelText('Cliente')).toBeDefined();
    expect(screen.getByLabelText('Nombre de ubicación')).toBeDefined();
    expect(screen.getByLabelText('Dirección')).toBeDefined();
  });

  it('validates required fields on submit', async () => {
    const user = userEvent.setup();
    render(<PickupPointForm mode="create" />);
    await user.click(screen.getByRole('button', { name: /guardar/i }));
    expect(screen.getByText(/nombre.*requerido/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/admin/PickupPointForm.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// apps/frontend/src/components/admin/PickupPointForm.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { usePickupPointStore } from '@/lib/stores/pickupPointStore';
import { useClients } from '@/hooks/useClients';
import { usePickupPoints, useCreatePickupPoint, useUpdatePickupPoint } from '@/hooks/usePickupPoints';

const pickupPointSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  code: z.string().min(1, 'El código es requerido'),
  tenant_client_id: z.string().min(1, 'El cliente es requerido'),
  is_active: z.boolean(),
  location_name: z.string().min(1, 'El nombre de ubicación es requerido'),
  location_address: z.string().min(1, 'La dirección es requerida'),
  location_comuna: z.string().optional(),
  location_contact_name: z.string().optional(),
  location_contact_phone: z.string().optional(),
});

type PickupPointFormValues = z.infer<typeof pickupPointSchema>;

interface PickupPointFormProps {
  mode: 'create' | 'edit';
  pointId?: string;
}

export const PickupPointForm = ({ mode, pointId }: PickupPointFormProps) => {
  const { setCreateFormOpen, setEditFormOpen } = usePickupPointStore();
  const { data: clients } = useClients();
  const { data: points } = usePickupPoints();
  const { mutate: create, isPending: isCreating } = useCreatePickupPoint();
  const { mutate: update, isPending: isUpdating } = useUpdatePickupPoint();

  const existingPoint = mode === 'edit' ? points?.find((p) => p.id === pointId) : null;
  const existingLoc = existingPoint?.pickup_locations?.[0];

  const { register, handleSubmit, formState: { errors } } = useForm<PickupPointFormValues>({
    resolver: zodResolver(pickupPointSchema),
    defaultValues: {
      name: existingPoint?.name ?? '',
      code: existingPoint?.code ?? '',
      tenant_client_id: existingPoint?.tenant_client_id ?? '',
      is_active: existingPoint?.is_active ?? true,
      location_name: existingLoc?.name ?? '',
      location_address: existingLoc?.address ?? '',
      location_comuna: existingLoc?.comuna ?? '',
      location_contact_name: existingLoc?.contact_name ?? '',
      location_contact_phone: existingLoc?.contact_phone ?? '',
    },
  });

  const isPending = isCreating || isUpdating;
  const activeClients = clients?.filter((c) => c.is_active && !c.deleted_at) ?? [];

  const onSubmit = (values: PickupPointFormValues) => {
    const pickup_locations = [{
      name: values.location_name,
      address: values.location_address,
      ...(values.location_comuna && { comuna: values.location_comuna }),
      ...(values.location_contact_name && { contact_name: values.location_contact_name }),
      ...(values.location_contact_phone && { contact_phone: values.location_contact_phone }),
    }];

    if (mode === 'create') {
      create({ name: values.name, code: values.code, tenant_client_id: values.tenant_client_id, pickup_locations }, {
        onSuccess: () => setCreateFormOpen(false),
      });
    } else if (pointId) {
      update({ id: pointId, data: { name: values.name, code: values.code, tenant_client_id: values.tenant_client_id, pickup_locations, is_active: values.is_active } }, {
        onSuccess: () => setEditFormOpen(false),
      });
    }
  };

  const handleClose = () => {
    if (mode === 'create') setCreateFormOpen(false);
    else setEditFormOpen(false);
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) handleClose(); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{mode === 'create' ? 'Nuevo Punto de Retiro' : 'Editar Punto de Retiro'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div>
            <label htmlFor="pp-name" className="block text-sm font-medium mb-1">Nombre</label>
            <input id="pp-name" type="text" {...register('name')} className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground" disabled={isPending} />
            {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor="pp-code" className="block text-sm font-medium mb-1">Código</label>
            <input id="pp-code" type="text" {...register('code')} className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground" disabled={isPending} />
            {errors.code && <p className="text-xs text-destructive mt-1">{errors.code.message}</p>}
          </div>

          <div>
            <label htmlFor="pp-client" className="block text-sm font-medium mb-1">Cliente</label>
            <select id="pp-client" {...register('tenant_client_id')} className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground" disabled={isPending}>
              <option value="">Seleccionar cliente...</option>
              {activeClients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errors.tenant_client_id && <p className="text-xs text-destructive mt-1">{errors.tenant_client_id.message}</p>}
          </div>

          {mode === 'edit' && (
            <div className="flex items-center gap-2">
              <input id="pp-active" type="checkbox" {...register('is_active')} className="rounded" />
              <label htmlFor="pp-active" className="text-sm font-medium">Activo</label>
            </div>
          )}

          {/* Location section */}
          <div className="border border-border rounded-md p-4 space-y-3">
            <h3 className="text-sm font-semibold">Ubicación</h3>

            <div>
              <label htmlFor="loc-name" className="block text-xs font-medium mb-1">Nombre de ubicación</label>
              <input id="loc-name" type="text" {...register('location_name')} className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm" disabled={isPending} />
              {errors.location_name && <p className="text-xs text-destructive mt-1">{errors.location_name.message}</p>}
            </div>

            <div>
              <label htmlFor="loc-address" className="block text-xs font-medium mb-1">Dirección</label>
              <input id="loc-address" type="text" {...register('location_address')} className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm" disabled={isPending} />
              {errors.location_address && <p className="text-xs text-destructive mt-1">{errors.location_address.message}</p>}
            </div>

            <div>
              <label htmlFor="loc-comuna" className="block text-xs font-medium mb-1">Comuna</label>
              <input id="loc-comuna" type="text" {...register('location_comuna')} className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm" disabled={isPending} />
            </div>

            <div>
              <label htmlFor="loc-contact" className="block text-xs font-medium mb-1">Contacto</label>
              <input id="loc-contact" type="text" {...register('location_contact_name')} className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm" disabled={isPending} />
            </div>

            <div>
              <label htmlFor="loc-phone" className="block text-xs font-medium mb-1">Teléfono</label>
              <input id="loc-phone" type="text" {...register('location_contact_phone')} className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm" disabled={isPending} />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={handleClose} disabled={isPending} className="flex-1 px-4 py-2 border border-border rounded-md hover:bg-muted disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={isPending} className="flex-1 px-4 py-2 bg-accent text-accent-foreground rounded-md hover:opacity-90 disabled:opacity-50">
              {isPending ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};
```

- [ ] **Step 4: Run tests**

Run: `cd apps/frontend && npx vitest run src/components/admin/PickupPointForm.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/admin/PickupPointForm.tsx apps/frontend/src/components/admin/PickupPointForm.test.tsx
git commit -m "feat(spec-33): add PickupPointForm component with tests"
```

### Task 17: PickupPointManagement container

**Files:**
- Create: `apps/frontend/src/components/admin/PickupPointManagement.tsx`

- [ ] **Step 1: Create container component**

```typescript
// apps/frontend/src/components/admin/PickupPointManagement.tsx
'use client';

import { usePickupPoints, useDeletePickupPoint } from '@/hooks/usePickupPoints';
import { usePickupPointStore } from '@/lib/stores/pickupPointStore';
import { PickupPointTable } from './PickupPointTable';
import { PickupPointForm } from './PickupPointForm';

interface PickupPointManagementProps {
  userRole: string;
}

export const PickupPointManagement = ({ userRole }: PickupPointManagementProps) => {
  const { data: points, isLoading } = usePickupPoints();
  const { isCreateFormOpen, isEditFormOpen, selectedPickupPointId, isDeleteConfirmOpen, setCreateFormOpen, setDeleteConfirmOpen } = usePickupPointStore();
  const { mutate: deletePoint, isPending: isDeleting } = useDeletePickupPoint();

  const handleDelete = () => {
    if (selectedPickupPointId) {
      deletePoint(selectedPickupPointId, {
        onSuccess: () => setDeleteConfirmOpen(false),
      });
    }
  };

  const selectedPoint = points?.find((p) => p.id === selectedPickupPointId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Puntos de Retiro</h2>
          <p className="text-sm text-muted-foreground mt-1">Crear y administrar puntos de retiro</p>
        </div>
        <button
          onClick={() => setCreateFormOpen(true)}
          className="px-4 py-2 bg-accent text-accent-foreground rounded-md hover:opacity-90 font-medium"
          style={{ minHeight: '44px' }}
        >
          Nuevo Punto de Retiro
        </button>
      </div>

      <PickupPointTable pickupPoints={points || []} isLoading={isLoading} userRole={userRole} />

      {isCreateFormOpen && <PickupPointForm mode="create" />}
      {isEditFormOpen && selectedPickupPointId && <PickupPointForm mode="edit" pointId={selectedPickupPointId} />}

      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-card rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold text-foreground mb-4">Eliminar Punto de Retiro</h2>
            <p className="text-foreground mb-4">
              {'\u00BF'}Estás seguro de que quieres eliminar <strong>{selectedPoint?.name}</strong> ({selectedPoint?.code})?
            </p>
            <div className="bg-[var(--color-status-warning-bg)] border border-[var(--color-status-warning-border)] rounded-md p-4 mb-6">
              <p className="text-sm"><strong>Advertencia:</strong> El punto de retiro será desactivado (soft delete). Esta acción se puede revertir.</p>
            </div>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => setDeleteConfirmOpen(false)} disabled={isDeleting} className="px-4 py-2 border border-border rounded-md hover:bg-muted disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" onClick={handleDelete} disabled={isDeleting} className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:opacity-90 disabled:opacity-50">
                {isDeleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/admin/PickupPointManagement.tsx
git commit -m "feat(spec-33): add PickupPointManagement container component"
```

## Chunk 6: Unified Admin Page + Refactor

### Task 18: Refactor UserManagementPage → UserManagement

**Files:**
- Modify: `apps/frontend/src/components/admin/UserManagementPage.tsx`

- [ ] **Step 1: Rename and remove page-level wrapper**

Rename file to `UserManagement.tsx`. Remove the outer `min-h-screen` and `max-w-7xl` wrappers (those move to AdminPage). Accept `userRole` prop for conditional delete button rendering.

The component becomes:

```typescript
// apps/frontend/src/components/admin/UserManagement.tsx
'use client';

import { useUsers } from '@/hooks/useUsers';
import { useAdminStore } from '@/lib/stores/adminStore';
import { UserListHeader } from './UserListHeader';
import { UserTable } from './UserTable';
import { UserForm } from './UserForm';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

export const UserManagement = () => {
  const { data: users, isLoading } = useUsers();
  const { isCreateFormOpen, isEditFormOpen, selectedUserId } = useAdminStore();

  return (
    <div>
      <UserListHeader />
      <UserTable users={users || []} isLoading={isLoading} />
      {isCreateFormOpen && <UserForm mode="create" />}
      {isEditFormOpen && selectedUserId && <UserForm mode="edit" userId={selectedUserId} />}
      <DeleteConfirmationModal />
    </div>
  );
};
```

- [ ] **Step 2: Update imports in any file that references UserManagementPage**

Search for `UserManagementPage` imports and update to `UserManagement`.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/admin/UserManagement.tsx
git rm apps/frontend/src/components/admin/UserManagementPage.tsx
git commit -m "refactor(spec-33): rename UserManagementPage to UserManagement, remove page wrapper"
```

### Task 19: AdminPage tab container

**Files:**
- Create: `apps/frontend/src/components/admin/AdminPage.tsx`
- Create: `apps/frontend/src/components/admin/AdminPage.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/frontend/src/components/admin/AdminPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminPage } from './AdminPage';

// Mock all management components
vi.mock('./UserManagement', () => ({ UserManagement: () => <div data-testid="user-mgmt" /> }));
vi.mock('./ClientManagement', () => ({ ClientManagement: () => <div data-testid="client-mgmt" /> }));
vi.mock('./PickupPointManagement', () => ({ PickupPointManagement: () => <div data-testid="pp-mgmt" /> }));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('tab=users'),
  useRouter: () => ({ replace: vi.fn() }),
}));

describe('AdminPage', () => {
  it('renders tabs for all three entities', () => {
    render(<AdminPage userRole="admin" />);
    expect(screen.getByRole('tab', { name: /usuarios/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /clientes/i })).toBeDefined();
    expect(screen.getByRole('tab', { name: /puntos de retiro/i })).toBeDefined();
  });

  it('shows users tab by default', () => {
    render(<AdminPage userRole="admin" />);
    expect(screen.getByTestId('user-mgmt')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/components/admin/AdminPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```typescript
// apps/frontend/src/components/admin/AdminPage.tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserManagement } from './UserManagement';
import { ClientManagement } from './ClientManagement';
import { PickupPointManagement } from './PickupPointManagement';
import { useClientStore } from '@/lib/stores/clientStore';
import { usePickupPointStore } from '@/lib/stores/pickupPointStore';
import { useAdminStore } from '@/lib/stores/adminStore';

interface AdminPageProps {
  userRole: string;
}

export const AdminPage = ({ userRole }: AdminPageProps) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get('tab') || 'users';

  const clientStore = useClientStore();
  const pickupPointStore = usePickupPointStore();
  const adminStore = useAdminStore();

  const handleTabChange = (value: string) => {
    // Close all open modals/sheets on tab change
    adminStore.setCreateFormOpen(false);
    adminStore.setEditFormOpen(false);
    adminStore.setDeleteConfirmOpen(false);
    clientStore.resetAll();
    pickupPointStore.resetAll();

    router.replace(`/admin?tab=${value}`);
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-foreground mb-6">Administración</h1>

        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="users">Usuarios</TabsTrigger>
            <TabsTrigger value="clients">Clientes</TabsTrigger>
            <TabsTrigger value="pickup-points">Puntos de Retiro</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="mt-6">
            <UserManagement />
          </TabsContent>

          <TabsContent value="clients" className="mt-6">
            <ClientManagement userRole={userRole} />
          </TabsContent>

          <TabsContent value="pickup-points" className="mt-6">
            <PickupPointManagement userRole={userRole} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Run tests**

Run: `cd apps/frontend && npx vitest run src/components/admin/AdminPage.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/admin/AdminPage.tsx apps/frontend/src/components/admin/AdminPage.test.tsx
git commit -m "feat(spec-33): add AdminPage tab container with tests"
```

### Task 20: Admin page route + redirect

**Files:**
- Create: `apps/frontend/src/app/admin/page.tsx` (new unified page)
- Modify: `apps/frontend/src/app/admin/users/page.tsx` (redirect to new route)

- [ ] **Step 1: Create unified admin page**

```typescript
// apps/frontend/src/app/admin/page.tsx
import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';
import { AdminPage } from '@/components/admin/AdminPage';

export default async function AdminRoute() {
  const supabase = await createSSRClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  const userRole = session.user.app_metadata?.claims?.role;

  if (userRole !== 'admin' && userRole !== 'operations_manager') {
    redirect('/?error=unauthorized');
  }

  return <AdminPage userRole={userRole} />;
}

export const metadata = {
  title: 'Administración | Aureon Last Mile',
  description: 'Manage users, clients, and pickup points',
};
```

- [ ] **Step 2: Update old users route to redirect**

```typescript
// apps/frontend/src/app/admin/users/page.tsx
import { redirect } from 'next/navigation';

export default function AdminUsersRedirect() {
  redirect('/admin?tab=users');
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/app/admin/page.tsx apps/frontend/src/app/admin/users/page.tsx
git commit -m "feat(spec-33): add unified admin page route, redirect old /admin/users"
```

### Task 21: Run full test suite and verify

- [ ] **Step 1: Run all admin-related tests**

Run: `cd apps/frontend && npx vitest run src/components/admin/`
Expected: All tests pass

- [ ] **Step 2: Run full frontend test suite**

Run: `cd apps/frontend && npx vitest run`
Expected: All tests pass (no regressions)

- [ ] **Step 3: Start dev server and manually verify**

Run: `cd apps/frontend && npm run dev`

Verify:
- `/admin` loads with tabs (Users, Clients, Pickup Points)
- `/admin/users` redirects to `/admin?tab=users`
- Each tab renders its management component
- Tab switching updates URL and closes modals
- CRUD operations work for each entity

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git commit -m "fix(spec-33): address any issues found during verification"
```
