# Dispatch Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Dispatch Module — the final hub step where operators scan packages into routes, select a truck, close the route, and push it to DispatchTrack so drivers can start delivering.

**Architecture:** Single-page tablet-optimized route builder (landscape, 56px touch targets). Split-panel layout: left = scan input + package list, right = truck selector + action buttons. Five API route handlers call Supabase directly and one calls the DispatchTrack REST API. All mutations follow the existing hook → server action pattern from the distribution module.

**Tech Stack:** Next.js 15 App Router, Supabase (RLS), TypeScript, Tailwind CSS, shadcn/ui, TanStack React Query, Vitest, Playwright

---

## File Map

```
packages/database/supabase/migrations/
  20260324000001_dispatch_module.sql          ← Enum changes only

apps/frontend/src/
  lib/
    dispatchtrack-api.ts                      ← DT HTTP client (pure function, no Supabase)
    dispatch/
      scan-validator.ts                       ← Smart lookup + status validation logic
      types.ts                               ← Shared TypeScript types for dispatch domain

  app/api/dispatch/routes/
    route.ts                                  ← POST /api/dispatch/routes (create route)
    [id]/
      scan/route.ts                          ← POST /api/dispatch/routes/[id]/scan
      close/route.ts                         ← POST /api/dispatch/routes/[id]/close
      dispatch/route.ts                      ← POST /api/dispatch/routes/[id]/dispatch
      packages/[pkgId]/route.ts              ← DELETE /api/dispatch/routes/[id]/packages/[pkgId]

  hooks/dispatch/
    useDispatchRoutes.ts                     ← List today's draft routes for operator
    useScanPackage.ts                        ← Mutation: scan code into route
    useRoutePackages.ts                      ← List packages in a route

  components/dispatch/
    RouteListTile.tsx                        ← One tile in the route list grid
    ScanZone.tsx                             ← Scan input with pulse indicator
    PackageRow.tsx                           ← Single scanned package row
    RoutePanel.tsx                           ← Right side panel (truck, stats, actions)
    RouteBuilder.tsx                         ← Composes ScanZone + PackageRow + RoutePanel

  app/app/dispatch/
    layout.tsx                               ← Permission guard (needs 'dispatch' permission)
    page.tsx                                 ← Route list screen
    [routeId]/
      page.tsx                               ← Route builder screen
```

---

## Chunk 1: Database Migration + TypeScript Types

### Task 1: Write and apply the migration

**Files:**
- Create: `packages/database/supabase/migrations/20260324000001_dispatch_module.sql`

> **Before starting:** Run on production DB and verify both return 0:
> ```sql
> SELECT COUNT(*) FROM packages WHERE status = 'listo';
> SELECT COUNT(*) FROM orders WHERE status = 'listo';
> ```

- [ ] **Step 1: Write the migration**

```sql
-- packages/database/supabase/migrations/20260324000001_dispatch_module.sql

-- 1. Add 'draft' to route_status_enum (before 'planned')
-- NOTE: PostgreSQL does not support BEFORE/AFTER in ADD VALUE for all versions.
-- We add it and accept it will appear after existing values in pg_enum ordering.
-- The application code uses explicit string values, not ordinal positions.
ALTER TYPE public.route_status_enum ADD VALUE IF NOT EXISTS 'draft';

-- 2. Rename 'listo' → 'listo_para_despacho' in both enums
-- IMPORTANT: Run the pre-condition checks above before this.
ALTER TYPE public.order_status_enum RENAME VALUE 'listo' TO 'listo_para_despacho';
ALTER TYPE public.package_status_enum RENAME VALUE 'listo' TO 'listo_para_despacho';
```

- [ ] **Step 2: Apply migration locally**

```bash
cd apps/frontend
npx supabase db push --local
```

Expected output: `Applying migration 20260324000001_dispatch_module.sql... done`

- [ ] **Step 3: Verify in local DB**

```bash
npx supabase db diff
```

Expected: no diff (migration applied cleanly)

- [ ] **Step 4: Commit**

```bash
git add packages/database/supabase/migrations/20260324000001_dispatch_module.sql
git commit -m "feat(dispatch): add draft route status + rename listo_para_despacho"
```

---

### Task 2: TypeScript types for dispatch domain

**Files:**
- Create: `apps/frontend/src/lib/dispatch/types.ts`

- [ ] **Step 1: Write types**

```typescript
// apps/frontend/src/lib/dispatch/types.ts

export type RouteStatus = 'draft' | 'planned' | 'in_progress' | 'completed' | 'cancelled';
export type PackageStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo_para_despacho' | 'en_ruta' | 'entregado' | 'cancelado';

export interface DispatchRoute {
  id: string;
  operator_id: string;
  external_route_id: string | null;
  route_date: string;           // ISO date YYYY-MM-DD
  driver_name: string | null;
  vehicle_id: string | null;
  truck_identifier: string | null;
  status: RouteStatus;
  planned_stops: number;
  completed_stops: number;
  created_at: string;
}

export interface RoutePackage {
  dispatch_id: string;          // dispatches.id
  order_id: string;
  order_number: string;
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  package_status: PackageStatus;
}

export interface FleetVehicle {
  id: string;
  external_vehicle_id: string;
  plate_number: string | null;
  driver_name: string | null;
  vehicle_type: string | null;
}

export interface ScanResult {
  ok: true;
  package: RoutePackage;
} | {
  ok: false;
  message: string;
  code: 'NOT_FOUND' | 'WRONG_STATUS' | 'ALREADY_IN_ROUTE';
}
```

- [ ] **Step 2: No runtime behavior — no test needed. Commit.**

```bash
git add apps/frontend/src/lib/dispatch/types.ts
git commit -m "feat(dispatch): add dispatch domain TypeScript types"
```

---

## Chunk 2: DT API Client + Scan Validator

### Task 3: DispatchTrack API client (TDD)

**Files:**
- Create: `apps/frontend/src/lib/dispatchtrack-api.ts`
- Create: `apps/frontend/src/lib/dispatchtrack-api.test.ts`

The DT API endpoint is `POST https://activationcode.dispatchtrack.com/api/external/v1/routes`.
Auth header: `X-AUTH-TOKEN: {DT_API_KEY}`.
Date format: `DD-MM-YYYY` (not ISO-8601 — DT-specific).

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/frontend/src/lib/dispatchtrack-api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDTRoute, type DTRoutePayload } from './dispatchtrack-api';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

const payload: DTRoutePayload = {
  truck_identifier: 'ZALDUENDO',
  route_date: '2026-03-24',        // ISO — client converts to DD-MM-YYYY
  driver_identifier: null,
  dispatches: [
    {
      identifier: 4821,
      contact_name: 'Mario González',
      contact_address: 'Av. Providencia 1234',
      contact_phone: '+56912345678',
      contact_email: null,
      current_state: 1,
    },
  ],
};

