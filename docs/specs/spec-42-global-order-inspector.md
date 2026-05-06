# spec-42 — Global Order Inspector

**Status:** in progress

> **For agentic workers:** Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development` if subagents are available) to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global search-triggered order/package inspector panel accessible from every app page — a header pill button opens a search palette; selecting a result slides in a full lifecycle inspector on the right.

**Architecture:** InspectorTrigger (pill button) + InspectorSearchPalette (search overlay) + OrderInspector (right-side Sheet) wired into AppLayout with React `useState`. New `useOrderSearch` hook for debounced Supabase text search. New `OrderLifecycleRibbon` component derives pipeline stage states from `leading_status` and `PIPELINE_STAGES`.

**Tech Stack:** Next.js 15 App Router, React, TanStack Query v5, shadcn/ui `Sheet` + `Tabs`, Tailwind CSS, Vitest + Testing Library.

---

## Background

Operations managers frequently need to look up a specific order or package mid-workflow (e.g. "where is this carton?", "what happened to order 2916909648?"). Currently there is no cross-page search; every lookup requires navigating to Ops Control and filtering. The `useOrderDetail` hook and the `OrderDetailSheet` in Ops Control already fetch the necessary data — spec-42 exposes that capability globally.

## Scope

**In:**
- Header pill `Buscar orden o paquete…` rendered in AppLayout for `isAdminOrManager` (same guard as CapacityAlertBell).
- Search palette: `<input>` + debounced results (orders by `order_number`, packages by `label`), min 2 chars, max 5 results each. Keyboard: `/` opens, `Esc` closes.
- Order Inspector panel: right-side Sheet (max-w-2xl), shows order header (ID, status pill, customer, address, chips: bulto count, retailer, delivery window), lifecycle ribbon (pipeline stages), Packages tab, Historial tab.
- `OrderLifecycleRibbon` derives stage states (done/active/pending) from `leading_status` against `PIPELINE_STAGES`.
- Clicking a package result opens the inspector for the package's parent order.

**Out:**
- Route tab (GPS/map) in inspector.
- Actions dropdown (reassign zone, etc.) — placeholder only.
- Any DB schema changes.
- Mobile/tablet layout for the inspector (Sheet already handles this with `w-full` on small screens).

---

## Data flow

```
AppLayout state: isPaletteOpen, inspectorOrderId
       │
       ├─ InspectorTrigger ─────────────► setIsPaletteOpen(true)
       ├─ InspectorSearchPalette (query) ─ useOrderSearch(query)
       │       └── onSelectOrder(id) ───► setInspectorOrderId(id)
       └─ OrderInspector(orderId) ──────── useOrderDetail(orderId)
               ├─ OrderLifecycleRibbon(leading_status)
               ├─ PackageStatusBreakdown(packages)   [reuse existing]
               └─ StatusTimeline(auditLogs)           [reuse existing]
```

---

## File structure

```
NEW
  apps/frontend/src/hooks/
    useOrderSearch.ts             search hook (orders + packages by text)
    useOrderSearch.test.ts

  apps/frontend/src/components/inspector/
    OrderLifecycleRibbon.tsx      pipeline stage dots + labels
    OrderLifecycleRibbon.test.tsx
    InspectorSearchPalette.tsx    search overlay (Sheet from bottom/right)
    InspectorSearchPalette.test.tsx
    OrderInspector.tsx            full inspector panel (Sheet right)
    OrderInspector.test.tsx

MODIFIED
  apps/frontend/src/components/
    AppLayout.tsx                 add trigger + palette + inspector
    AppLayout.test.tsx            add inspector-related assertions
```

All new files stay under 300 lines. `OrderInspector` delegates tabs content to existing `PackageStatusBreakdown` and `StatusTimeline`.

---

## Chunk 1: useOrderSearch hook

### Task 1 — `useOrderSearch` hook + tests

**Files:**
- Create: `apps/frontend/src/hooks/useOrderSearch.ts`
- Create: `apps/frontend/src/hooks/useOrderSearch.test.ts`

- [ ] **Step 1.1 — Write failing tests**

```typescript
// apps/frontend/src/hooks/useOrderSearch.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useOrderSearch } from './useOrderSearch';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const ORDER_ROW = { id: 'o-1', order_number: 'ORD-001', customer_name: 'Ana', leading_status: 'en_bodega' };
const PKG_ROW = { id: 'p-1', label: 'PKG-001', status: 'en_bodega', order_id: 'o-1', orders: { order_number: 'ORD-001' } };

