# spec-38 — Route Activity View (En Ruta tab redesign)

**Status:** ready

## Goal

Replace the current 3-column card grid in the "En Ruta" tab with a DispatchTrack-style vertical list. Each route row is expandable and reveals a two-pane panel: a scrollable order list on the left and an order detail pane in the middle. A map placeholder (third pane) is rendered at fixed width for the future Leaflet integration (spec-39).

## Background

The current `DispatchInProgressTab` renders `RouteListTile` cards in a `grid-cols-3` layout. This shows only route ID, driver, a thin progress bar, and a stops count — not enough for live monitoring. Operators using DispatchTrack are accustomed to seeing per-route delivery breakdowns and per-order detail without leaving the list view.

## Scope

**In scope:**
- New `RouteActivityRow` component (collapsed header + expandable panel)
- New `useRouteDispatches` hook (lazy per-route dispatch fetch, 30 s polling)
- New types in `lib/dispatch/types.ts`: `DispatchStatus`, `RouteDispatchSummary`
- Fleet-level summary strip (totals across all in-progress routes)
- Extract `DispatchInProgressTab` into its own component file and wire `RouteActivityRow` into it

**Out of scope:**
- Open and Completed tabs (keep `RouteListTile`)
- Leaflet map integration (placeholder only — spec-39)
- Geocoding (spec-39)
- Fixing the unrelated `useRoutePackages` type lie (pre-existing; untouched here)

## Data model — what `dispatches.status` actually is

`public.dispatches.status` is `dispatch_status_enum` with **four** values (see `20260306000001_add_routes_dispatches_fleet_tables.sql`):

| DB value     | Meaning                               |
|--------------|---------------------------------------|
| `pending`    | Assigned to route, not yet attempted  |
| `delivered`  | Successfully delivered (terminal)     |
| `failed`     | Delivery failed/rejected (terminal)   |
| `partial`    | Partial delivery (terminal)           |

These are **not** the Spanish `PackageStatus` values (`entregado`, `cancelado`, `en_ruta`, …) used by the pickup-phase `RoutePackage` type. Spec-38 therefore introduces its own type (`RouteDispatchSummary`) that preserves the DB enum verbatim.

## Design

### Collapsed header (always visible)

```
● JUAN PÉREZ          26 Asignadas | 24 Entregadas | 2 Fallidas | 0 Pendientes   Cumplimiento  92.3% ████░  ›
  Camión 01 · DT-00A1
```

- Status dot color: green ≥90%, amber 70–89%, red <70% (matches progress bar and % text)
- Clicking anywhere on the header toggles expand/collapse
- Only one row expanded at a time (accordion)

### Expanded panel (320px height, 3 columns)

| Pane | Width | Content |
|---|---|---|
| Order list | 260px fixed | Scrollable list of all dispatches for this route |
| Order detail | flex-1 | Contact name, phone, address, status for selected order |
| Map placeholder | 280px fixed | "Mapa Leaflet — próximo sprint" label |

**Order list row:** status dot + order number + address (truncated)
**Sort order (client-side):** `failed` first, then `pending`/`partial`, then `delivered`; within a bucket, by `order_number` ascending
**Auto-select:** first order in list is selected when row expands

**Order detail fields:** order number (mono), status label, contact name, phone, address

### Stats derivation

| Stat | Source |
|---|---|
| Asignadas | `route.planned_stops` (already in list query — no extra fetch) |
| Entregadas | dispatches where `status = 'delivered'` |
| Fallidas | dispatches where `status = 'failed'` |
| Pendientes | dispatches where `status IN ('pending', 'partial')` |

### Status → UI color map (used in the order-list dot + order-detail badge)

| `DispatchStatus` | Dot class    | Label (es)  |
|------------------|--------------|-------------|
| `delivered`      | `bg-green-500` | Entregada |
| `failed`         | `bg-red-500`   | Fallida   |
| `pending`        | `bg-slate-500` | Pendiente |
| `partial`        | `bg-amber-500` | Parcial   |

### Fleet summary strip

Shown above the route list. Computed client-side once dispatch counts are loaded:
- N vehículos en ruta
- Total entregadas (sum across routes)
- Total fallidas
- Total pendientes
- Cumplimiento promedio (weighted by asignadas)

Strip renders with skeleton placeholders until the routes list has loaded. For routes that have been expanded, exact per-status counts are used. For routes that have **not** been expanded yet, only `Entregadas` is approximated as `route.completed_stops`; `Fallidas` and `Pendientes` are hidden (shown as `—`) until the row is expanded and real dispatch data is available. This is stated explicitly in the UI via a footnote: "* Fallidas y pendientes disponibles al expandir la ruta."

## Data

### New types (`lib/dispatch/types.ts`)

```ts
export type DispatchStatus = 'pending' | 'delivered' | 'failed' | 'partial';

export interface RouteDispatchSummary {
  dispatch_id: string;
  order_id: string;
  order_number: string;
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  status: DispatchStatus;
}
```