describe('createDTRoute', () => {
  it('converts ISO date to DD-MM-YYYY before sending', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 164972 } }),
    });
    await createDTRoute(payload, 'test-token');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.date).toBe('24-03-2026');
  });

  it('sends X-AUTH-TOKEN header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute(payload, 'my-secret-token');
    expect(mockFetch.mock.calls[0][1].headers['X-AUTH-TOKEN']).toBe('my-secret-token');
  });

  it('returns external_route_id on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 164972 } }),
    });
    const result = await createDTRoute(payload, 'token');
    expect(result.external_route_id).toBe('164972');
  });

  it('throws with DT error message on non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ status: 'Bad_request', response: 'Permission denied' }),
    });
    await expect(createDTRoute(payload, 'token')).rejects.toThrow('Permission denied');
  });

  it('omits driver_identifier when null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', response: { route_id: 1 } }),
    });
    await createDTRoute({ ...payload, driver_identifier: null }, 'token');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.driver_identifier).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/frontend
npm run test:run -- --reporter=verbose src/lib/dispatchtrack-api.test.ts
```

Expected: `FAIL — Cannot find module './dispatchtrack-api'`

- [ ] **Step 3: Implement the client**

```typescript
// apps/frontend/src/lib/dispatchtrack-api.ts

export interface DTDispatch {
  identifier: number;           // order number / guide number
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  current_state: 0 | 1;         // 0=in_preparation, 1=ready_to_go
}

export interface DTRoutePayload {
  truck_identifier: string;
  route_date: string;           // ISO YYYY-MM-DD — converted internally to DD-MM-YYYY
  driver_identifier: string | null;
  dispatches: DTDispatch[];
}

export interface DTRouteResult {
  external_route_id: string;
}

function toDateDMY(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${dd}-${mm}-${yyyy}`;
}

export async function createDTRoute(
  payload: DTRoutePayload,
  apiToken: string,
): Promise<DTRouteResult> {
  const body: Record<string, unknown> = {
    truck_identifier: payload.truck_identifier,
    date: toDateDMY(payload.route_date),
    dispatches: payload.dispatches,
  };

  if (payload.driver_identifier) {
    body.driver_identifier = payload.driver_identifier;
  }

  const response = await fetch(
    'https://activationcode.dispatchtrack.com/api/external/v1/routes',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AUTH-TOKEN': apiToken,
      },
      body: JSON.stringify(body),
    },
  );

  const json = await response.json();

  if (!response.ok) {
    const message = typeof json?.response === 'string'
      ? json.response
      : `DT API error ${response.status}`;
    throw new Error(message);
  }

  return { external_route_id: String(json.response.route_id) };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm run test:run -- --reporter=verbose src/lib/dispatchtrack-api.test.ts
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/dispatchtrack-api.ts apps/frontend/src/lib/dispatchtrack-api.test.ts
git commit -m "feat(dispatch): add DispatchTrack API client with DD-MM-YYYY date conversion"
```

---

### Task 4: Scan validator (TDD)

**Files:**
- Create: `apps/frontend/src/lib/dispatch/scan-validator.ts`
- Create: `apps/frontend/src/lib/dispatch/scan-validator.test.ts`

Smart lookup: try `packages.barcode` first, fallback to `orders.order_number`. Validates status = `asignado`, not already in an active route.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/frontend/src/lib/dispatch/scan-validator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateScan } from './scan-validator';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