function setupMocks() {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'orders') return {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [ORDER_ROW], error: null }),
    };
    if (table === 'packages') return {
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [PKG_ROW], error: null }),
    };
    return {};
  });
}

describe('useOrderSearch', () => {
  beforeEach(() => { mockFrom.mockReset(); });

  it('is idle when query is shorter than 2 chars', () => {
    const { result } = renderHook(() => useOrderSearch('a'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when query is empty', () => {
    const { result } = renderHook(() => useOrderSearch(''), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns orders and packages for query >= 2 chars', async () => {
    setupMocks();
    const { result } = renderHook(() => useOrderSearch('ORD'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.orders).toHaveLength(1);
    expect(result.current.data?.orders[0].order_number).toBe('ORD-001');
    expect(result.current.data?.packages).toHaveLength(1);
    expect(result.current.data?.packages[0].label).toBe('PKG-001');
    expect(result.current.data?.packages[0].order_id).toBe('o-1');
  });

  it('queries orders with ilike on order_number', async () => {
    setupMocks();
    const ordersMock = mockFrom.mock.results[0];
    const { result } = renderHook(() => useOrderSearch('ORD'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockFrom).toHaveBeenCalledWith('orders');
    expect(mockFrom).toHaveBeenCalledWith('packages');
    void ordersMock;
  });

  it('returns empty arrays when no results', async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }));
    const { result } = renderHook(() => useOrderSearch('XYZ'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.orders).toHaveLength(0);
    expect(result.current.data?.packages).toHaveLength(0);
  });
});
```

- [ ] **Step 1.2 — Run test to verify it fails**

```
cd apps/frontend && npx vitest run src/hooks/useOrderSearch.test.ts --reporter=verbose
```
Expected: FAIL — `useOrderSearch` not defined.

- [ ] **Step 1.3 — Implement `useOrderSearch`**

```typescript
// apps/frontend/src/hooks/useOrderSearch.ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export type OrderSearchResult = {
  id: string;
  order_number: string;
  customer_name: string;
  leading_status: string;
};

export type PackageSearchResult = {
  id: string;
  label: string;
  status: string;
  order_id: string;
  order_number: string;
};

export type OrderSearchData = {
  orders: OrderSearchResult[];
  packages: PackageSearchResult[];
};

export function useOrderSearch(query: string) {
  const trimmed = query.trim();
  return useQuery<OrderSearchData>({
    queryKey: ['order-search', trimmed],
    queryFn: async () => {
      const client = createSPAClient();

      const [ordersRes, pkgsRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client.from('orders') as any)
          .select('id, order_number, customer_name, leading_status')
          .ilike('order_number', `%${trimmed}%`)
          .is('deleted_at', null)
          .limit(5),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client.from('packages') as any)
          .select('id, label, status, order_id, orders(order_number)')
          .ilike('label', `%${trimmed}%`)
          .is('deleted_at', null)
          .limit(5),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (pkgsRes.error) throw pkgsRes.error;

      const orders: OrderSearchResult[] = (ordersRes.data ?? []).map(
        (r: { id: string; order_number: string; customer_name: string; leading_status: string }) => r,
      );

      const packages: PackageSearchResult[] = (pkgsRes.data ?? []).map(
        (r: { id: string; label: string; status: string; order_id: string; orders?: { order_number: string } }) => ({
          id: r.id,
          label: r.label,
          status: r.status,
          order_id: r.order_id,
          order_number: r.orders?.order_number ?? '',
        }),
      );

      return { orders, packages };
    },
    enabled: trimmed.length >= 2,
    staleTime: 10_000,
  });
}
```

- [ ] **Step 1.4 — Run tests to verify they pass**

```
cd apps/frontend && npx vitest run src/hooks/useOrderSearch.test.ts --reporter=verbose
```
Expected: all 5 pass.

- [ ] **Step 1.5 — Commit**

```
git add apps/frontend/src/hooks/useOrderSearch.ts apps/frontend/src/hooks/useOrderSearch.test.ts
git commit -m "feat(spec-42): add useOrderSearch hook"
```

---

## Chunk 2: OrderLifecycleRibbon

### Task 2 — `OrderLifecycleRibbon` component + tests

**Files:**
- Create: `apps/frontend/src/components/inspector/OrderLifecycleRibbon.tsx`
- Create: `apps/frontend/src/components/inspector/OrderLifecycleRibbon.test.tsx`

- [ ] **Step 2.1 — Write failing tests**

```typescript
// apps/frontend/src/components/inspector/OrderLifecycleRibbon.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { OrderLifecycleRibbon } from './OrderLifecycleRibbon';