**Why a new type (not reuse `RoutePackage`):** `RoutePackage.package_status` is typed `PackageStatus` (Spanish pickup-phase enum: `ingresado`, `en_carga`, …). `dispatches.status` is `dispatch_status_enum` (English outcome enum: `pending`, `delivered`, …). Reusing `RoutePackage` would require the same runtime-typed cast the legacy pickup hook already uses, which is what made spec-38 filter on non-existent values during review. A dedicated type keeps this hook honest.

### `useRouteDispatches(routeId: string | null, operatorId: string | null)`

- Queries Supabase: `dispatches` joined to `orders` for the given route
- Returns `RouteDispatchSummary[]`, sorted client-side by status bucket then `order_number`
- `enabled: !!routeId && !!operatorId` — called lazily only when a row is first expanded
- `staleTime: 30_000`, `refetchInterval: 30_000` (live monitoring)
- Query key: `['dispatch', 'routes', routeId, 'dispatches']`
- **Re-fetch on re-expand is intentional** — ensures fresh data if the user collapses and re-opens a row

**Why a new hook (not extend `useRoutePackages`):** different return type (see above) and different polling cadence. The two hooks share a SQL shape but diverge in the mapping layer.

### Supabase query

```sql
SELECT
  d.id AS dispatch_id,
  d.order_id,
  o.order_number,
  o.customer_name,
  o.delivery_address,
  o.customer_phone,
  d.status
FROM dispatches d
JOIN orders o ON o.id = d.order_id
WHERE d.route_id = :routeId
  AND d.operator_id = :operatorId   -- required on every query
  AND d.deleted_at IS NULL;
-- sort is applied client-side (status bucket, then order_number)
```

## Components

### `RouteActivityRow`

```
props:
  route: DispatchRoute
  operatorId: string
  isOpen: boolean
  onToggle: () => void
```

- Renders collapsed header always
- When `isOpen`, fetches dispatches via `useRouteDispatches(route.id, operatorId)`
- Passes `RouteDispatchSummary[]` to internal `OrderList` and `OrderDetail` sub-components
- No navigation on row click (accordion toggle only); the `›` chevron rotates 90° when open
- **Error state:** if `useRouteDispatches` returns an error, the expanded panel shows an inline error message ("No se pudo cargar las órdenes") with a retry button that calls `refetch()`
- **Loading state:** expanded panel shows skeleton rows in the order list while fetching

### `OrderList` (internal, not exported)

```
props:
  orders: RouteDispatchSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
```

### `OrderDetail` (internal, not exported)

```
props:
  order: RouteDispatchSummary | null
```

Shows empty state ("Selecciona una orden") when `order` is null.

### `DispatchInProgressTab` (extracted to its own file)

- Moves from `app/app/dispatch/page.tsx` to `components/dispatch/DispatchInProgressTab.tsx` — no more "exported for test-only" framing
- Renders `RouteActivityRow` per route
- Manages `openRouteId: string | null` state (accordion)
- Renders fleet summary strip above the list

## File Map

| Path | Action |
|---|---|
| `apps/frontend/src/lib/dispatch/types.ts` | Modify — add `DispatchStatus` + `RouteDispatchSummary` |
| `apps/frontend/src/hooks/dispatch/useRouteDispatches.ts` | Create |
| `apps/frontend/src/hooks/dispatch/useRouteDispatches.test.ts` | Create |
| `apps/frontend/src/components/dispatch/RouteActivityRow.tsx` | Create |
| `apps/frontend/src/components/dispatch/RouteActivityRow.test.tsx` | Create |
| `apps/frontend/src/components/dispatch/DispatchInProgressTab.tsx` | Create (extracted from `page.tsx`) |
| `apps/frontend/src/components/dispatch/DispatchInProgressTab.test.tsx` | Create |
| `apps/frontend/src/app/app/dispatch/page.tsx` | Modify — delete inline tab, import + render the extracted component |

## Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Tech Stack:** React 18, TanStack Query v5, Tailwind CSS, Vitest + @testing-library/react, Supabase JS client.

---

### Chunk 1 — Types + `useRouteDispatches` hook

**Files:**
- Modify: `apps/frontend/src/lib/dispatch/types.ts`
- Create: `apps/frontend/src/hooks/dispatch/useRouteDispatches.test.ts`
- Create: `apps/frontend/src/hooks/dispatch/useRouteDispatches.ts`

---

- [ ] **Step 1.1: Add the types to `lib/dispatch/types.ts`**

Append:

```ts
// dispatches.status comes from dispatch_status_enum (DB-level). Keep these values verbatim.
export type DispatchStatus = 'pending' | 'delivered' | 'failed' | 'partial';

export interface RouteDispatchSummary {
  dispatch_id: string;
  order_id: string;
  order_number: string;
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  status: DispatchStatus;
}
```

- [ ] **Step 1.2: Write failing tests**

Create `apps/frontend/src/hooks/dispatch/useRouteDispatches.test.ts`:

