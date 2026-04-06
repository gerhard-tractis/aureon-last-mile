# Spec-20: Camera Intake — Cascading Client / Pickup Point Dropdowns

> **Status:** backlog
> **Depends on:** spec-19 (pickup visual polish — must land first so we build on shadcn Dialog/Select, Spanish strings)

## Goal

Replace the single flat "generator" dropdown in the Camera Intake modal with two cascading dropdowns: **Client** then **Pickup Point**. This makes the flow intuitive — operators pick the retailer first, then the specific location — instead of choosing from a flat list of opaque "generators".

## Context

- The `generators` table (agent suite data model) represents pickup point configurations, each linked to a `tenant_client` via `tenant_client_id`.
- One client can have multiple generators (e.g., "Easy" has "Easy Maipu", "Easy Puente Alto").
- The current `CameraIntake` component fetches generators directly, showing a single dropdown. With zero generators configured, the modal was a dead end (fixed with empty state in this branch).
- The `useTenantClients` hook already exists and fetches clients for the operator.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auto-select when single option | No | Prevents silent mis-routing when a new pickup point is added but not yet configured |
| Show clients with zero generators | Yes (option A) | Makes the gap visible so someone reports it, rather than hiding the client |
| New hook for generators-by-client | Yes (`useGeneratorsByClient`) | Clean separation, React Query cache per client |
| Schema changes | None | Existing `tenant_clients` → `generators.tenant_client_id` relationship is sufficient |

## Changes

### 1. New Hook: `useGeneratorsByClient`

**File:** `apps/frontend/src/hooks/pickup/useGeneratorsByClient.ts`

React Query hook that fetches generators filtered by `operator_id` + `tenant_client_id`:

```ts
interface Generator {
  id: string;
  name: string;
}

function useGeneratorsByClient(operatorId: string | null, clientId: string | null)
  → UseQueryResult<Generator[]>
```

- Query key: `['generators', operatorId, clientId]`
- Enabled only when both `operatorId` and `clientId` are truthy
- Filters: `is_active = true`, `deleted_at IS NULL`
- Ordered by `name`

### 2. Update `CameraIntake` Component

**File:** `apps/frontend/src/components/pickup/CameraIntake.tsx`

**Assumes spec-19 has landed:** modal uses shadcn `Dialog`, selects use shadcn `Select`, all strings are Spanish.

#### State

| State | Type | Default | Purpose |
|-------|------|---------|---------|
| `selectedClientId` | `string` | `''` | Selected tenant client |
| `selectedGeneratorId` | `string` | `''` | Selected pickup point (generator) |

Remove: `generators` state array, `loadingGenerators` state, manual Supabase `useEffect` fetch.

Replace with: `useTenantClients(operatorId)` + `useGeneratorsByClient(operatorId, selectedClientId)`.

#### UI Flow (idle state)

```
┌─────────────────────────────────────────┐
│  Nuevo Manifiesto                    X  │
│                                         │
│  Cliente                                │
│  ┌─────────────────────────────────┐    │
│  │ Selecciona un cliente        ▾  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Punto de retiro                        │
│  ┌─────────────────────────────────┐    │
│  │ Selecciona un punto de retiro▾  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │         Tomar foto              │    │
│  └─────────────────────────────────┘    │
│                                         │
│            Cancelar                     │
└─────────────────────────────────────────┘
```

#### Behavior

1. Modal opens → `useTenantClients` fetches clients (shows spinner while loading)
2. **Dropdown 1 — Cliente:** Placeholder "Selecciona un cliente". Lists all clients for operator regardless of generator count.
3. On client change → reset `selectedGeneratorId` to `''`. `useGeneratorsByClient` triggers fetch.
4. **Dropdown 2 — Punto de retiro:** Placeholder "Selecciona un punto de retiro". Disabled until a client is selected.
   - While loading generators: show inline spinner in dropdown area
   - Zero generators for client: show "No hay puntos de retiro configurados para este cliente" below dropdown 2, camera button stays disabled
   - Generators available: populate dropdown 2
5. **Tomar foto button:** Enabled only when `selectedGeneratorId` is non-empty.
6. Photo submission: calls `submit(file, selectedGeneratorId)` — unchanged from current flow.

#### Empty States

| Condition | Display |
|-----------|---------|
| Loading clients | Spinner + "Cargando clientes..." |
| Zero clients | "Sin clientes configurados" + "Configura al menos un cliente para crear manifiestos con camara." + Cerrar button |
| Client selected, loading generators | Inline spinner below dropdown 2 |
| Client selected, zero generators | "No hay puntos de retiro configurados para este cliente" below dropdown 2 |

### 3. i18n Updates

**File:** `apps/frontend/src/lib/i18n/es.ts`

| Key | Value |
|-----|-------|
| `pickup.select_client` | `Selecciona un cliente` |
| `pickup.select_pickup_point` | `Selecciona un punto de retiro` |
| `pickup.label_client` | `Cliente` |
| `pickup.label_pickup_point` | `Punto de retiro` |
| `pickup.no_clients` | `Sin clientes configurados` |
| `pickup.no_clients_hint` | `Configura al menos un cliente para crear manifiestos con camara.` |
| `pickup.no_pickup_points` | `No hay puntos de retiro configurados para este cliente` |
| `pickup.loading_clients` | `Cargando clientes...` |

Remove: `pickup.select_generator`

### 4. Test Plan

**File:** `apps/frontend/src/components/pickup/CameraIntake.test.tsx`

| Test | Assertion |
|------|-----------|
| Renders client dropdown after load | `combobox` with client names visible |
| Pickup point dropdown disabled until client selected | dropdown 2 disabled / placeholder only |
| Selecting client fetches and shows generators | dropdown 2 populates with generator names |
| Changing client resets generator selection | `selectedGeneratorId` clears, dropdown 2 resets |
| Camera button disabled until generator selected | button has `disabled` attribute |
| Camera button enabled after generator selected | button clickable, calls `submit` with correct `generatorId` |
| Shows empty state when zero clients | "Sin clientes configurados" message + close button |
| Shows message when client has zero generators | "No hay puntos de retiro configurados" visible |

**File:** `apps/frontend/src/hooks/pickup/useGeneratorsByClient.test.ts`

| Test | Assertion |
|------|-----------|
| Fetches generators for given client | Correct Supabase query with filters |
| Returns empty array when no generators | `data` is `[]` |
| Disabled when clientId is null | Query does not execute |

## Acceptance Criteria

- [ ] Client dropdown shows all `tenant_clients` for the operator
- [ ] Pickup point dropdown shows `generators` filtered by selected client
- [ ] Changing client resets pickup point selection
- [ ] Camera button only enabled when both client and pickup point are selected
- [ ] Zero clients shows "Sin clientes configurados" with close button
- [ ] Client with zero generators shows "No hay puntos de retiro" message
- [ ] No auto-selection — user must explicitly pick both values
- [ ] `useCameraIntake.submit()` still receives the correct `generatorId`
- [ ] All Vitest tests pass
- [ ] TypeScript compiles (`tsc --noEmit`)