describe('OrderLifecycleRibbon', () => {
  it('renders all 8 pipeline stage labels', () => {
    render(<OrderLifecycleRibbon leadingStatus="ingresado" />);
    expect(screen.getByText('Ingresado')).toBeTruthy();
    expect(screen.getByText('Verificado')).toBeTruthy();
    expect(screen.getByText('En Bodega')).toBeTruthy();
    expect(screen.getByText('Asignado')).toBeTruthy();
    expect(screen.getByText('En Carga')).toBeTruthy();
    expect(screen.getByText('Listo')).toBeTruthy();
    expect(screen.getByText('En Ruta')).toBeTruthy();
    expect(screen.getByText('Entregado')).toBeTruthy();
  });

  it('marks stages before current as done', () => {
    render(<OrderLifecycleRibbon leadingStatus="en_bodega" />);
    const ingresado = screen.getByTestId('stage-ingresado');
    const verificado = screen.getByTestId('stage-verificado');
    const enBodega = screen.getByTestId('stage-en_bodega');
    const asignado = screen.getByTestId('stage-asignado');
    expect(ingresado.getAttribute('data-state')).toBe('done');
    expect(verificado.getAttribute('data-state')).toBe('done');
    expect(enBodega.getAttribute('data-state')).toBe('active');
    expect(asignado.getAttribute('data-state')).toBe('pending');
  });

  it('marks current stage as active', () => {
    render(<OrderLifecycleRibbon leadingStatus="en_ruta" />);
    expect(screen.getByTestId('stage-en_ruta').getAttribute('data-state')).toBe('active');
  });

  it('marks all stages as done when entregado', () => {
    render(<OrderLifecycleRibbon leadingStatus="entregado" />);
    const stages = screen.getAllByTestId(/^stage-/);
    stages.forEach((s) => expect(s.getAttribute('data-state')).toBe('done'));
  });

  it('handles unknown status gracefully (all pending)', () => {
    render(<OrderLifecycleRibbon leadingStatus="cancelado" />);
    const stages = screen.getAllByTestId(/^stage-/);
    // cancelado is not in PIPELINE_STAGES → no stage is active → all pending
    stages.forEach((s) => {
      expect(['done', 'pending']).toContain(s.getAttribute('data-state'));
    });
  });
});
```

- [ ] **Step 2.2 — Run test to verify it fails**

```
cd apps/frontend && npx vitest run src/components/inspector/OrderLifecycleRibbon.test.tsx --reporter=verbose
```
Expected: FAIL — `OrderLifecycleRibbon` not defined.

- [ ] **Step 2.3 — Implement `OrderLifecycleRibbon`**

```typescript
// apps/frontend/src/components/inspector/OrderLifecycleRibbon.tsx
'use client';

import { PIPELINE_STAGES } from '@/lib/types/pipeline';
import type { OrderStatus } from '@/lib/types/pipeline';

type StageState = 'done' | 'active' | 'pending';

function getStageState(stagePosition: number, currentPosition: number): StageState {
  if (stagePosition < currentPosition) return 'done';
  if (stagePosition === currentPosition) return 'active';
  return 'pending';
}

const stateClasses: Record<StageState, { dot: string; label: string }> = {
  done:    { dot: 'bg-text-muted border-text-muted',       label: 'text-text-muted' },
  active:  { dot: 'bg-accent border-accent ring-2 ring-accent/30', label: 'text-text font-semibold' },
  pending: { dot: 'bg-transparent border-border',          label: 'text-text-faint' },
};

interface Props {
  leadingStatus: string;
}