```typescript
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouteDispatches } from './useRouteDispatches';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

describe('useRouteDispatches', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when routeId is null', () => {
    const { result } = renderHook(
      () => useRouteDispatches(null, 'op-1'),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(
      () => useRouteDispatches('route-1', null),
      { wrapper: wrapper() },
    );
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns mapped RouteDispatchSummary[] on success', async () => {
    const rawRow = {
      id: 'dp-1',
      order_id: 'ord-1',
      status: 'delivered',
      orders: { order_number: 'ORD-001', customer_name: 'Alice', delivery_address: '123 St', customer_phone: '+56911' },
    };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [rawRow], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useRouteDispatches('route-1', 'op-1'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({
      dispatch_id: 'dp-1',
      order_id: 'ord-1',
      order_number: 'ORD-001',
      contact_name: 'Alice',
      contact_address: '123 St',
      contact_phone: '+56911',
      status: 'delivered',
    });
  });

  it('handles orders as array (takes first element)', async () => {
    const rawRow = {
      id: 'dp-2',
      order_id: 'ord-2',
      status: 'failed',
      orders: [{ order_number: 'ORD-002', customer_name: 'Bob', delivery_address: '456 Ave', customer_phone: null }],
    };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [rawRow], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useRouteDispatches('route-1', 'op-1'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].order_number).toBe('ORD-002');
    expect(result.current.data?.[0].contact_phone).toBeNull();
    expect(result.current.data?.[0].status).toBe('failed');
  });

  it('sorts by status bucket (failed → pending/partial → delivered) then order_number', async () => {
    const rows = [
      { id: 'd1', order_id: 'o1', status: 'delivered', orders: { order_number: 'ORD-A', customer_name: null, delivery_address: null, customer_phone: null } },
      { id: 'd2', order_id: 'o2', status: 'failed',    orders: { order_number: 'ORD-B', customer_name: null, delivery_address: null, customer_phone: null } },
      { id: 'd3', order_id: 'o3', status: 'pending',   orders: { order_number: 'ORD-C', customer_name: null, delivery_address: null, customer_phone: null } },
      { id: 'd4', order_id: 'o4', status: 'partial',   orders: { order_number: 'ORD-D', customer_name: null, delivery_address: null, customer_phone: null } },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useRouteDispatches('route-1', 'op-1'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((d) => d.order_number)).toEqual(['ORD-B', 'ORD-C', 'ORD-D', 'ORD-A']);
  });

  it('exposes isError and refetch on Supabase failure', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useRouteDispatches('route-1', 'op-1'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(typeof result.current.refetch).toBe('function');
  });

  it('returns empty array when no dispatches found', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    mockFrom.mockReturnValue(chain);

    const { result } = renderHook(
      () => useRouteDispatches('route-1', 'op-1'),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
```

- [ ] **Step 1.3: Run tests — confirm FAIL**

```bash
cd apps/frontend && npx vitest run src/hooks/dispatch/useRouteDispatches.test.ts
```

Expected: FAIL — `useRouteDispatches` does not exist.

- [ ] **Step 1.4: Implement**

Create `apps/frontend/src/hooks/dispatch/useRouteDispatches.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { DispatchStatus, RouteDispatchSummary } from '@/lib/dispatch/types';

const BUCKET: Record<DispatchStatus, number> = {
  failed: 0,
  pending: 1,
  partial: 1,
  delivered: 2,
};

export function useRouteDispatches(routeId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['dispatch', 'routes', routeId, 'dispatches'],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dispatches')
        .select('id, order_id, status, orders(order_number, customer_name, delivery_address, customer_phone)')
        .eq('route_id', routeId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);
      if (error) throw error;

      const rows = (data ?? []).map((d): RouteDispatchSummary => {
        const ord = Array.isArray(d.orders) ? d.orders[0] : d.orders;
        return {
          dispatch_id: d.id,
          order_id: d.order_id ?? '',
          order_number: ord?.order_number ?? '',
          contact_name: ord?.customer_name ?? null,
          contact_address: ord?.delivery_address ?? null,
          contact_phone: ord?.customer_phone ?? null,
          status: d.status as DispatchStatus,
        };
      });

      return rows.sort((a, b) => {
        const d = BUCKET[a.status] - BUCKET[b.status];
        if (d !== 0) return d;
        return a.order_number.localeCompare(b.order_number);
      });
    },
    enabled: !!routeId && !!operatorId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 1.5: Run tests — confirm PASS**

```bash
cd apps/frontend && npx vitest run src/hooks/dispatch/useRouteDispatches.test.ts
```

- [ ] **Step 1.6: Commit**

```bash
git add apps/frontend/src/lib/dispatch/types.ts \
        apps/frontend/src/hooks/dispatch/useRouteDispatches.ts \
        apps/frontend/src/hooks/dispatch/useRouteDispatches.test.ts