// Helper to build a chainable Supabase mock
function mockQuery(returnValue: { data: unknown; error: null | { message: string } }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(returnValue),
    single: vi.fn().mockResolvedValue(returnValue),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

describe('validateScan', () => {
  beforeEach(() => mockFrom.mockReset());

  it('returns NOT_FOUND when no package or order matches', async () => {
    mockQuery({ data: [], error: null });
    const result = await validateScan({
      code: 'UNKNOWN-999',
      routeId: 'route-1',
      operatorId: 'op-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('returns WRONG_STATUS when package is not asignado', async () => {
    mockQuery({ data: [{ id: 'pkg-1', status: 'en_bodega', order_id: 'ord-1' }], error: null });
    const result = await validateScan({ code: 'BARCODE-1', routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_STATUS');
  });

  it('returns ok:true with package details when valid', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{
            id: 'pkg-1',
            status: 'asignado',
            order_id: 'ord-1',
            orders: {
              order_number: 'ORD-4821',
              contact_name: 'Mario',
              contact_address: 'Providencia',
              contact_phone: '+569',
            },
          }],
          error: null,
        }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

    const result = await validateScan({ code: 'BARCODE-1', routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.package.order_number).toBe('ORD-4821');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test:run -- --reporter=verbose src/lib/dispatch/scan-validator.test.ts
```

Expected: `FAIL — Cannot find module './scan-validator'`

- [ ] **Step 3: Implement the validator**

```typescript
// apps/frontend/src/lib/dispatch/scan-validator.ts
import { createSPAClient } from '@/lib/supabase/client';
import type { ScanResult, RoutePackage } from './types';

interface ScanInput {
  code: string;
  routeId: string;
  operatorId: string;
}

export async function validateScan(input: ScanInput): Promise<ScanResult> {
  const { code, routeId, operatorId } = input;
  const supabase = createSPAClient();

  // 1. Lookup by package barcode first, then order_number
  const { data: pkgs } = await supabase
    .from('packages')
    .select('id, status, order_id, orders(order_number, contact_name, contact_address, contact_phone)')
    .eq('operator_id', operatorId)
    .eq('barcode', code)
    .is('deleted_at', null)
    .limit(1);

  let found = pkgs?.[0] ?? null;

  // 2. Fallback: lookup by order number
  if (!found) {
    const { data: orders } = await supabase
      .from('packages')
      .select('id, status, order_id, orders!inner(order_number, contact_name, contact_address, contact_phone)')
      .eq('operator_id', operatorId)
      .eq('orders.order_number', code)
      .is('deleted_at', null)
      .limit(1);

    found = orders?.[0] ?? null;
  }

  if (!found) {
    return { ok: false, message: 'Código no encontrado', code: 'NOT_FOUND' };
  }

  // 3. Validate status
  if (found.status !== 'asignado') {
    return {
      ok: false,
      message: `Paquete en estado incorrecto (estado: ${found.status})`,
      code: 'WRONG_STATUS',
    };
  }

  // 4. Check not already in another active route
  const { data: existing } = await supabase
    .from('dispatches')
    .select('id, route_id')
    .eq('operator_id', operatorId)
    .eq('order_id', found.order_id)
    .is('deleted_at', null)
    .limit(1);

  if (existing && existing.length > 0) {
    return {
      ok: false,
      message: `Paquete ya asignado a otra ruta activa`,
      code: 'ALREADY_IN_ROUTE',
    };
  }

  const order = Array.isArray(found.orders) ? found.orders[0] : found.orders;

  const pkg: RoutePackage = {
    dispatch_id: '',              // filled after insert
    order_id: found.order_id,
    order_number: order?.order_number ?? code,
    contact_name: order?.contact_name ?? null,
    contact_address: order?.contact_address ?? null,
    contact_phone: order?.contact_phone ?? null,
    package_status: 'en_carga',
  };

  return { ok: true, package: pkg };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test:run -- --reporter=verbose src/lib/dispatch/scan-validator.test.ts
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/dispatch/
git commit -m "feat(dispatch): add scan validator with barcode/order smart lookup"
```

---

## Chunk 3: API Route Handlers

All handlers live under `apps/frontend/src/app/api/dispatch/routes/`.
Auth pattern: `createSSRClient` → `getSession()` → check session → check `operator_id`.

### Task 5: POST /routes — create route

**Files:**
- Create: `apps/frontend/src/app/api/dispatch/routes/route.ts`

- [ ] **Step 1: Write the handler**

```typescript
// apps/frontend/src/app/api/dispatch/routes/route.ts
import { createSSRClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) {
      return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) {
      return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });
    }

    const today = new Date().toISOString().split('T')[0];   // YYYY-MM-DD

    const { data: route, error } = await supabase
      .from('routes')
      .insert({
        operator_id: operatorId,
        provider: 'dispatchtrack',
        route_date: today,
        status: 'draft',
        planned_stops: 0,
        completed_stops: 0,
      })
      .select('id, status, route_date, created_at')
      .single();

    if (error) throw error;

    return NextResponse.json(route, { status: 201 });
  } catch (err) {
    console.error('[dispatch/routes POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/api/dispatch/routes/route.ts
git commit -m "feat(dispatch): POST /api/dispatch/routes — create draft route"
```

---

### Task 6: POST /routes/[id]/scan — scan package into route

**Files:**
- Create: `apps/frontend/src/app/api/dispatch/routes/[id]/scan/route.ts`

- [ ] **Step 1: Write the handler**

```typescript
// apps/frontend/src/app/api/dispatch/routes/[id]/scan/route.ts
import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateScan } from '@/lib/dispatch/scan-validator';

const bodySchema = z.object({ code: z.string().min(1) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) {
      return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const { id: routeId } = await params;
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Validate the scanned code
    const validation = await validateScan({ code: parsed.data.code, routeId, operatorId });
    if (!validation.ok) {
      return NextResponse.json({ code: validation.code, message: validation.message }, { status: 422 });
    }

    // Create dispatch record linking order → route
    const { data: dispatch, error: dispatchError } = await supabase
      .from('dispatches')
      .insert({
        operator_id: operatorId,
        route_id: routeId,
        order_id: validation.package.order_id,
        provider: 'dispatchtrack',
        status: 'pending',
      })
      .select('id')
      .single();
    if (dispatchError) throw dispatchError;

    // Update package status → en_carga
    const { error: pkgError } = await supabase
      .from('packages')
      .update({ status: 'en_carga' })
      .eq('operator_id', operatorId)
      .eq('order_id', validation.package.order_id)
      .eq('status', 'asignado');
    if (pkgError) throw pkgError;

    // Increment route planned_stops
    await supabase.rpc('increment_route_stops', { p_route_id: routeId });

    return NextResponse.json(
      { ...validation.package, dispatch_id: dispatch.id },
      { status: 201 },
    );
  } catch (err) {
    console.error('[dispatch/scan POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
```

> **Note:** `increment_route_stops` is a simple RPC that does `UPDATE routes SET planned_stops = planned_stops + 1 WHERE id = p_route_id`. If it doesn't exist yet, replace with a direct update: `supabase.from('routes').update({ planned_stops: supabase.rpc('...') })`. Simplest approach: just call a second SELECT+UPDATE if RPC is missing.

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/api/dispatch/routes/[id]/scan/route.ts
git commit -m "feat(dispatch): POST /routes/[id]/scan — validate and add package to route"
```

---

### Task 7: POST /routes/[id]/close — close route

**Files:**
- Create: `apps/frontend/src/app/api/dispatch/routes/[id]/close/route.ts`

- [ ] **Step 1: Write the handler**

```typescript
// apps/frontend/src/app/api/dispatch/routes/[id]/close/route.ts
import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const { id: routeId } = await params;

    // Verify route exists, belongs to operator, is in draft status
    const { data: route, error: routeError } = await supabase
      .from('routes')
      .select('id, status, planned_stops')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();
    if (routeError || !route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    if (route.status !== 'draft') {
      return NextResponse.json({ code: 'INVALID_STATE', message: 'Route is not in draft status' }, { status: 409 });
    }
    if (route.planned_stops === 0) {
      return NextResponse.json({ code: 'EMPTY_ROUTE', message: 'Cannot close an empty route' }, { status: 422 });
    }

    // Get all orders in this route
    const { data: dispatches, error: dispError } = await supabase
      .from('dispatches')
      .select('order_id')
      .eq('route_id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null);
    if (dispError) throw dispError;

    const orderIds = (dispatches ?? []).map((d) => d.order_id);

    // Atomically flip all packages → listo_para_despacho
    if (orderIds.length > 0) {
      const { error: pkgError } = await supabase
        .from('packages')
        .update({ status: 'listo_para_despacho' })
        .eq('operator_id', operatorId)
        .eq('status', 'en_carga')
        .in('order_id', orderIds);
      if (pkgError) throw pkgError;
    }

    return NextResponse.json({ ok: true, packages_closed: orderIds.length }, { status: 200 });
  } catch (err) {
    console.error('[dispatch/close POST]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/api/dispatch/routes/[id]/close/route.ts
git commit -m "feat(dispatch): POST /routes/[id]/close — flip packages to listo_para_despacho"
```

---

### Task 8: POST /routes/[id]/dispatch — dispatch to DT

**Files:**
- Create: `apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts`

This is the critical endpoint. Calls DT API. Only updates local state AFTER DT confirms success.

- [ ] **Step 1: Write the handler**

```typescript
// apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts
import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDTRoute, type DTDispatch } from '@/lib/dispatchtrack-api';

const bodySchema = z.object({
  truck_identifier: z.string().min(1),
  driver_identifier: z.string().nullable().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const { id: routeId } = await params;
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ code: 'VALIDATION_ERROR' }, { status: 400 });

    // Fetch route
    const { data: route } = await supabase
      .from('routes')
      .select('id, status, route_date')
      .eq('id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();
    if (!route) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
    if (route.status !== 'draft') {
      return NextResponse.json({ code: 'INVALID_STATE' }, { status: 409 });
    }

    // Fetch dispatches + order details
    const { data: dispatches, error: dErr } = await supabase
      .from('dispatches')
      .select('id, order_id, orders(order_number, contact_name, contact_address, contact_phone, contact_email)')
      .eq('route_id', routeId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null);
    if (dErr) throw dErr;
    if (!dispatches?.length) {
      return NextResponse.json({ code: 'EMPTY_ROUTE' }, { status: 422 });
    }

    // Build DT payload
    const dtDispatches: DTDispatch[] = dispatches.map((d) => {
      const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
      return {
        identifier: parseInt(ord?.order_number?.replace(/\D/g, '') ?? '0', 10),
        contact_name: ord?.contact_name ?? null,
        contact_address: ord?.contact_address ?? null,
        contact_phone: ord?.contact_phone ?? null,
        contact_email: ord?.contact_email ?? null,
        current_state: 1,
      };
    });

    const apiToken = process.env.DT_API_KEY;
    if (!apiToken) throw new Error('DT_API_KEY not configured');

    // Call DT API — if this throws, nothing local changes
    const { external_route_id } = await createDTRoute({
      truck_identifier: parsed.data.truck_identifier,
      route_date: route.route_date,
      driver_identifier: parsed.data.driver_identifier ?? null,
      dispatches: dtDispatches,
    }, apiToken);

    // DT confirmed — now update local state
    const orderIds = dispatches.map((d) => d.order_id);

    await Promise.all([
      // Route → planned + store DT route ID
      supabase
        .from('routes')
        .update({ status: 'planned', external_route_id })
        .eq('id', routeId)
        .eq('operator_id', operatorId),

      // Packages → en_ruta
      supabase
        .from('packages')
        .update({ status: 'en_ruta' })
        .eq('operator_id', operatorId)
        .in('order_id', orderIds),
    ]);

    // Audit log
    await supabase.from('audit_logs').insert({
      operator_id: operatorId,
      user_id: session.user.id,
      action: 'dispatch_route',
      metadata: {
        route_id: routeId,
        external_route_id,
        packages_count: dispatches.length,
        truck_identifier: parsed.data.truck_identifier,
      },
    });

    return NextResponse.json({ ok: true, external_route_id, packages_dispatched: dispatches.length }, { status: 200 });
  } catch (err) {
    // DT API failure — log but don't change local state
    const supabase = await createSSRClient();
    await supabase.from('audit_logs').insert({
      action: 'dispatch_failed',
      metadata: {
        route_id: (await params).id,
        dt_error: String(err),
      },
    }).catch(() => null); // don't fail if audit also fails

    console.error('[dispatch/dispatch POST]', err);
    const message = err instanceof Error ? err.message : 'DT API error';
    return NextResponse.json({ code: 'DT_API_ERROR', message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/api/dispatch/routes/[id]/dispatch/route.ts
git commit -m "feat(dispatch): POST /routes/[id]/dispatch — call DT API then update local state"
```

---

### Task 9: DELETE /routes/[id]/packages/[pkgId] — remove package

**Files:**
- Create: `apps/frontend/src/app/api/dispatch/routes/[id]/packages/[pkgId]/route.ts`

- [ ] **Step 1: Write the handler**

```typescript
// apps/frontend/src/app/api/dispatch/routes/[id]/packages/[pkgId]/route.ts
import { createSSRClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; pkgId: string }> },
) {
  try {
    const supabase = await createSSRClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session) return NextResponse.json({ code: 'UNAUTHORIZED' }, { status: 401 });

    const operatorId: string | undefined = session.user.app_metadata?.claims?.operator_id;
    if (!operatorId) return NextResponse.json({ code: 'NO_OPERATOR' }, { status: 403 });

    const { pkgId: dispatchId } = await params;

    // Find the dispatch record
    const { data: dispatch } = await supabase
      .from('dispatches')
      .select('id, order_id, route_id')
      .eq('id', dispatchId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single();
    if (!dispatch) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });

    // Soft delete the dispatch record
    const { error: delError } = await supabase
      .from('dispatches')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', dispatchId)
      .eq('operator_id', operatorId);
    if (delError) throw delError;

    // Revert package status → asignado
    await supabase
      .from('packages')
      .update({ status: 'asignado' })
      .eq('operator_id', operatorId)
      .eq('order_id', dispatch.order_id)
      .eq('status', 'en_carga');

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[dispatch/packages DELETE]', err);
    return NextResponse.json({ code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/app/api/dispatch/routes/[id]/packages/[pkgId]/route.ts
git commit -m "feat(dispatch): DELETE /routes/[id]/packages/[pkgId] — remove package, revert to asignado"
```

---

## Chunk 4: Hooks

### Task 10: useDispatchRoutes — list today's draft routes (TDD)

**Files:**
- Create: `apps/frontend/src/hooks/dispatch/useDispatchRoutes.ts`
- Create: `apps/frontend/src/hooks/dispatch/useDispatchRoutes.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/frontend/src/hooks/dispatch/useDispatchRoutes.test.ts
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDispatchRoutes } from './useDispatchRoutes';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useDispatchRoutes', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useDispatchRoutes(null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns routes on success', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: [{ id: 'r1', status: 'draft', planned_stops: 5 }], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(() => useDispatchRoutes('op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].status).toBe('draft');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test:run -- --reporter=verbose src/hooks/dispatch/useDispatchRoutes.test.ts
```

- [ ] **Step 3: Implement the hook**

```typescript
// apps/frontend/src/hooks/dispatch/useDispatchRoutes.ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { DispatchRoute } from '@/lib/dispatch/types';

export function useDispatchRoutes(operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'routes', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('routes')
        .select('id, status, route_date, driver_name, vehicle_id, planned_stops, completed_stops, created_at, external_route_id')
        .eq('operator_id', operatorId!)
        .in('status', ['draft', 'planned'])
        .eq('route_date', today)
        .is('deleted_at', null);
      if (error) throw error;
      return data as DispatchRoute[];
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test:run -- --reporter=verbose src/hooks/dispatch/useDispatchRoutes.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/dispatch/
git commit -m "feat(dispatch): add useDispatchRoutes hook"
```

---

### Task 11: useScanPackage + useRoutePackages hooks (TDD)

**Files:**
- Create: `apps/frontend/src/hooks/dispatch/useScanPackage.ts`
- Create: `apps/frontend/src/hooks/dispatch/useRoutePackages.ts`
- Create: `apps/frontend/src/hooks/dispatch/useScanPackage.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/frontend/src/hooks/dispatch/useScanPackage.test.ts
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useScanPackage } from './useScanPackage';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useScanPackage', () => {
  it('exposes a mutateAsync function', () => {
    const { result } = renderHook(() => useScanPackage('route-1'), { wrapper: wrapper() });
    expect(typeof result.current.mutateAsync).toBe('function');
  });

  it('calls POST /api/dispatch/routes/[id]/scan with code', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ dispatch_id: 'd1', order_number: 'ORD-1', ok: true }),
    });
    const { result } = renderHook(() => useScanPackage('route-99'), { wrapper: wrapper() });
    await result.current.mutateAsync('BARCODE-1');
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/dispatch/routes/route-99/scan',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test:run -- --reporter=verbose src/hooks/dispatch/useScanPackage.test.ts
```

- [ ] **Step 3: Implement the hooks**

```typescript
// apps/frontend/src/hooks/dispatch/useScanPackage.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RoutePackage } from '@/lib/dispatch/types';

export function useScanPackage(routeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<RoutePackage> => {
      const res = await fetch(`/api/dispatch/routes/${routeId}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) throw { code: json.code, message: json.message };
      return json as RoutePackage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dispatch', 'packages', routeId] });
    },
  });
}
```

```typescript
// apps/frontend/src/hooks/dispatch/useRoutePackages.ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { RoutePackage } from '@/lib/dispatch/types';

export function useRoutePackages(routeId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'packages', routeId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dispatches')
        .select('id, order_id, status, orders(order_number, contact_name, contact_address, contact_phone)')
        .eq('route_id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);
      if (error) throw error;
      return (data ?? []).map((d): RoutePackage => {
        const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
        return {
          dispatch_id: d.id,
          order_id: d.order_id,
          order_number: ord?.order_number ?? '',
          contact_name: ord?.contact_name ?? null,
          contact_address: ord?.contact_address ?? null,
          contact_phone: ord?.contact_phone ?? null,
          package_status: d.status,
        };
      });
    },
    enabled: !!routeId && !!operatorId,
    staleTime: 10_000,
  });
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test:run -- --reporter=verbose src/hooks/dispatch/useScanPackage.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/dispatch/
git commit -m "feat(dispatch): add useScanPackage + useRoutePackages hooks"
```

---

## Chunk 5: Components + Pages

### Task 12: ScanZone component (TDD)

**Files:**
- Create: `apps/frontend/src/components/dispatch/ScanZone.tsx`
- Create: `apps/frontend/src/components/dispatch/ScanZone.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/frontend/src/components/dispatch/ScanZone.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanZone } from './ScanZone';

describe('ScanZone', () => {
  it('renders scan input', () => {
    render(<ScanZone onScan={vi.fn()} disabled={false} lastError={null} />);
    expect(screen.getByPlaceholderText(/escanea/i)).toBeInTheDocument();
  });

  it('calls onScan with input value on Enter', () => {
    const onScan = vi.fn();
    render(<ScanZone onScan={onScan} disabled={false} lastError={null} />);
    const input = screen.getByPlaceholderText(/escanea/i);
    fireEvent.change(input, { target: { value: 'BARCODE-1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).toHaveBeenCalledWith('BARCODE-1');
  });

  it('clears input after scan', () => {
    render(<ScanZone onScan={vi.fn()} disabled={false} lastError={null} />);
    const input = screen.getByPlaceholderText(/escanea/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'BARCODE-1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('');
  });

  it('shows error message when lastError is set', () => {
    render(<ScanZone onScan={vi.fn()} disabled={false} lastError="Código no encontrado" />);
    expect(screen.getByText('Código no encontrado')).toBeInTheDocument();
  });

  it('disables input when disabled=true', () => {
    render(<ScanZone onScan={vi.fn()} disabled={true} lastError={null} />);
    expect(screen.getByPlaceholderText(/escanea/i)).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test:run -- --reporter=verbose src/components/dispatch/ScanZone.test.tsx
```

- [ ] **Step 3: Implement the component**

```tsx
// apps/frontend/src/components/dispatch/ScanZone.tsx
'use client';
import { useRef, useState, useEffect } from 'react';

interface Props {
  onScan: (code: string) => void;
  disabled: boolean;
  lastError: string | null;
}

export function ScanZone({ onScan, disabled, lastError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled, lastError]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !value.trim() || disabled) return;
    e.preventDefault();
    onScan(value.trim());
    setValue('');
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div
      style={{
        padding: '14px 20px 12px',
        background: 'var(--color-accent-muted)',
        borderBottom: '1.5px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
      }}
    >
      <div
        style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: 'var(--color-accent)',
          marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px',
        }}
      >
        <span
          style={{
            width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)',
            display: 'inline-block', animation: 'pulse 1.4s infinite',
          }}
        />
        Escáner activo
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="Escanea barcode, QR o número de orden…"
        autoComplete="off"
        style={{
          width: '100%', minHeight: 52,
          background: 'var(--color-background)',
          border: '1.5px solid var(--color-accent)',
          borderRadius: 10, color: 'var(--color-text)',
          fontFamily: 'var(--font-mono)', fontSize: 16,
          padding: '0 16px', outline: 'none',
        }}
      />
      {lastError && (
        <p style={{ fontSize: 12, color: 'var(--color-status-error)', marginTop: 6 }}>
          {lastError}
        </p>
      )}
      <p style={{ fontSize: 11, color: 'var(--color-accent)', opacity: 0.7, marginTop: 6 }}>
        Acepta código de paquete · número de orden · QR code
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test:run -- --reporter=verbose src/components/dispatch/ScanZone.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/dispatch/ScanZone.tsx apps/frontend/src/components/dispatch/ScanZone.test.tsx
git commit -m "feat(dispatch): add ScanZone component"
```

---

### Task 13: PackageRow + RouteListTile + RoutePanel components

These are presentational — test render + key interactions only.

**Files:**
- Create: `apps/frontend/src/components/dispatch/PackageRow.tsx`
- Create: `apps/frontend/src/components/dispatch/PackageRow.test.tsx`
- Create: `apps/frontend/src/components/dispatch/RouteListTile.tsx`
- Create: `apps/frontend/src/components/dispatch/RoutePanel.tsx`

- [ ] **Step 1: Write PackageRow test**

```typescript
// apps/frontend/src/components/dispatch/PackageRow.test.tsx
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PackageRow } from './PackageRow';

const pkg = {
  dispatch_id: 'd1', order_id: 'o1', order_number: 'ORD-4821',
  contact_name: 'Mario González', contact_address: 'Providencia 123',
  contact_phone: null, package_status: 'en_carga' as const,
};

describe('PackageRow', () => {
  it('renders order number and client name', () => {
    render(<PackageRow index={1} pkg={pkg} onRemove={vi.fn()} />);
    expect(screen.getByText('ORD-4821')).toBeInTheDocument();
    expect(screen.getByText('Mario González')).toBeInTheDocument();
  });

  it('calls onRemove with dispatch_id when remove button clicked', () => {
    const onRemove = vi.fn();
    render(<PackageRow index={1} pkg={pkg} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /eliminar/i }));
    expect(onRemove).toHaveBeenCalledWith('d1');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm run test:run -- --reporter=verbose src/components/dispatch/PackageRow.test.tsx
```

- [ ] **Step 3: Implement PackageRow**

```tsx
// apps/frontend/src/components/dispatch/PackageRow.tsx
import type { RoutePackage } from '@/lib/dispatch/types';

interface Props {
  index: number;
  pkg: RoutePackage;
  onRemove: (dispatchId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  en_carga: 'En carga',
  listo_para_despacho: 'Listo',
  en_ruta: 'En ruta',
};

export function PackageRow({ index, pkg, onRemove }: Props) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
        borderRadius: 10, padding: '0 14px', minHeight: 60, marginBottom: 8,
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)', width: 22, textAlign: 'right' }}>
        {index}
      </span>
      <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--color-accent-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
        📦
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-accent)' }}>
          {pkg.order_number}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
          {pkg.contact_name ?? '—'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pkg.contact_address ?? '—'}
        </div>
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }}>
        {STATUS_LABELS[pkg.package_status] ?? pkg.package_status}
      </span>
      <button
        onClick={() => onRemove(pkg.dispatch_id)}
        aria-label="Eliminar paquete"
        style={{
          width: 44, height: 44, borderRadius: 8, border: 'none', cursor: 'pointer',
          background: 'transparent', color: 'var(--color-text-muted)', fontSize: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run PackageRow test — expect PASS**

```bash
npm run test:run -- --reporter=verbose src/components/dispatch/PackageRow.test.tsx
```

- [ ] **Step 5: Implement RouteListTile (no separate test — presentation only)**

```tsx
// apps/frontend/src/components/dispatch/RouteListTile.tsx
import type { DispatchRoute } from '@/lib/dispatch/types';

interface Props {
  route: DispatchRoute;
  onClick: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  planned: 'Planned',
};

export function RouteListTile({ route, onClick }: Props) {
  const isReady = route.status === 'draft' && route.planned_stops > 0;
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      style={{
        background: 'var(--color-surface)',
        border: `1.5px solid ${isReady ? 'color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'var(--color-border)'}`,
        borderRadius: 14, padding: '18px 20px', cursor: 'pointer', minHeight: 130,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--color-accent)' }}>
            {route.id.slice(0, 8).toUpperCase()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
            {route.driver_name ?? 'Sin conductor'}
          </div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--color-surface-raised)', color: 'var(--color-text-muted)' }}>
          {STATUS_LABELS[route.status] ?? route.status}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>
          {route.planned_stops} <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 400, fontFamily: 'inherit' }}>paquetes</span>
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          {new Date(route.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement RoutePanel**

```tsx
// apps/frontend/src/components/dispatch/RoutePanel.tsx
'use client';
import type { FleetVehicle } from '@/lib/dispatch/types';

interface Props {
  packageCount: number;
  vehicles: FleetVehicle[];
  selectedVehicle: string;
  driverName: string;
  routeClosed: boolean;
  dispatching: boolean;
  onVehicleChange: (v: string) => void;
  onDriverChange: (v: string) => void;
  onClose: () => void;
  onDispatch: () => void;
}

export function RoutePanel({
  packageCount, vehicles, selectedVehicle, driverName, routeClosed,
  dispatching, onVehicleChange, onDriverChange, onClose, onDispatch,
}: Props) {
  return (
    <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', borderLeft: '1.5px solid var(--color-border)' }}>

      {/* Truck selector */}
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--color-border)' }}>
        <h3 style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 14 }}>
          Vehículo
        </h3>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>Camión</div>
          <select
            value={selectedVehicle}
            onChange={(e) => onVehicleChange(e.target.value)}
            disabled={routeClosed}
            style={{ width: '100%', minHeight: 52, background: 'var(--color-background)', border: '1.5px solid var(--color-border)', borderRadius: 10, color: 'var(--color-text)', fontSize: 15, padding: '0 14px', cursor: 'pointer', outline: 'none' }}
          >
            <option value="">Seleccionar camión…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.external_vehicle_id}>
                {v.external_vehicle_id}{v.plate_number ? ` · ${v.plate_number}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>Conductor (opcional)</div>
          <input
            value={driverName}
            onChange={(e) => onDriverChange(e.target.value)}
            disabled={routeClosed}
            placeholder="Nombre o RUT…"
            style={{ width: '100%', minHeight: 52, background: 'var(--color-background)', border: '1.5px solid var(--color-border)', borderRadius: 10, color: 'var(--color-text)', fontSize: 15, padding: '0 14px', outline: 'none', fontFamily: 'inherit' }}
          />
        </div>
      </div>

      {/* Stats */}
      <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--color-border)' }}>
        <h3 style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 14 }}>
          Resumen
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[['Paquetes', packageCount], ['Órdenes', packageCount]].map(([label, val]) => (
            <div key={String(label)} style={{ background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: 'var(--color-text)' }}>{val}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginTop: 'auto', padding: '16px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={onClose}
          disabled={routeClosed || packageCount === 0}
          style={{ width: '100%', minHeight: 52, borderRadius: 10, background: 'var(--color-surface-raised)', border: '1.5px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
        >
          Cerrar Ruta
        </button>
        <button
          onClick={onDispatch}
          disabled={!routeClosed || !selectedVehicle || dispatching}
          style={{ width: '100%', minHeight: 56, borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: 'var(--color-accent-foreground)', fontSize: 16, fontWeight: 800, cursor: 'pointer', opacity: (!routeClosed || !selectedVehicle || dispatching) ? 0.4 : 1 }}
        >
          {dispatching ? 'Despachando…' : 'Despachar a DispatchTrack →'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Commit all components**

```bash
git add apps/frontend/src/components/dispatch/
git commit -m "feat(dispatch): add PackageRow, RouteListTile, RoutePanel components"
```

---

### Task 14: RouteBuilder orchestrator component

**Files:**
- Create: `apps/frontend/src/components/dispatch/RouteBuilder.tsx`

- [ ] **Step 1: Implement RouteBuilder**

```tsx
// apps/frontend/src/components/dispatch/RouteBuilder.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScanZone } from './ScanZone';
import { PackageRow } from './PackageRow';
import { RoutePanel } from './RoutePanel';
import { useScanPackage } from '@/hooks/dispatch/useScanPackage';
import { useRoutePackages } from '@/hooks/dispatch/useRoutePackages';
import { useOperatorId } from '@/hooks/useOperatorId';
import type { FleetVehicle } from '@/lib/dispatch/types';

interface Props {
  routeId: string;
  vehicles: FleetVehicle[];
}

export function RouteBuilder({ routeId, vehicles }: Props) {
  const router = useRouter();
  const operatorId = useOperatorId();
  const [scanError, setScanError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [driverName, setDriverName] = useState('');
  const [routeClosed, setRouteClosed] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const { data: packages = [], refetch } = useRoutePackages(routeId, operatorId);
  const scanMutation = useScanPackage(routeId);

  const handleScan = async (code: string) => {
    setScanError(null);
    try {
      await scanMutation.mutateAsync(code);
      await refetch();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setScanError(e.message ?? 'Error al escanear');
    }
  };

  const handleRemove = async (dispatchId: string) => {
    await fetch(`/api/dispatch/routes/${routeId}/packages/${dispatchId}`, { method: 'DELETE' });
    await refetch();
  };

  const handleClose = async () => {
    const res = await fetch(`/api/dispatch/routes/${routeId}/close`, { method: 'POST' });
    if (res.ok) { setRouteClosed(true); await refetch(); }
  };

  const handleDispatch = async () => {
    if (!selectedVehicle) return;
    setDispatching(true);
    setDispatchError(null);
    try {
      const res = await fetch(`/api/dispatch/routes/${routeId}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truck_identifier: selectedVehicle, driver_identifier: driverName || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? 'Error al despachar');
      router.push('/app/dispatch');
    } catch (err: unknown) {
      const e = err as { message?: string };
      setDispatchError(e.message ?? 'Error de DispatchTrack');
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 53px)', overflow: 'hidden' }}>
      {/* Left */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1.5px solid var(--color-border)' }}>
        {/* Top bar */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '0 20px', height: 56, background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          <button onClick={() => router.push('/app/dispatch')} style={{ width: 40, height: 40, borderRadius: 8, border: 'none', background: 'var(--color-surface-raised)', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 18 }}>←</button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--color-accent)' }}>{routeId.slice(0, 8).toUpperCase()}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date().toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
          <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: routeClosed ? 'color-mix(in srgb, var(--color-accent) 15%, transparent)' : 'var(--color-surface-raised)', color: routeClosed ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
            {routeClosed ? 'Listo' : 'Draft'}
          </span>
        </div>

        <ScanZone onScan={handleScan} disabled={routeClosed} lastError={scanError} />

        {/* Count strip */}
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', height: 36, background: 'var(--color-background)', borderBottom: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Paquetes escaneados</span>
          <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--color-accent)' }}>{packages.length}</strong>
        </div>

        {/* Package list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 16px' }}>
          {packages.map((pkg, i) => (
            <PackageRow key={pkg.dispatch_id} index={i + 1} pkg={pkg} onRemove={handleRemove} />
          ))}
        </div>
      </div>

      {/* Right */}
      <RoutePanel
        packageCount={packages.length}
        vehicles={vehicles}
        selectedVehicle={selectedVehicle}
        driverName={driverName}
        routeClosed={routeClosed}
        dispatching={dispatching}
        onVehicleChange={setSelectedVehicle}
        onDriverChange={setDriverName}
        onClose={handleClose}
        onDispatch={handleDispatch}
      />

      {dispatchError && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'var(--color-status-error-bg)', border: '1px solid var(--color-status-error-border)', color: 'var(--color-status-error)', padding: '12px 20px', borderRadius: 10, fontSize: 13 }}>
          ⚠ {dispatchError} — <button onClick={handleDispatch} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-status-error)', textDecoration: 'underline' }}>Reintentar</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/components/dispatch/RouteBuilder.tsx
git commit -m "feat(dispatch): add RouteBuilder orchestrator component"
```

---

### Task 15: Pages + layout

**Files:**
- Create: `apps/frontend/src/app/app/dispatch/layout.tsx`
- Create: `apps/frontend/src/app/app/dispatch/page.tsx`
- Create: `apps/frontend/src/app/app/dispatch/[routeId]/page.tsx`

- [ ] **Step 1: Layout (permission guard)**

Follow the exact same pattern as `apps/frontend/src/app/app/distribution/layout.tsx`:

```tsx
// apps/frontend/src/app/app/dispatch/layout.tsx
import { redirect } from 'next/navigation';
import { createSSRClient } from '@/lib/supabase/server';

export default async function DispatchLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSSRClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect('/login');

  const permissions: string[] = session.user.app_metadata?.claims?.permissions ?? [];
  if (!permissions.includes('dispatch') && !permissions.includes('admin')) {
    redirect('/app/dashboard');
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Route list page**

```tsx
// apps/frontend/src/app/app/dispatch/page.tsx
'use client';
import { useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useDispatchRoutes } from '@/hooks/dispatch/useDispatchRoutes';
import { RouteListTile } from '@/components/dispatch/RouteListTile';

export default function DispatchPage() {
  const router = useRouter();
  const operatorId = useOperatorId();
  const { data: routes = [], isLoading } = useDispatchRoutes(operatorId);

  const handleNewRoute = async () => {
    const res = await fetch('/api/dispatch/routes', { method: 'POST' });
    const json = await res.json();
    if (res.ok) router.push(`/app/dispatch/${json.id}`);
  };

  return (
    <div style={{ padding: '24px 28px', minHeight: 'calc(100vh - 53px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Despacho</h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 2 }}>
            Rutas activas · {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <button
          onClick={handleNewRoute}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--color-accent)', color: 'var(--color-accent-foreground)', border: 'none', borderRadius: 10, padding: '14px 22px', fontSize: 15, fontWeight: 700, cursor: 'pointer', minHeight: 52 }}
        >
          + Nueva Ruta
        </button>
      </div>

      {isLoading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>Cargando rutas…</p>
      ) : routes.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>No hay rutas activas hoy.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {routes.map((route) => (
            <RouteListTile
              key={route.id}
              route={route}
              onClick={() => router.push(`/app/dispatch/${route.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Route builder page**

```tsx
// apps/frontend/src/app/app/dispatch/[routeId]/page.tsx
import { createSSRClient } from '@/lib/supabase/server';
import { RouteBuilder } from '@/components/dispatch/RouteBuilder';
import type { FleetVehicle } from '@/lib/dispatch/types';

export default async function RouteBuilderPage({ params }: { params: Promise<{ routeId: string }> }) {
  const { routeId } = await params;
  const supabase = await createSSRClient();
  const { data: { session } } = await supabase.auth.getSession();
  const operatorId = session?.user.app_metadata?.claims?.operator_id;

  // Fetch available vehicles server-side (avoids an extra client request)
  const { data: vehicles } = await supabase
    .from('fleet_vehicles')
    .select('id, external_vehicle_id, plate_number, driver_name, vehicle_type')
    .eq('operator_id', operatorId)
    .is('deleted_at', null)
    .order('external_vehicle_id');

  return <RouteBuilder routeId={routeId} vehicles={(vehicles ?? []) as FleetVehicle[]} />;
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/app/dispatch/
git commit -m "feat(dispatch): add dispatch pages and permission layout"
```

---

### Task 16: Sidebar nav item

**Files:**
- Modify: `apps/frontend/src/components/sidebar/` — find `SidebarNavItem` usage list and add Dispatch

- [ ] **Step 1: Locate where nav items are defined**

```bash
grep -r "distribution\|reception\|pickup" apps/frontend/src/components/sidebar/ -l
grep -r "distribution\|reception\|pickup" apps/frontend/src/components/AppLayout.tsx -n | head -20
```

- [ ] **Step 2: Add dispatch nav item**

In the file that defines the nav items array (likely `AppLayout.tsx` or a `navItems` config file), add:

```typescript
import { Truck } from 'lucide-react'; // or whichever icon fits

// In the navItems array, after Distribution:
{ href: '/app/dispatch', label: 'Despacho', icon: Truck, permission: 'dispatch' },
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/
git commit -m "feat(dispatch): add Despacho nav item to sidebar"
```

---

## Chunk 6: Tests (Integration + E2E)

### Task 17: Integration tests for close + dispatch routes

**Files:**
- Create: `apps/frontend/src/__tests__/dispatch/route-close.test.ts`
- Create: `apps/frontend/src/__tests__/dispatch/route-dispatch.test.ts`

- [ ] **Step 1: Integration test for close route**

```typescript
// apps/frontend/src/__tests__/dispatch/route-close.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase server client
vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(),
}));
import { createSSRClient } from '@/lib/supabase/server';
import { POST } from '@/app/api/dispatch/routes/[id]/close/route';
import { NextRequest } from 'next/server';

function buildRequest() {
  return new NextRequest('http://localhost/api/dispatch/routes/route-1/close', { method: 'POST' });
}

function mockSupabase(overrides = {}) {
  const base = {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1', app_metadata: { claims: { operator_id: 'op-1' } } } } }, error: null }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'route-1', status: 'draft', planned_stops: 3 }, error: null }),
    }),
    ...overrides,
  };
  (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(base);
  return base;
}

describe('POST /routes/[id]/close', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns 401 when no session', async () => {
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }) },
    });
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'route-1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 409 when route is not draft', async () => {
    const mock = mockSupabase();
    mock.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'route-1', status: 'planned', planned_stops: 3 }, error: null }),
    });
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'route-1' }) });
    expect(res.status).toBe(409);
  });

  it('returns 422 when route is empty', async () => {
    const mock = mockSupabase();
    mock.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'route-1', status: 'draft', planned_stops: 0 }, error: null }),
    });
    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'route-1' }) });
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run — verify tests pass**

```bash
npm run test:run -- --reporter=verbose src/__tests__/dispatch/
```

- [ ] **Step 3: Integration test for dispatch failure (DT error → no state change)**

```typescript
// apps/frontend/src/__tests__/dispatch/route-dispatch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createSSRClient: vi.fn() }));
vi.mock('@/lib/dispatchtrack-api', () => ({
  createDTRoute: vi.fn(),
}));

import { createSSRClient } from '@/lib/supabase/server';
import { createDTRoute } from '@/lib/dispatchtrack-api';
import { POST } from '@/app/api/dispatch/routes/[id]/dispatch/route';
import { NextRequest } from 'next/server';

function buildRequest(body = { truck_identifier: 'ZALDUENDO' }) {
  return new NextRequest('http://localhost/api/dispatch/routes/r1/dispatch', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /routes/[id]/dispatch — DT failure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('DT_API_KEY', 'test-token');
  });

  it('returns 502 and does not update packages when DT API throws', async () => {
    const updateSpy = vi.fn().mockReturnThis();
    const supabaseMock = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1', app_metadata: { claims: { operator_id: 'op-1' } } } } }, error: null }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        update: updateSpy,
        insert: vi.fn().mockReturnThis().mockResolvedValue({ error: null }),
        single: vi.fn().mockResolvedValue({ data: { id: 'r1', status: 'draft', route_date: '2026-03-24' }, error: null }),
        mockResolvedValue: vi.fn().mockResolvedValue({ data: [{ id: 'd1', order_id: 'o1', orders: { order_number: '4821', contact_name: 'Mario', contact_address: 'Av', contact_phone: null, contact_email: null } }], error: null }),
      }),
    };
    (createSSRClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabaseMock);
    (createDTRoute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Permission denied'));

    const res = await POST(buildRequest(), { params: Promise.resolve({ id: 'r1' }) });
    expect(res.status).toBe(502);
    // updateSpy must NOT have been called with 'en_ruta'
    const updateCalls = updateSpy.mock.calls.map((c) => JSON.stringify(c));
    expect(updateCalls.some((c) => c.includes('en_ruta'))).toBe(false);
  });
});
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm run test:run -- --reporter=verbose src/__tests__/dispatch/
```

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/__tests__/dispatch/
git commit -m "test(dispatch): integration tests for close + dispatch failure path"
```

---

### Task 18: E2E test (Playwright)

**Files:**
- Create: `apps/frontend/e2e/dispatch-route.spec.ts`

- [ ] **Step 1: Write the E2E test**

```typescript
// apps/frontend/e2e/dispatch-route.spec.ts
import { test, expect } from '@playwright/test';

// NOTE: This test mocks the DT API at the network level.
// The dev server must be running: npm run dev

test.describe('Dispatch Module E2E', () => {
  test.beforeEach(async ({ page, context }) => {
    // Mock DT API — intercept at network level so no real call goes out
    await context.route(
      '**/activationcode.dispatchtrack.com/api/external/v1/routes',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', response: { route_id: 99999 } }) }),
    );

    // Login
    await page.goto('/login');
    await page.fill('[name=email]', 'gerhard@tractis.ai');
    await page.fill('[name=password]', 'Tractis01');
    await page.click('button[type=submit]');
    await page.waitForURL('**/app/**');
  });

  test('full dispatch journey: create route → scan 3 → close → dispatch', async ({ page }) => {
    // 1. Navigate to dispatch
    await page.goto('/app/dispatch');
    await expect(page.getByRole('heading', { name: 'Despacho' })).toBeVisible();

    // 2. Create new route
    await page.getByRole('button', { name: /nueva ruta/i }).click();
    await page.waitForURL('**/app/dispatch/**');

    // 3. Scan 3 packages
    // These order numbers must exist as 'asignado' in test DB — adjust to real test data
    const scanInput = page.getByPlaceholderText(/escanea/i);
    for (const code of ['TEST-001', 'TEST-002', 'TEST-003']) {
      await scanInput.fill(code);
      await scanInput.press('Enter');
      await page.waitForTimeout(300); // allow mutation + refetch
    }

    // 4. Verify 3 packages appear
    await expect(page.getByText('3')).toBeVisible(); // count strip

    // 5. Select truck and close route
    await page.selectOption('select', { index: 1 });
    await page.getByRole('button', { name: /cerrar ruta/i }).click();
    await expect(page.getByText(/listo/i).first()).toBeVisible();

    // 6. Dispatch
    await page.getByRole('button', { name: /despachar a dispatchtrack/i }).click();

    // 7. Should redirect back to route list
    await page.waitForURL('**/app/dispatch');
    await expect(page.getByRole('heading', { name: 'Despacho' })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the E2E test**

```bash
cd apps/frontend
npx playwright test e2e/dispatch-route.spec.ts --headed
```

Expected: test passes (DT API mocked, local state updates correctly)

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/e2e/dispatch-route.spec.ts
git commit -m "test(dispatch): E2E smoke test — create route, scan, close, dispatch"
```

---

### Task 19: Final CI check + PR

- [ ] **Step 1: Run full test suite**

```bash
cd apps/frontend
npm run test:run
npm run type-check
npm run lint
```

Expected: all pass, coverage ≥ 70%

- [ ] **Step 2: Push branch and create PR**

```bash
git push origin feat/spec-15-dispatch-module
gh pr create --title "feat: Dispatch Module (spec-15)" --body "$(cat <<'EOF'
## Summary
- Adds Dispatch Module as the final hub operational step before last-mile delivery
- Tablet-optimized split-panel UI (landscape, 56px touch targets)
- Scans packages from andén into routes, calls DispatchTrack API on dispatch
- DB: adds `draft` route status, renames `listo` → `listo_para_despacho`

## Test plan
- [ ] Unit tests: DT API client, scan validator, components
- [ ] Integration: close route (empty/wrong-state guards), dispatch DT failure path
- [ ] E2E: full journey (create → scan → close → dispatch)
- [ ] Verify CI passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

---

## Quick Reference

| Command | What it does |
|---|---|
| `npm run test:run` | Run all Vitest unit/integration tests |
| `npm run test:run -- src/lib/dispatchtrack-api.test.ts` | Run one test file |
| `npx playwright test e2e/dispatch-route.spec.ts --headed` | Run E2E in browser |
| `npx supabase db push --local` | Apply migration to local DB |
| `npm run type-check` | TypeScript check |
| `npm run lint` | ESLint check |

## Key Files Quick Nav

| File | Purpose |
|---|---|
| `lib/dispatchtrack-api.ts` | DT HTTP client — date conversion, auth header |
| `lib/dispatch/scan-validator.ts` | Barcode → package lookup + status validation |
| `app/api/dispatch/routes/[id]/dispatch/route.ts` | Critical: DT call then local update |
| `components/dispatch/RouteBuilder.tsx` | Main orchestrator — composes all child components |
| `e2e/dispatch-route.spec.ts` | Full journey smoke test |