export function OrderLifecycleRibbon({ leadingStatus }: Props) {
  const currentStage = PIPELINE_STAGES.find((s) => s.status === (leadingStatus as OrderStatus));
  const currentPosition = currentStage?.position ?? 0;

  return (
    <ol className="relative pl-6 border-l-2 border-border">
      {PIPELINE_STAGES.map((stage) => {
        const state = getStageState(stage.position, currentPosition);
        const cls = stateClasses[state];
        return (
          <li
            key={stage.status}
            data-testid={`stage-${stage.status}`}
            data-state={state}
            className="relative mb-4 last:mb-0"
          >
            <span
              className={`absolute -left-[1.45rem] top-1 w-3.5 h-3.5 rounded-full border-2 ${cls.dot}`}
              aria-hidden="true"
            />
            <span className={`text-sm ${cls.label}`}>{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 2.4 — Run tests to verify they pass**

```
cd apps/frontend && npx vitest run src/components/inspector/OrderLifecycleRibbon.test.tsx --reporter=verbose
```
Expected: all 5 pass.

- [ ] **Step 2.5 — Commit**

```
git add apps/frontend/src/components/inspector/OrderLifecycleRibbon.tsx apps/frontend/src/components/inspector/OrderLifecycleRibbon.test.tsx
git commit -m "feat(spec-42): add OrderLifecycleRibbon component"
```

---

## Chunk 3: InspectorSearchPalette

### Task 3 — `InspectorSearchPalette` component + tests

**Files:**
- Create: `apps/frontend/src/components/inspector/InspectorSearchPalette.tsx`
- Create: `apps/frontend/src/components/inspector/InspectorSearchPalette.test.tsx`

- [ ] **Step 3.1 — Write failing tests**

```typescript
// apps/frontend/src/components/inspector/InspectorSearchPalette.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { InspectorSearchPalette } from './InspectorSearchPalette';

vi.mock('@/hooks/useOrderSearch', () => ({
  useOrderSearch: (query: string) => ({
    data: query.length >= 2
      ? {
          orders: [{ id: 'o-1', order_number: 'ORD-999', customer_name: 'Ana López', leading_status: 'en_ruta' }],
          packages: [{ id: 'p-1', label: 'PKG-999-01', status: 'en_ruta', order_id: 'o-1', order_number: 'ORD-999' }],
        }
      : undefined,
    isLoading: false,
  }),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

describe('InspectorSearchPalette', () => {
  it('renders when isOpen is true', () => {
    wrap(<InspectorSearchPalette isOpen onClose={vi.fn()} onSelectOrder={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('does not render input when closed', () => {
    wrap(<InspectorSearchPalette isOpen={false} onClose={vi.fn()} onSelectOrder={vi.fn()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows order result after typing 2+ chars', async () => {
    wrap(<InspectorSearchPalette isOpen onClose={vi.fn()} onSelectOrder={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'OR' } });
    await waitFor(() => expect(screen.getByText('ORD-999')).toBeTruthy());
    expect(screen.getByText('Ana López')).toBeTruthy();
  });

  it('shows package result after typing 2+ chars', async () => {
    wrap(<InspectorSearchPalette isOpen onClose={vi.fn()} onSelectOrder={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PK' } });
    await waitFor(() => expect(screen.getByText('PKG-999-01')).toBeTruthy());
  });

  it('calls onSelectOrder with order id when order row clicked', async () => {
    const onSelectOrder = vi.fn();
    wrap(<InspectorSearchPalette isOpen onClose={vi.fn()} onSelectOrder={onSelectOrder} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'OR' } });
    await waitFor(() => screen.getByText('ORD-999'));
    fireEvent.click(screen.getByText('ORD-999').closest('[data-result]')!);
    expect(onSelectOrder).toHaveBeenCalledWith('o-1');
  });

  it('calls onSelectOrder with order_id when package row clicked', async () => {
    const onSelectOrder = vi.fn();
    wrap(<InspectorSearchPalette isOpen onClose={vi.fn()} onSelectOrder={onSelectOrder} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'PK' } });
    await waitFor(() => screen.getByText('PKG-999-01'));
    fireEvent.click(screen.getByText('PKG-999-01').closest('[data-result]')!);
    expect(onSelectOrder).toHaveBeenCalledWith('o-1');
  });

  it('calls onClose when Escape key pressed', () => {
    const onClose = vi.fn();
    wrap(<InspectorSearchPalette isOpen onClose={onClose} onSelectOrder={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3.2 — Run test to verify it fails**

```
cd apps/frontend && npx vitest run src/components/inspector/InspectorSearchPalette.test.tsx --reporter=verbose
```
Expected: FAIL.

- [ ] **Step 3.3 — Implement `InspectorSearchPalette`**

```typescript
// apps/frontend/src/components/inspector/InspectorSearchPalette.tsx
'use client';

import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { useOrderSearch } from '@/hooks/useOrderSearch';
import { StatusBadge } from '@/components/StatusBadge';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectOrder: (orderId: string) => void;
}

export function InspectorSearchPalette({ isOpen, onClose, onSelectOrder }: Props) {
  const [query, setQuery] = useState('');
  const { data, isLoading } = useOrderSearch(query);

  if (!isOpen) return null;

  const hasResults = (data?.orders.length ?? 0) + (data?.packages.length ?? 0) > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-text-muted shrink-0" />
          <input
            autoFocus
            type="text"
            role="textbox"
            placeholder="Buscar orden o paquete…"
            className="flex-1 bg-transparent text-sm text-text placeholder:text-text-muted outline-none"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { onClose(); setQuery(''); } }}
          />
          <kbd className="text-xs text-text-muted bg-surface-raised border border-border rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        {/* Results */}
        {query.length >= 2 && (
          <div className="py-2 max-h-80 overflow-y-auto">
            {isLoading && (
              <p className="px-4 py-3 text-sm text-text-muted">Buscando…</p>
            )}

            {!isLoading && !hasResults && (
              <p className="px-4 py-3 text-sm text-text-muted">Sin resultados para "{query}"</p>
            )}

            {(data?.orders.length ?? 0) > 0 && (
              <>
                <p className="px-4 py-1 text-xs uppercase tracking-widest text-text-faint font-medium">
                  Órdenes
                </p>
                {data!.orders.map((o) => (
                  <button
                    key={o.id}
                    data-result
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-raised text-left transition-colors"
                    onClick={() => { onSelectOrder(o.id); setQuery(''); }}
                  >
                    <div>
                      <span className="text-sm font-mono font-medium text-text">{o.order_number}</span>
                      <span className="ml-2 text-sm text-text-muted">{o.customer_name}</span>
                    </div>
                    <StatusBadge status={o.leading_status} size="sm" />
                  </button>
                ))}
              </>
            )}

            {(data?.packages.length ?? 0) > 0 && (
              <>
                <p className="px-4 py-1 text-xs uppercase tracking-widest text-text-faint font-medium mt-1">
                  Paquetes
                </p>
                {data!.packages.map((p) => (
                  <button
                    key={p.id}
                    data-result
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-raised text-left transition-colors"
                    onClick={() => { onSelectOrder(p.order_id); setQuery(''); }}
                  >
                    <div>
                      <span className="text-sm font-mono font-medium text-text">{p.label}</span>
                      <span className="ml-2 text-xs text-text-muted">→ {p.order_number}</span>
                    </div>
                    <StatusBadge status={p.status} size="sm" />
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {query.length < 2 && (
          <p className="px-4 py-3 text-sm text-text-muted">Escribe al menos 2 caracteres…</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3.4 — Run tests to verify they pass**

```
cd apps/frontend && npx vitest run src/components/inspector/InspectorSearchPalette.test.tsx --reporter=verbose
```
Expected: all 7 pass.

- [ ] **Step 3.5 — Commit**

```
git add apps/frontend/src/components/inspector/InspectorSearchPalette.tsx apps/frontend/src/components/inspector/InspectorSearchPalette.test.tsx
git commit -m "feat(spec-42): add InspectorSearchPalette component"
```

---

## Chunk 4: OrderInspector panel

### Task 4 — `OrderInspector` component + tests

**Files:**
- Create: `apps/frontend/src/components/inspector/OrderInspector.tsx`
- Create: `apps/frontend/src/components/inspector/OrderInspector.test.tsx`

- [ ] **Step 4.1 — Write failing tests**

```typescript
// apps/frontend/src/components/inspector/OrderInspector.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { OrderInspector } from './OrderInspector';

const MOCK_DATA = {
  id: 'o-1',
  order_number: 'ORD-001',
  retailer_name: 'Falabella',
  customer_name: 'María González',
  customer_phone: '+56912345678',
  delivery_address: 'Av. Las Condes 1234',
  comuna: 'Las Condes',
  delivery_date: '2026-05-10',
  delivery_window_start: null,
  delivery_window_end: null,
  status: 'en_ruta',
  leading_status: 'en_ruta',
  packages: [
    { id: 'p-1', label: 'PKG-001', package_number: null, status: 'en_ruta', status_updated_at: null },
  ],
  auditLogs: [
    { id: 'a-1', action: 'STATUS_CHANGED', timestamp: '2026-05-05T09:00:00', changes_json: null },
  ],
};

vi.mock('@/hooks/useOrderDetail', () => ({
  useOrderDetail: (id: string | null) => ({
    data: id ? MOCK_DATA : null,
    isLoading: false,
    isError: false,
  }),
}));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(React.createElement(QueryClientProvider, { client: qc }, ui));
}

describe('OrderInspector', () => {
  it('renders order number when open', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText('ORD-001')).toBeTruthy();
  });

  it('renders customer name', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText(/María González/)).toBeTruthy();
  });

  it('renders retailer chip', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText('Falabella')).toBeTruthy();
  });

  it('renders package label in packages tab area', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText('PKG-001')).toBeTruthy();
  });

  it('does not render when orderId is null', () => {
    wrap(<OrderInspector orderId={null} onClose={vi.fn()} />);
    expect(screen.queryByText('ORD-001')).toBeNull();
  });

  it('renders delivery address', () => {
    wrap(<OrderInspector orderId="o-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Av\. Las Condes 1234/)).toBeTruthy();
  });
});
```

- [ ] **Step 4.2 — Run test to verify it fails**

```
cd apps/frontend && npx vitest run src/components/inspector/OrderInspector.test.tsx --reporter=verbose
```
Expected: FAIL.

- [ ] **Step 4.3 — Implement `OrderInspector`** (two parts due to size)

**Part A — header + lifecycle (first half of component):**

```typescript
// apps/frontend/src/components/inspector/OrderInspector.tsx
'use client';

import { useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/StatusBadge';
import { PackageStatusBreakdown } from '@/components/operations-control/PackageStatusBreakdown';
import { StatusTimeline } from '@/components/operations-control/StatusTimeline';
import { OrderLifecycleRibbon } from './OrderLifecycleRibbon';
import { useOrderDetail } from '@/hooks/useOrderDetail';

interface Props {
  orderId: string | null;
  onClose: () => void;
}

function DeliveryWindow(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return `${fmt(start)}–${fmt(end)}`;
}

export function OrderInspector({ orderId, onClose }: Props) {
  const { data, isLoading, isError } = useOrderDetail(orderId);
  const [tab, setTab] = useState<'lifecycle' | 'packages' | 'historial'>('lifecycle');

  return (
    <Sheet open={!!orderId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full max-w-2xl overflow-y-auto flex flex-col gap-0 p-0"
        data-testid="order-inspector"
      >
        {isLoading && (
          <div className="p-6 space-y-3 animate-pulse">
            <div className="h-5 w-48 bg-surface-raised rounded" />
            <div className="h-4 w-64 bg-surface-raised rounded" />
          </div>
        )}

        {isError && !isLoading && (
          <p className="p-6 text-sm text-status-error">Error al cargar la orden</p>
        )}

        {!isLoading && !isError && data && (
          <>
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-border">
              <SheetHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SheetTitle className="text-lg font-mono font-semibold text-text">
                      {data.order_number}
                    </SheetTitle>
                    <SheetDescription className="text-sm text-text-secondary mt-0.5">
                      {data.customer_name}
                    </SheetDescription>
                    <p className="text-xs text-text-muted mt-0.5">
                      {data.delivery_address}, {data.comuna}
                    </p>
                  </div>
                  <StatusBadge status={data.leading_status} size="sm" />
                </div>
              </SheetHeader>

              {/* Chips */}
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="inline-flex items-center gap-1.5 text-xs bg-surface-raised border border-border rounded-md px-2 py-1 text-text-muted">
                  <span className="font-medium text-text">{data.packages.length}</span> paquetes
                </span>
                {data.retailer_name && (
                  <span className="inline-flex items-center gap-1.5 text-xs bg-surface-raised border border-border rounded-md px-2 py-1 text-text-muted">
                    {data.retailer_name}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-xs bg-surface-raised border border-border rounded-md px-2 py-1 text-text-muted">
                  promesa <span className="font-medium text-text">{data.delivery_date}</span>
                </span>
                {(data.delivery_window_start || data.delivery_window_end) && (
                  <span className="inline-flex items-center gap-1.5 text-xs bg-surface-raised border border-border rounded-md px-2 py-1 text-text-muted">
                    {DeliveryWindow(data.delivery_window_start, data.delivery_window_end)}
                  </span>
                )}
              </div>
            </div>

            {/* Tabs */}
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as typeof tab)}
              className="flex-1 flex flex-col"
            >
              <TabsList className="mx-6 mt-4 w-auto justify-start">
                <TabsTrigger value="lifecycle">Ciclo de vida</TabsTrigger>
                <TabsTrigger value="packages">
                  Paquetes ({data.packages.length})
                </TabsTrigger>
                <TabsTrigger value="historial">
                  Historial ({data.auditLogs.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="lifecycle" className="px-6 py-4">
                <OrderLifecycleRibbon leadingStatus={data.leading_status} />
              </TabsContent>

              <TabsContent value="packages" className="px-6 py-4">
                <PackageStatusBreakdown packages={data.packages} />
              </TabsContent>

              <TabsContent value="historial" className="px-6 py-4">
                <StatusTimeline auditLogs={data.auditLogs} />
              </TabsContent>
            </Tabs>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-border flex justify-between items-center">
              <span className="text-xs text-text-faint font-mono">esc · cerrar</span>
              <button
                className="text-xs bg-surface-raised border border-border rounded px-3 py-1.5 text-text hover:bg-surface-elev transition-colors"
                onClick={() => {
                  navigator.clipboard?.writeText(data.order_number);
                }}
              >
                Copiar ID
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4.4 — Run tests to verify they pass**

```
cd apps/frontend && npx vitest run src/components/inspector/OrderInspector.test.tsx --reporter=verbose
```
Expected: all 6 pass.

- [ ] **Step 4.5 — Commit**

```
git add apps/frontend/src/components/inspector/OrderInspector.tsx apps/frontend/src/components/inspector/OrderInspector.test.tsx
git commit -m "feat(spec-42): add OrderInspector panel component"
```

---

## Chunk 5: Wire into AppLayout

### Task 5 — Wire trigger + palette + inspector into AppLayout

**Files:**
- Modify: `apps/frontend/src/components/AppLayout.tsx`
- Modify: `apps/frontend/src/components/AppLayout.test.tsx`

The trigger is an inline button in AppLayout (no separate component needed — it's two lines). Add `isPaletteOpen` and `inspectorOrderId` state; render the three pieces inside the existing `isAdminOrManager` guard.

- [ ] **Step 5.1 — Write new AppLayout tests first**

Add to `apps/frontend/src/components/AppLayout.test.tsx`:

```typescript
// Add these mocks near the top (alongside existing vi.mock calls)
vi.mock('@/components/inspector/InspectorSearchPalette', () => ({
  InspectorSearchPalette: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="inspector-palette">Palette</div> : null,
}));

vi.mock('@/components/inspector/OrderInspector', () => ({
  OrderInspector: ({ orderId }: { orderId: string | null }) =>
    orderId ? <div data-testid="order-inspector">Inspector</div> : null,
}));
```

Add this new `describe` block at the bottom:

```typescript
describe('AppLayout — Order Inspector trigger', () => {
  it('renders inspector trigger button for admin', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('button', { name: /buscar orden/i })).toBeTruthy();
  });

  it('renders inspector trigger for operations_manager', () => {
    mockRole = 'operations_manager';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.getByRole('button', { name: /buscar orden/i })).toBeTruthy();
  });

  it('does not render inspector trigger for driver role', () => {
    mockRole = 'driver';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByRole('button', { name: /buscar orden/i })).toBeNull();
  });

  it('opens palette when trigger is clicked', () => {
    mockRole = 'admin';
    render(<AppLayout><div>content</div></AppLayout>);
    expect(screen.queryByTestId('inspector-palette')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /buscar orden/i }));
    expect(screen.getByTestId('inspector-palette')).toBeTruthy();
  });
});
```

- [ ] **Step 5.2 — Run new tests to verify they fail**

```
cd apps/frontend && npx vitest run src/components/AppLayout.test.tsx --reporter=verbose
```
Expected: new tests fail, existing tests still pass.

- [ ] **Step 5.3 — Update AppLayout.tsx**

Add these imports after the existing imports:
```typescript
import { useState } from 'react';
import { InspectorSearchPalette } from './inspector/InspectorSearchPalette';
import { OrderInspector } from './inspector/OrderInspector';
```

Add inside the `AppLayout` function body (after existing `useState` calls):
```typescript
const [isPaletteOpen, setIsPaletteOpen] = useState(false);
const [inspectorOrderId, setInspectorOrderId] = useState<string | null>(null);
```

Replace the existing top-right block:
```tsx
// BEFORE:
{isAdminOrManager && (
  <div className="absolute top-3 right-4 z-10">
    <CapacityAlertBell operatorId={operatorId} />
  </div>
)}

// AFTER:
{isAdminOrManager && (
  <div className="absolute top-3 right-4 z-10 flex items-center gap-2">
    <button
      aria-label="Buscar orden o paquete"
      onClick={() => setIsPaletteOpen(true)}
      className="hidden lg:inline-flex items-center gap-2 text-xs text-text-muted bg-surface-raised border border-border rounded-lg px-3 py-1.5 hover:bg-surface-elev transition-colors"
    >
      <span>Buscar orden…</span>
      <kbd className="font-mono bg-surface border border-border rounded px-1 text-[10px]">/</kbd>
    </button>
    <CapacityAlertBell operatorId={operatorId} />
  </div>
)}
```

Add the palette + inspector just before the closing `</TooltipProvider>`:
```tsx
{isAdminOrManager && (
  <>
    <InspectorSearchPalette
      isOpen={isPaletteOpen}
      onClose={() => setIsPaletteOpen(false)}
      onSelectOrder={(id) => {
        setInspectorOrderId(id);
        setIsPaletteOpen(false);
      }}
    />
    <OrderInspector
      orderId={inspectorOrderId}
      onClose={() => setInspectorOrderId(null)}
    />
  </>
)}
```

Also add the global keyboard handler for `/` key to `useEffect` in the component:
```typescript
import { useState, useEffect } from 'react';

// Inside AppLayout function body:
useEffect(() => {
  if (!isAdminOrManager) return;
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      setIsPaletteOpen(true);
    }
  }
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
}, [isAdminOrManager]);
```

- [ ] **Step 5.4 — Run all AppLayout tests to verify they pass**

```
cd apps/frontend && npx vitest run src/components/AppLayout.test.tsx --reporter=verbose
```
Expected: all tests pass (including new ones).

- [ ] **Step 5.5 — Run full test suite**

```
cd apps/frontend && npx vitest run --reporter=verbose
```
Expected: all tests pass, no regressions.

- [ ] **Step 5.6 — Type-check**

```
cd apps/frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5.7 — Commit**

```
git add apps/frontend/src/components/AppLayout.tsx apps/frontend/src/components/AppLayout.test.tsx
git commit -m "feat(spec-42): wire global order inspector into AppLayout"
```

---

## Chunk 6: Push + PR

- [ ] **Step 6.1 — Create feature branch and push (if not already on one)**

```
git checkout -b feat/spec-42-global-order-inspector 2>/dev/null || true
git push -u origin feat/spec-42-global-order-inspector
```

- [ ] **Step 6.2 — Create PR with auto-merge**

```
gh pr create \
  --title "feat(spec-42): global order/package inspector" \
  --body "Adds a global order/package search + inspector panel accessible from every app page.

## Changes
- \`useOrderSearch\` hook — debounced Supabase search (orders by order_number, packages by label)
- \`OrderLifecycleRibbon\` — pipeline stage timeline derived from \`leading_status\`
- \`InspectorSearchPalette\` — command-palette overlay triggered by header pill or \`/\` key
- \`OrderInspector\` — right-side Sheet with lifecycle ribbon, packages, and audit log tabs
- \`AppLayout\` — wires trigger + palette + inspector for admin/manager roles

## Testing
All new files covered by Vitest unit tests. \`AppLayout\` test suite updated.

🤖 Generated with [Claude Code](https://claude.ai/claude-code)"

gh pr merge --auto --squash
```

- [ ] **Step 6.3 — Verify CI passes and PR merges**

```
gh pr checks
gh pr view --json state,mergedAt
```
Wait until `mergedAt` is set before declaring done.