git commit -m "feat(spec-38): DispatchStatus type + useRouteDispatches hook with 30s polling"
```

---

### Chunk 2 — `RouteActivityRow`: collapsed header

**Files:**
- Create: `apps/frontend/src/components/dispatch/RouteActivityRow.test.tsx`
- Create: `apps/frontend/src/components/dispatch/RouteActivityRow.tsx`

---

- [ ] **Step 2.1: Write failing tests**

Create `apps/frontend/src/components/dispatch/RouteActivityRow.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DispatchRoute, RouteDispatchSummary } from '@/lib/dispatch/types';

const mockUseRouteDispatches = vi.fn();
vi.mock('@/hooks/dispatch/useRouteDispatches', () => ({
  useRouteDispatches: (...args: unknown[]) => mockUseRouteDispatches(...args),
}));

import { RouteActivityRow } from './RouteActivityRow';

const BASE_ROUTE: DispatchRoute = {
  id: 'route-1',
  operator_id: 'op-1',
  external_route_id: 'DT-00A1',
  route_date: '2026-04-24',
  driver_name: 'Juan Pérez',
  vehicle_id: null,
  truck_identifier: 'Camión 01',
  status: 'in_progress',
  planned_stops: 26,
  completed_stops: 24,
  created_at: '2026-04-24T08:00:00Z',
};

