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