describe('RouteActivityRow — collapsed header', () => {
  beforeEach(() => {
    mockUseRouteDispatches.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
  });

  it('renders driver name in the header', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
  });

  it('renders truck identifier and external route id', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/Camión 01/)).toBeInTheDocument();
    expect(screen.getByText(/DT-00A1/)).toBeInTheDocument();
  });

  it('falls back to "Sin conductor" when driver_name is null', () => {
    render(
      <RouteActivityRow route={{ ...BASE_ROUTE, driver_name: null }} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />,
    );
    expect(screen.getByText(/Sin conductor/i)).toBeInTheDocument();
  });

  it('renders planned_stops as Asignadas count', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByTestId('stat-asignadas')).toHaveTextContent('26');
  });

  it('renders cumplimiento percentage (24/26 = 92.3%)', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/92\.3%/)).toBeInTheDocument();
  });

  it('shows green color at ≥90% cumplimiento', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText(/92\.3%/)).toHaveClass('text-green-500');
  });

  it('shows amber color at 70–89% cumplimiento', () => {
    const amberRoute = { ...BASE_ROUTE, planned_stops: 10, completed_stops: 8 }; // 80%
    render(<RouteActivityRow route={amberRoute} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText('80%')).toHaveClass('text-amber-500');
  });

  it('shows red color below 70% cumplimiento', () => {
    const redRoute = { ...BASE_ROUTE, planned_stops: 10, completed_stops: 5 }; // 50%
    render(<RouteActivityRow route={redRoute} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByText('50%')).toHaveClass('text-red-500');
  });

  it('calls onToggle when the header is clicked', () => {
    const onToggle = vi.fn();
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /Juan Pérez/i }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('does not show expanded panel when isOpen is false', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={false} onToggle={vi.fn()} />);
    expect(screen.queryByTestId('route-expanded-panel')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2.2: Run tests — confirm FAIL**

```bash
cd apps/frontend && npx vitest run src/components/dispatch/RouteActivityRow.test.tsx
```

Expected: FAIL — `RouteActivityRow` does not exist.

- [ ] **Step 2.3: Implement the collapsed header**

Create `apps/frontend/src/components/dispatch/RouteActivityRow.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useRouteDispatches } from '@/hooks/dispatch/useRouteDispatches';
import type { DispatchRoute } from '@/lib/dispatch/types';

interface Props {
  route: DispatchRoute;
  operatorId: string;
  isOpen: boolean;
  onToggle: () => void;
}

type Color = 'green' | 'amber' | 'red';

function completionColor(pct: number): Color {
  if (pct >= 90) return 'green';
  if (pct >= 70) return 'amber';
  return 'red';
}

const DOT_CLASS: Record<Color, string> = {
  green: 'bg-green-500 shadow-[0_0_6px_theme(colors.green.500/50%)]',
  amber: 'bg-amber-500 shadow-[0_0_6px_theme(colors.amber.500/50%)]',
  red:   'bg-red-500   shadow-[0_0_6px_theme(colors.red.500/50%)]',
};
const BAR_CLASS: Record<Color, string> = { green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500' };
const PCT_CLASS: Record<Color, string> = { green: 'text-green-500', amber: 'text-amber-500', red: 'text-red-500' };

export function RouteActivityRow({ route, operatorId, isOpen, onToggle }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: dispatches = [], isLoading, isError, refetch } = useRouteDispatches(
    isOpen ? route.id : null,
    operatorId,
  );

  const firstId = dispatches[0]?.dispatch_id ?? null;
  const effectiveSelectedId = selectedId ?? firstId;
  const selectedOrder = dispatches.find((d) => d.dispatch_id === effectiveSelectedId) ?? null;

  const pct = route.planned_stops > 0
    ? Math.round((route.completed_stops / route.planned_stops) * 1000) / 10
    : 0;
  const color = completionColor(pct);
  const driverLabel = route.driver_name ?? 'Sin conductor';
  const subLabel = [route.truck_identifier, route.external_route_id].filter(Boolean).join(' · ');

  // Stat counts — exact when expanded and loaded; approximate Entregadas from route.completed_stops otherwise.
  const entregadas = isOpen && !isLoading
    ? dispatches.filter((d) => d.status === 'delivered').length
    : route.completed_stops;
  const fallidas = isOpen && !isLoading
    ? dispatches.filter((d) => d.status === 'failed').length
    : null;
  const pendientes = isOpen && !isLoading
    ? dispatches.filter((d) => d.status === 'pending' || d.status === 'partial').length
    : null;

  const statBoxes = [
    { label: 'Asignadas',  value: route.planned_stops, cls: '',               testId: 'stat-asignadas'  },
    { label: 'Entregadas', value: entregadas,           cls: 'text-green-500', testId: 'stat-entregadas' },
    { label: 'Fallidas',   value: fallidas ?? '—',      cls: fallidas != null ? 'text-red-500' : 'text-text-secondary', testId: 'stat-fallidas' },
    { label: 'Pendientes', value: pendientes ?? '—',    cls: 'text-text-secondary', testId: 'stat-pendientes' },
  ];

  return (
    <div className={cn('rounded-xl border-[1.5px] overflow-hidden bg-surface', isOpen ? 'border-blue-500/60' : 'border-border')}>
      {/* Header */}
      <div
        role="button"
        aria-label={driverLabel}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-surface-raised transition-colors select-none"
      >
        <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', DOT_CLASS[color])} />
        <div className="w-48 flex-shrink-0">
          <p className="text-sm font-bold text-text truncate">{driverLabel}</p>
          {subLabel && <p className="text-xs text-text-secondary mt-0.5 truncate">{subLabel}</p>}
        </div>
        <div className="flex gap-1.5">
          {statBoxes.map(({ label, value, cls, testId }) => (
            <div key={label} className="text-center bg-surface-raised border border-border rounded-lg px-3 py-1.5 min-w-[66px]">
              <p data-testid={testId} className={cn('text-lg font-bold font-mono', cls)}>{value}</p>
              <p className="text-[10px] text-text-secondary mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline mb-1.5">
            <span className="text-xs text-text-secondary">Cumplimiento</span>
            <span className={cn('text-lg font-bold', PCT_CLASS[color])}>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
            <div className={cn('h-full rounded-full', BAR_CLASS[color])} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <span className={cn('text-text-secondary transition-transform duration-200', isOpen && 'rotate-90')}>›</span>
      </div>

      {/* Expanded panel — filled in Chunk 3 */}
      {isOpen && (
        <div data-testid="route-expanded-panel" className="border-t border-border flex h-80">
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2.4: Run tests — confirm PASS**

```bash
cd apps/frontend && npx vitest run src/components/dispatch/RouteActivityRow.test.tsx
```

- [ ] **Step 2.5: Commit**

```bash
git add apps/frontend/src/components/dispatch/RouteActivityRow.tsx \
        apps/frontend/src/components/dispatch/RouteActivityRow.test.tsx
git commit -m "feat(spec-38): RouteActivityRow collapsed header"
```

---

### Chunk 3 — `RouteActivityRow`: expanded panel

**Files:**
- Modify: `apps/frontend/src/components/dispatch/RouteActivityRow.test.tsx`
- Modify: `apps/frontend/src/components/dispatch/RouteActivityRow.tsx`

---

- [ ] **Step 3.1: Add failing tests for the expanded panel**

Append a new `describe` block to `RouteActivityRow.test.tsx` (after the collapsed header describe):

```tsx
const DISPATCHES: RouteDispatchSummary[] = [
  {
    dispatch_id: 'dp-1', order_id: 'ord-1', order_number: 'ORD-4521',
    contact_name: 'María Rodríguez', contact_address: 'Av. Providencia 1234',
    contact_phone: '+56987654321', status: 'failed',
  },
  {
    dispatch_id: 'dp-2', order_id: 'ord-2', order_number: 'ORD-4522',
    contact_name: 'Carlos Méndez', contact_address: 'Las Condes 890',
    contact_phone: null, status: 'delivered',
  },
];

describe('RouteActivityRow — expanded panel', () => {
  beforeEach(() => {
    mockUseRouteDispatches.mockReturnValue({ data: DISPATCHES, isLoading: false, isError: false, refetch: vi.fn() });
  });

  it('shows the expanded panel when isOpen is true', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByTestId('route-expanded-panel')).toBeInTheDocument();
  });

  it('renders order numbers in the order list', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByText('ORD-4521')).toBeInTheDocument();
    expect(screen.getByText('ORD-4522')).toBeInTheDocument();
  });

  it('auto-selects the first order and shows its detail on open', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByText('María Rodríguez')).toBeInTheDocument();
    expect(screen.getByText('Av. Providencia 1234')).toBeInTheDocument();
  });

  it('clicking an order in the list shows its detail', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByText('ORD-4522'));
    expect(screen.getByText('Carlos Méndez')).toBeInTheDocument();
  });

  it('shows "—" for phone when contact_phone is null', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByText('ORD-4522'));
    expect(screen.getByTestId('order-phone')).toHaveTextContent('—');
  });

  it('renders the map placeholder column', () => {
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByTestId('map-placeholder')).toBeInTheDocument();
  });

  it('shows skeleton rows while dispatches are loading', () => {
    mockUseRouteDispatches.mockReturnValue({ data: [], isLoading: true, isError: false, refetch: vi.fn() });
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByTestId('orders-loading')).toBeInTheDocument();
  });

  it('shows inline error message and retry button on hook error', () => {
    const mockRefetch = vi.fn();
    mockUseRouteDispatches.mockReturnValue({ data: [], isLoading: false, isError: true, refetch: mockRefetch });
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByText(/No se pudo cargar/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(mockRefetch).toHaveBeenCalledOnce();
  });

  it('updates exact Entregadas/Fallidas/Pendientes counts when expanded', () => {
    // DISPATCHES: 1 failed, 1 delivered → Entregadas=1, Fallidas=1, Pendientes=0
    render(<RouteActivityRow route={BASE_ROUTE} operatorId="op-1" isOpen={true} onToggle={vi.fn()} />);
    expect(screen.getByTestId('stat-entregadas')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-fallidas')).toHaveTextContent('1');
    expect(screen.getByTestId('stat-pendientes')).toHaveTextContent('0');
  });
});
```

- [ ] **Step 3.2: Run tests — confirm new tests FAIL, old tests still PASS**

```bash
cd apps/frontend && npx vitest run src/components/dispatch/RouteActivityRow.test.tsx
```

- [ ] **Step 3.3: Implement the expanded panel**

In `RouteActivityRow.tsx`:

1. Add the `Skeleton` import at the top:
```tsx
import { Skeleton } from '@/components/ui/skeleton';
```

2. Replace the empty `{isOpen && ...}` div with:

```tsx
{isOpen && (
  <div data-testid="route-expanded-panel" className="border-t border-border flex h-80">
    {/* Order list — left pane (260px) */}
    <div className="w-[260px] flex-shrink-0 border-r border-border overflow-y-auto">
      {isLoading && (
        <div data-testid="orders-loading" className="p-3 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      )}
      {isError && (
        <div className="p-4 flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-text-secondary">No se pudo cargar las órdenes</p>
          <button onClick={() => refetch()} className="text-xs text-accent underline" aria-label="Reintentar">
            Reintentar
          </button>
        </div>
      )}
      {!isLoading && !isError && dispatches.map((d) => (
        <button
          key={d.dispatch_id}
          onClick={() => setSelectedId(d.dispatch_id)}
          className={cn(
            'w-full text-left flex items-center gap-2.5 px-4 py-2.5 border-l-2 transition-colors hover:bg-surface-raised',
            effectiveSelectedId === d.dispatch_id ? 'border-blue-500 bg-surface-raised' : 'border-transparent',
          )}
        >
          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', {
            'bg-green-500': d.status === 'delivered',
            'bg-red-500':   d.status === 'failed',
            'bg-amber-500': d.status === 'partial',
            'bg-slate-500': d.status === 'pending',
          })} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-mono font-semibold text-text truncate">{d.order_number}</p>
            <p className="text-[11px] text-text-secondary truncate">{d.contact_address ?? '—'}</p>
          </div>
        </button>
      ))}
    </div>

    {/* Order detail — middle pane */}
    <div className="flex-1 overflow-y-auto p-5">
      {selectedOrder ? (
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-text-secondary mb-2">Orden</p>
            <div className="grid grid-cols-2 gap-3">
              <div><p className="text-xs text-text-secondary">Número</p><p className="text-sm font-mono font-semibold text-accent">{selectedOrder.order_number}</p></div>
              <div><p className="text-xs text-text-secondary">Estado</p><p className="text-sm font-medium text-text capitalize">{selectedOrder.status}</p></div>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-bold tracking-widest uppercase text-text-secondary mb-2">Destinatario</p>
            <div className="space-y-2">
              <div><p className="text-xs text-text-secondary">Nombre</p><p className="text-sm text-text">{selectedOrder.contact_name ?? '—'}</p></div>
              <div><p className="text-xs text-text-secondary">Teléfono</p><p data-testid="order-phone" className="text-sm text-text">{selectedOrder.contact_phone ?? '—'}</p></div>
              <div><p className="text-xs text-text-secondary">Dirección</p><p className="text-sm text-text">{selectedOrder.contact_address ?? '—'}</p></div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-secondary text-center mt-8">Selecciona una orden</p>
      )}
    </div>

    {/* Map placeholder — right pane (280px) */}
    <div data-testid="map-placeholder" className="w-[280px] flex-shrink-0 border-l border-border flex flex-col items-center justify-center gap-2 bg-surface">
      <span className="text-3xl">🗺</span>
      <p className="text-xs text-text-secondary text-center leading-relaxed">Mapa Leaflet<br /><em className="opacity-50">próximo sprint</em></p>
    </div>
  </div>
)}
```

- [ ] **Step 3.4: Run tests — confirm all PASS**

```bash
cd apps/frontend && npx vitest run src/components/dispatch/RouteActivityRow.test.tsx
```

- [ ] **Step 3.5: Commit**

```bash
git add apps/frontend/src/components/dispatch/RouteActivityRow.tsx \
        apps/frontend/src/components/dispatch/RouteActivityRow.test.tsx
git commit -m "feat(spec-38): RouteActivityRow expanded panel — order list + detail pane"
```

---

### Chunk 4 — Extract `DispatchInProgressTab` and wire up

**Files:**
- Create: `apps/frontend/src/components/dispatch/DispatchInProgressTab.tsx`
- Create: `apps/frontend/src/components/dispatch/DispatchInProgressTab.test.tsx`
- Modify: `apps/frontend/src/app/app/dispatch/page.tsx`

---

- [ ] **Step 4.1: Write failing tests**

Create `apps/frontend/src/components/dispatch/DispatchInProgressTab.test.tsx`:

```tsx
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DispatchRoute } from '@/lib/dispatch/types';

const mockUseDispatchRoutesByStatus = vi.fn();
vi.mock('@/hooks/dispatch/useDispatchRoutesByStatus', () => ({
  useDispatchRoutesByStatus: (...args: unknown[]) => mockUseDispatchRoutesByStatus(...args),
}));

vi.mock('./RouteActivityRow', () => ({
  RouteActivityRow: ({ route, isOpen, onToggle }: { route: DispatchRoute; isOpen: boolean; onToggle: () => void }) =>
    React.createElement('div', { 'data-testid': `row-${route.id}`, 'data-open': String(isOpen), onClick: onToggle }, route.driver_name),
}));

import { DispatchInProgressTab } from './DispatchInProgressTab';

const ROUTES: DispatchRoute[] = [
  { id: 'r1', operator_id: 'op-1', external_route_id: 'DT-1', route_date: '2026-04-24',
    driver_name: 'Juan', vehicle_id: null, truck_identifier: null, status: 'in_progress',
    planned_stops: 10, completed_stops: 9, created_at: '2026-04-24T08:00:00Z' },
  { id: 'r2', operator_id: 'op-1', external_route_id: 'DT-2', route_date: '2026-04-24',
    driver_name: 'Ana', vehicle_id: null, truck_identifier: null, status: 'in_progress',
    planned_stops: 8, completed_stops: 4, created_at: '2026-04-24T08:00:00Z' },
];

describe('DispatchInProgressTab', () => {
  beforeEach(() => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: ROUTES, isLoading: false });
  });

  it('renders a RouteActivityRow for each in-progress route', () => {
    render(<DispatchInProgressTab operatorId="op-1" />);
    expect(screen.getByTestId('row-r1')).toBeInTheDocument();
    expect(screen.getByTestId('row-r2')).toBeInTheDocument();
  });

  it('only one row is open at a time (accordion)', () => {
    render(<DispatchInProgressTab operatorId="op-1" />);
    fireEvent.click(screen.getByTestId('row-r1'));
    expect(screen.getByTestId('row-r1')).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('row-r2')).toHaveAttribute('data-open', 'false');
    fireEvent.click(screen.getByTestId('row-r2'));
    expect(screen.getByTestId('row-r1')).toHaveAttribute('data-open', 'false');
    expect(screen.getByTestId('row-r2')).toHaveAttribute('data-open', 'true');
  });

  it('clicking the open row again closes it', () => {
    render(<DispatchInProgressTab operatorId="op-1" />);
    fireEvent.click(screen.getByTestId('row-r1'));
    fireEvent.click(screen.getByTestId('row-r1'));
    expect(screen.getByTestId('row-r1')).toHaveAttribute('data-open', 'false');
  });

  it('renders the fleet summary strip', () => {
    render(<DispatchInProgressTab operatorId="op-1" />);
    expect(screen.getByTestId('fleet-summary')).toBeInTheDocument();
  });

  it('fleet summary shows weighted cumplimiento promedio', () => {
    // r1: 9/10, r2: 4/8 → (9+4)/(10+8) = 13/18 = 72.2%
    render(<DispatchInProgressTab operatorId="op-1" />);
    expect(screen.getByTestId('fleet-cumplimiento')).toHaveTextContent('72.2%');
  });

  it('shows EmptyState when there are no in-progress routes', () => {
    mockUseDispatchRoutesByStatus.mockReturnValue({ data: [], isLoading: false });
    render(<DispatchInProgressTab operatorId="op-1" />);
    expect(screen.getByText(/Sin rutas en camino/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4.2: Run tests — confirm FAIL**

```bash
cd apps/frontend && npx vitest run src/components/dispatch/DispatchInProgressTab.test.tsx
```

- [ ] **Step 4.3: Implement the extracted component**

Create `apps/frontend/src/components/dispatch/DispatchInProgressTab.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Truck } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { useDispatchRoutesByStatus } from '@/hooks/dispatch/useDispatchRoutesByStatus';
import { RouteActivityRow } from './RouteActivityRow';

function RouteSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function DispatchInProgressTab({ operatorId }: { operatorId: string }) {
  const [openRouteId, setOpenRouteId] = useState<string | null>(null);
  const { data: routes, isLoading } = useDispatchRoutesByStatus(operatorId, ['in_progress']);

  if (isLoading) return <RouteSkeleton />;
  if (!routes?.length) {
    return (
      <EmptyState icon={Truck} title="Sin rutas en camino" description="Las rutas despachadas aparecerán aquí." />
    );
  }

  const handleToggle = (routeId: string) => {
    setOpenRouteId((prev) => (prev === routeId ? null : routeId));
  };

  const totalPlanned   = routes.reduce((s, r) => s + r.planned_stops, 0);
  const totalCompleted = routes.reduce((s, r) => s + r.completed_stops, 0);
  const avgCumplimiento = totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 1000) / 10 : 0;

  return (
    <div className="space-y-3">
      <div data-testid="fleet-summary" className="flex flex-wrap gap-5 px-4 py-3 bg-surface border border-border rounded-lg text-sm">
        <span><strong className="text-text">{routes.length}</strong> <span className="text-text-secondary">vehículos en ruta</span></span>
        <span><strong className="text-green-500">{totalCompleted}</strong> <span className="text-text-secondary">entregadas*</span></span>
        <span><strong data-testid="fleet-cumplimiento" className="text-text">{avgCumplimiento}%</strong> <span className="text-text-secondary">cumplimiento promedio</span></span>
        <span className="text-text-secondary text-xs self-end">* Fallidas y pendientes disponibles al expandir la ruta</span>
      </div>
      {routes.map((route) => (
        <RouteActivityRow
          key={route.id}
          route={route}
          operatorId={operatorId}
          isOpen={openRouteId === route.id}
          onToggle={() => handleToggle(route.id)}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4.4: Update `page.tsx`**

1. Delete the local `DispatchInProgressTab` function (and its imports that only it used — e.g. the `Truck` icon if not referenced elsewhere).

2. Add:
```tsx
import { DispatchInProgressTab } from '@/components/dispatch/DispatchInProgressTab';
```

3. Update the call site in `DispatchPageContent` — drop the `onNavigate` prop:
```tsx
<TabsContent value="in_progress" className="mt-4">
  <DispatchInProgressTab operatorId={operatorId} />
</TabsContent>
```

- [ ] **Step 4.5: Run tests — confirm all PASS**

```bash
cd apps/frontend
npx vitest run src/components/dispatch/DispatchInProgressTab.test.tsx \
              src/components/dispatch/RouteActivityRow.test.tsx \
              src/hooks/dispatch/useRouteDispatches.test.ts
```

- [ ] **Step 4.6: Run full suite — confirm no regressions**

```bash
cd apps/frontend && npx vitest run
```

- [ ] **Step 4.7: Commit**

```bash
git add apps/frontend/src/components/dispatch/DispatchInProgressTab.tsx \
        apps/frontend/src/components/dispatch/DispatchInProgressTab.test.tsx \
        apps/frontend/src/app/app/dispatch/page.tsx
git commit -m "feat(spec-38): extract DispatchInProgressTab and wire RouteActivityRow + fleet summary"
```

---

### Chunk 5 — Manual smoke

- [ ] Start dev server: `cd apps/frontend && npm run dev`
- [ ] Open `http://localhost:3000/app/dispatch?tab=in_progress`
- [ ] Verify collapsed rows: driver name, truck, Asignadas count, cumplimiento %, correct color
- [ ] Expand a row: order list loads, first order auto-selected, detail pane shows data
- [ ] Stat boxes update with exact Entregadas/Fallidas/Pendientes after expand (values correspond to `delivered` / `failed` / `pending`+`partial`)
- [ ] Expand a second row — first closes (accordion)
- [ ] Click multiple orders — detail pane updates each time
- [ ] Push PR:

```bash
git push origin HEAD
gh pr create --title "feat(spec-38): Route Activity View — En Ruta tab redesign" --body "$(cat <<'EOF'
## Summary
- Replaces 3-column card grid in En Ruta tab with DispatchTrack-style vertical accordion list
- Each row expands to show scrollable order list + order detail pane + map placeholder (spec-39)
- Fleet summary strip with vehicle count, entregadas, and weighted cumplimiento promedio
- New useRouteDispatches hook with 30s polling for live monitoring
- New DispatchStatus / RouteDispatchSummary types matching dispatch_status_enum

## Test plan
- [ ] useRouteDispatches tests pass (mapping + sort + error)
- [ ] RouteActivityRow unit tests pass (collapsed header + expanded panel)
- [ ] DispatchInProgressTab tests pass (accordion, fleet summary, empty state)
- [ ] Full vitest suite passes with no regressions
- [ ] Manual smoke: expand rows, select orders, verify accordion behavior

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```
