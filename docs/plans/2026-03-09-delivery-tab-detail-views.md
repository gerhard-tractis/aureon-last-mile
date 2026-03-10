# Delivery Tab Detail Views Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add three detail sections below the existing DeliveryTab KPI cards: OTIF by retailer table, late deliveries table, and a paginated/filterable orders detail table with expandable rows. Outcome/pending cards become clickable scroll anchors that pre-filter the orders table.

**Architecture:** Three new Supabase RPCs (one migration), three new TanStack Query hooks added to `useDeliveryMetrics.ts`, four new React components, and modifications to `DeliveryTab.tsx` for card click handlers and section rendering. All RPCs use `America/Santiago` timezone and `SECURITY INVOKER`.

**Tech Stack:** Supabase RPCs (PostgreSQL), React, TanStack Query, Tailwind CSS, Vitest + React Testing Library.

---

### Task 1: SQL Migration — Three New RPCs

**Files:**
- Create: `apps/frontend/supabase/migrations/20260309000002_create_delivery_detail_functions.sql`

**Step 1: Write the migration file**

```sql
-- Migration: Detail RPCs for Delivery tab — OTIF by retailer, late deliveries, orders detail
-- All functions use SECURITY INVOKER so RLS policies apply.
-- All timestamps compared using America/Santiago timezone.

-- 1. OTIF breakdown by retailer
CREATE OR REPLACE FUNCTION public.get_otif_by_retailer(
  p_operator_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'retailer_name', COALESCE(o.retailer_name, 'Sin cliente'),
    'total_orders', COUNT(*),
    'delivered', COUNT(*) FILTER (WHERE o.status = 'delivered'),
    'on_time', COUNT(*) FILTER (
      WHERE o.status = 'delivered'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'delivered'
          AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
          AND d.deleted_at IS NULL
      )
    ),
    'otif_pct', ROUND(
      COUNT(*) FILTER (
        WHERE o.status = 'delivered'
        AND EXISTS (
          SELECT 1 FROM dispatches d
          WHERE d.order_id = o.id
            AND d.status = 'delivered'
            AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
            AND d.deleted_at IS NULL
        )
      )::numeric / NULLIF(COUNT(*) FILTER (WHERE o.status = 'delivered'), 0) * 100,
      1
    )
  )
  FROM orders o
  WHERE o.operator_id = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at IS NULL
  GROUP BY COALESCE(o.retailer_name, 'Sin cliente')
  ORDER BY ROUND(
    COUNT(*) FILTER (
      WHERE o.status = 'delivered'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'delivered'
          AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
          AND d.deleted_at IS NULL
      )
    )::numeric / NULLIF(COUNT(*) FILTER (WHERE o.status = 'delivered'), 0) * 100,
    1
  ) ASC NULLS LAST;
$$;

-- 2. Late deliveries detail (delivered after delivery_date)
CREATE OR REPLACE FUNCTION public.get_late_deliveries(
  p_operator_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'order_number', o.order_number,
    'retailer_name', COALESCE(o.retailer_name, 'Sin cliente'),
    'delivery_date', o.delivery_date::text,
    'completed_date', (d.completed_at AT TIME ZONE 'America/Santiago')::date::text,
    'days_late', (d.completed_at AT TIME ZONE 'America/Santiago')::date - o.delivery_date,
    'driver_name', COALESCE(r.driver_name, 'Desconocido')
  )
  FROM orders o
  JOIN dispatches d ON d.order_id = o.id
    AND d.status = 'delivered'
    AND d.deleted_at IS NULL
  LEFT JOIN routes r ON d.route_id = r.id
    AND r.deleted_at IS NULL
  WHERE o.operator_id = p_operator_id
    AND o.status = 'delivered'
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at IS NULL
    AND (d.completed_at AT TIME ZONE 'America/Santiago')::date > o.delivery_date
  ORDER BY ((d.completed_at AT TIME ZONE 'America/Santiago')::date - o.delivery_date) DESC;
$$;

-- 3. Paginated orders detail with optional filters
CREATE OR REPLACE FUNCTION public.get_orders_detail(
  p_operator_id UUID,
  p_start_date DATE,
  p_end_date DATE,
  p_status TEXT DEFAULT NULL,
  p_retailer TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_overdue_only BOOLEAN DEFAULT FALSE,
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_offset INTEGER := (p_page - 1) * p_page_size;
  v_total_count BIGINT;
  v_rows JSON;
  v_today DATE := (NOW() AT TIME ZONE 'America/Santiago')::date;
BEGIN
  -- Count total matching rows
  SELECT COUNT(*) INTO v_total_count
  FROM orders o
  WHERE o.operator_id = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at IS NULL
    AND (p_status IS NULL OR o.status::text = p_status)
    AND (p_retailer IS NULL OR o.retailer_name = p_retailer)
    AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
    AND (NOT p_overdue_only OR (o.status NOT IN ('delivered', 'failed') AND o.delivery_date < v_today));

  -- Fetch page of rows with dispatch details
  SELECT json_agg(row_data) INTO v_rows
  FROM (
    SELECT json_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'retailer_name', COALESCE(o.retailer_name, 'Sin cliente'),
      'comuna', COALESCE(o.comuna, '—'),
      'delivery_date', o.delivery_date::text,
      'status', o.status::text,
      'completed_at', (d.completed_at AT TIME ZONE 'America/Santiago')::text,
      'driver_name', COALESCE(r.driver_name, NULL),
      'route_id', r.external_route_id,
      'failure_reason', d.failure_reason,
      'days_delta', CASE
        WHEN o.status = 'delivered' AND d.completed_at IS NOT NULL
        THEN (d.completed_at AT TIME ZONE 'America/Santiago')::date - o.delivery_date
        ELSE NULL
      END
    ) AS row_data
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT d2.completed_at, d2.failure_reason, d2.route_id
      FROM dispatches d2
      WHERE d2.order_id = o.id
        AND d2.deleted_at IS NULL
      ORDER BY d2.completed_at DESC NULLS LAST
      LIMIT 1
    ) d ON true
    LEFT JOIN routes r ON d.route_id = r.id AND r.deleted_at IS NULL
    WHERE o.operator_id = p_operator_id
      AND o.delivery_date BETWEEN p_start_date AND p_end_date
      AND o.delivery_date IS NOT NULL
      AND o.deleted_at IS NULL
      AND (p_status IS NULL OR o.status::text = p_status)
      AND (p_retailer IS NULL OR o.retailer_name = p_retailer)
      AND (p_search IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (NOT p_overdue_only OR (o.status NOT IN ('delivered', 'failed') AND o.delivery_date < v_today))
    ORDER BY o.delivery_date DESC, o.order_number
    OFFSET v_offset
    LIMIT p_page_size
  ) sub;

  RETURN json_build_object(
    'rows', COALESCE(v_rows, '[]'::json),
    'total_count', v_total_count
  );
END;
$$;
```

**Step 2: Commit**

```bash
git add apps/frontend/supabase/migrations/20260309000002_create_delivery_detail_functions.sql
git commit -m "feat(3b-4): add RPCs for OTIF by retailer, late deliveries, paginated orders detail"
```

---

### Task 2: React Hooks — Three New Hooks

**Files:**
- Modify: `apps/frontend/src/hooks/useDeliveryMetrics.ts`
- Create: `apps/frontend/src/hooks/useDeliveryMetrics.test.ts` (append tests)

**Step 1: Add TypeScript interfaces and hooks to `useDeliveryMetrics.ts`**

Append below the existing `usePendingOrders` hook:

```typescript
export interface OtifByRetailer {
  retailer_name: string;
  total_orders: number;
  delivered: number;
  on_time: number;
  otif_pct: number | null;
}

export interface LateDelivery {
  order_number: string;
  retailer_name: string;
  delivery_date: string;
  completed_date: string;
  days_late: number;
  driver_name: string;
}

export interface OrderDetailRow {
  id: string;
  order_number: string;
  retailer_name: string;
  comuna: string;
  delivery_date: string;
  status: string;
  completed_at: string | null;
  driver_name: string | null;
  route_id: string | null;
  failure_reason: string | null;
  days_delta: number | null;
}

export interface OrdersDetailResult {
  rows: OrderDetailRow[];
  total_count: number;
}

export function useOtifByRetailer(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['delivery', operatorId, 'otif-by-retailer', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_otif_by_retailer',
        { p_operator_id: operatorId, p_start_date: startDate, p_end_date: endDate }
      );
      if (error) throw error;
      return data as OtifByRetailer[];
    },
    enabled: !!operatorId,
    ...DELIVERY_QUERY_OPTIONS,
  });
}

export function useLateDeliveries(
  operatorId: string | null,
  startDate: string,
  endDate: string
) {
  return useQuery({
    queryKey: ['delivery', operatorId, 'late-deliveries', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_late_deliveries',
        { p_operator_id: operatorId, p_start_date: startDate, p_end_date: endDate }
      );
      if (error) throw error;
      return data as LateDelivery[];
    },
    enabled: !!operatorId,
    ...DELIVERY_QUERY_OPTIONS,
  });
}

export function useOrdersDetail(
  operatorId: string | null,
  startDate: string,
  endDate: string,
  filters: {
    status?: string | null;
    retailer?: string | null;
    search?: string | null;
    overdueOnly?: boolean;
    page?: number;
    pageSize?: number;
  }
) {
  return useQuery({
    queryKey: ['delivery', operatorId, 'orders-detail', startDate, endDate, filters],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_orders_detail',
        {
          p_operator_id: operatorId,
          p_start_date: startDate,
          p_end_date: endDate,
          p_status: filters.status ?? null,
          p_retailer: filters.retailer ?? null,
          p_search: filters.search ?? null,
          p_overdue_only: filters.overdueOnly ?? false,
          p_page: filters.page ?? 1,
          p_page_size: filters.pageSize ?? 25,
        }
      );
      if (error) throw error;
      return data as OrdersDetailResult;
    },
    enabled: !!operatorId,
    ...DELIVERY_QUERY_OPTIONS,
  });
}
```

**Step 2: Add tests for the three new hooks to `useDeliveryMetrics.test.ts`**

Append to the existing test file:

```typescript
describe('useOtifByRetailer', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('returns OTIF by retailer array on success', async () => {
    const mockData = [
      { retailer_name: 'Falabella', total_orders: 50, delivered: 45, on_time: 40, otif_pct: 88.9 },
      { retailer_name: 'Ripley', total_orders: 30, delivered: 28, on_time: 28, otif_pct: 100.0 },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(
      () => useOtifByRetailer('op-1', '2026-03-01', '2026-03-09'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockRpc).toHaveBeenCalledWith('get_otif_by_retailer', {
      p_operator_id: 'op-1', p_start_date: '2026-03-01', p_end_date: '2026-03-09',
    });
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(
      () => useOtifByRetailer(null, '2026-03-01', '2026-03-09'),
      { wrapper }
    );
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useLateDeliveries', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('returns late deliveries on success', async () => {
    const mockData = [
      { order_number: 'ORD-001', retailer_name: 'Falabella', delivery_date: '2026-03-05',
        completed_date: '2026-03-07', days_late: 2, driver_name: 'ALEJANDRO' },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(
      () => useLateDeliveries('op-1', '2026-03-01', '2026-03-09'),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].days_late).toBe(2);
  });
});

describe('useOrdersDetail', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('returns paginated orders on success', async () => {
    const mockData = {
      rows: [
        { id: 'uuid-1', order_number: 'ORD-001', retailer_name: 'Falabella', comuna: 'Santiago',
          delivery_date: '2026-03-05', status: 'delivered', completed_at: '2026-03-05 14:30',
          driver_name: 'ALEJANDRO', route_id: 'R-123', failure_reason: null, days_delta: 0 },
      ],
      total_count: 1,
    };
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(
      () => useOrdersDetail('op-1', '2026-03-01', '2026-03-09', { page: 1 }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.total_count).toBe(1);
    expect(result.current.data!.rows).toHaveLength(1);
  });

  it('passes filters to RPC correctly', async () => {
    mockRpc.mockResolvedValue({ data: { rows: [], total_count: 0 }, error: null });

    renderHook(
      () => useOrdersDetail('op-1', '2026-03-01', '2026-03-09', {
        status: 'failed', retailer: 'Falabella', search: 'ORD', overdueOnly: false, page: 2, pageSize: 10,
      }),
      { wrapper }
    );

    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith('get_orders_detail', {
      p_operator_id: 'op-1', p_start_date: '2026-03-01', p_end_date: '2026-03-09',
      p_status: 'failed', p_retailer: 'Falabella', p_search: 'ORD',
      p_overdue_only: false, p_page: 2, p_page_size: 10,
    });
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/hooks/useDeliveryMetrics.test.ts`
Expected: All tests PASS (existing 5 + 5 new = 10)

**Step 4: Commit**

```bash
git add apps/frontend/src/hooks/useDeliveryMetrics.ts apps/frontend/src/hooks/useDeliveryMetrics.test.ts
git commit -m "feat(3b-4): add hooks for OTIF by retailer, late deliveries, paginated orders"
```

---

### Task 3: OtifByRetailerTable Component

**Files:**
- Create: `apps/frontend/src/components/dashboard/OtifByRetailerTable.tsx`
- Create: `apps/frontend/src/components/dashboard/OtifByRetailerTable.test.tsx`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const mockOtifByRetailer = vi.fn();
vi.mock('@/hooks/useDeliveryMetrics', () => ({
  useOtifByRetailer: (...args: unknown[]) => mockOtifByRetailer(...args),
}));

import OtifByRetailerTable from './OtifByRetailerTable';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const MOCK_DATA = [
  { retailer_name: 'Falabella', total_orders: 50, delivered: 45, on_time: 40, otif_pct: 88.9 },
  { retailer_name: 'Ripley', total_orders: 30, delivered: 28, on_time: 28, otif_pct: 100.0 },
  { retailer_name: 'Paris', total_orders: 20, delivered: 18, on_time: 10, otif_pct: 55.6 },
];

describe('OtifByRetailerTable', () => {
  it('renders table with retailer rows', () => {
    mockOtifByRetailer.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OtifByRetailerTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('otif-retailer-table')).toBeInTheDocument();
    expect(screen.getByText('Falabella')).toBeInTheDocument();
    expect(screen.getByText('Ripley')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();
  });

  it('applies green color to OTIF >= 95%', () => {
    mockOtifByRetailer.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OtifByRetailerTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    // Ripley has 100% OTIF
    const ripleyRow = screen.getByText('100.0').closest('td');
    expect(ripleyRow?.className).toContain('text-emerald');
  });

  it('applies red color to OTIF < 85%', () => {
    mockOtifByRetailer.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OtifByRetailerTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    // Paris has 55.6% OTIF
    const parisRow = screen.getByText('55.6').closest('td');
    expect(parisRow?.className).toContain('text-red');
  });

  it('shows loading skeleton', () => {
    mockOtifByRetailer.mockReturnValue({ data: undefined, isLoading: true });
    render(<OtifByRetailerTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('otif-retailer-skeleton')).toBeInTheDocument();
  });

  it('sorts by column when header clicked', async () => {
    const user = userEvent.setup();
    mockOtifByRetailer.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OtifByRetailerTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    const totalHeader = screen.getByText('Total');
    await user.click(totalHeader);
    // After clicking Total, should sort by total_orders
    const cells = screen.getAllByTestId('retailer-total');
    expect(cells[0]).toHaveTextContent('50'); // Falabella first (desc)
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/dashboard/OtifByRetailerTable.test.tsx`
Expected: FAIL — module not found

**Step 3: Write the component**

Create `apps/frontend/src/components/dashboard/OtifByRetailerTable.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { useOtifByRetailer, type OtifByRetailer } from '@/hooks/useDeliveryMetrics';

interface OtifByRetailerTableProps {
  operatorId: string;
  startDate: string;
  endDate: string;
}

type SortColumn = 'retailer_name' | 'total_orders' | 'delivered' | 'on_time' | 'otif_pct';
type SortDir = 'asc' | 'desc';

function getOtifCellColor(pct: number | null): string {
  if (pct === null) return 'text-slate-400';
  if (pct >= 95) return 'text-emerald-600 font-semibold';
  if (pct >= 85) return 'text-amber-600 font-semibold';
  return 'text-red-600 font-semibold';
}

export default function OtifByRetailerTable({ operatorId, startDate, endDate }: OtifByRetailerTableProps) {
  const { data, isLoading } = useOtifByRetailer(operatorId, startDate, endDate);
  const [sortCol, setSortCol] = useState<SortColumn>('otif_pct');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir(col === 'retailer_name' ? 'asc' : 'desc');
    }
  };

  const sorted = [...(data ?? [])].sort((a, b) => {
    const aVal = a[sortCol] ?? -1;
    const bVal = b[sortCol] ?? -1;
    if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
    return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200" data-testid="otif-retailer-skeleton">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-48 bg-slate-200 rounded" />
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded" />)}
        </div>
      </div>
    );
  }

  const COLS: { key: SortColumn; label: string; align: string }[] = [
    { key: 'retailer_name', label: 'Cliente', align: 'text-left' },
    { key: 'total_orders', label: 'Total', align: 'text-right' },
    { key: 'delivered', label: 'Entregados', align: 'text-right' },
    { key: 'on_time', label: 'A Tiempo', align: 'text-right' },
    { key: 'otif_pct', label: 'OTIF %', align: 'text-right' },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" data-testid="otif-retailer-table">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-800">OTIF por Cliente</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {COLS.map(({ key, label, align }) => (
                <th
                  key={key}
                  className={`px-4 py-3 font-medium text-slate-600 cursor-pointer hover:bg-slate-100 select-none ${align}`}
                  onClick={() => handleSort(key)}
                  aria-sort={sortCol === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {label} {sortCol === key && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.retailer_name} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                <td className="px-4 py-3 text-slate-800">{row.retailer_name}</td>
                <td className="px-4 py-3 text-right text-slate-600" data-testid="retailer-total">
                  {row.total_orders.toLocaleString('es-CL')}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{row.delivered.toLocaleString('es-CL')}</td>
                <td className="px-4 py-3 text-right text-slate-600">{row.on_time.toLocaleString('es-CL')}</td>
                <td className={`px-4 py-3 text-right ${getOtifCellColor(row.otif_pct)}`}>
                  {row.otif_pct !== null ? row.otif_pct.toFixed(1) : '—'}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Sin datos para el periodo seleccionado</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 4: Run tests**

Run: `npx vitest run src/components/dashboard/OtifByRetailerTable.test.tsx`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/OtifByRetailerTable.tsx apps/frontend/src/components/dashboard/OtifByRetailerTable.test.tsx
git commit -m "feat(3b-4): add OTIF by retailer sortable table component"
```

---

### Task 4: LateDeliveriesTable Component

**Files:**
- Create: `apps/frontend/src/components/dashboard/LateDeliveriesTable.tsx`
- Create: `apps/frontend/src/components/dashboard/LateDeliveriesTable.test.tsx`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const mockLateDeliveries = vi.fn();
vi.mock('@/hooks/useDeliveryMetrics', () => ({
  useLateDeliveries: (...args: unknown[]) => mockLateDeliveries(...args),
}));

import LateDeliveriesTable from './LateDeliveriesTable';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const MOCK_DATA = [
  { order_number: 'ORD-001', retailer_name: 'Falabella', delivery_date: '2026-03-05',
    completed_date: '2026-03-08', days_late: 3, driver_name: 'ALEJANDRO' },
  { order_number: 'ORD-002', retailer_name: 'Ripley', delivery_date: '2026-03-07',
    completed_date: '2026-03-08', days_late: 1, driver_name: 'CARLOS' },
];

describe('LateDeliveriesTable', () => {
  it('renders late deliveries with days_late badge', () => {
    mockLateDeliveries.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<LateDeliveriesTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('late-deliveries-table')).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('+3 días')).toBeInTheDocument();
    expect(screen.getByText('+1 día')).toBeInTheDocument();
  });

  it('shows empty state when no late deliveries', () => {
    mockLateDeliveries.mockReturnValue({ data: [], isLoading: false });
    render(<LateDeliveriesTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByText(/Sin entregas tardías/)).toBeInTheDocument();
  });

  it('shows loading skeleton', () => {
    mockLateDeliveries.mockReturnValue({ data: undefined, isLoading: true });
    render(<LateDeliveriesTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('late-deliveries-skeleton')).toBeInTheDocument();
  });

  it('shows count in header', () => {
    mockLateDeliveries.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<LateDeliveriesTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByText(/Entregas Tardías/)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
```

**Step 2: Run test — FAIL (module not found)**

**Step 3: Write the component**

Create `apps/frontend/src/components/dashboard/LateDeliveriesTable.tsx`:

```typescript
'use client';

import { useLateDeliveries } from '@/hooks/useDeliveryMetrics';

interface LateDeliveriesTableProps {
  operatorId: string;
  startDate: string;
  endDate: string;
}

export default function LateDeliveriesTable({ operatorId, startDate, endDate }: LateDeliveriesTableProps) {
  const { data, isLoading } = useLateDeliveries(operatorId, startDate, endDate);

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200" data-testid="late-deliveries-skeleton">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-48 bg-slate-200 rounded" />
          {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" data-testid="late-deliveries-table">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-800">Entregas Tardías</h3>
        {data && data.length > 0 && (
          <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-2 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
            {data.length}
          </span>
        )}
      </div>

      {(!data || data.length === 0) ? (
        <div className="px-6 py-8 text-center text-slate-400 text-sm">
          Sin entregas tardías en el periodo seleccionado
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-medium text-slate-600">Orden</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Cliente</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Fecha Compromiso</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Fecha Entrega</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Atraso</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Conductor</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={row.order_number} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                  <td className="px-4 py-3 text-slate-800 font-mono text-xs">{row.order_number}</td>
                  <td className="px-4 py-3 text-slate-600">{row.retailer_name}</td>
                  <td className="px-4 py-3 text-slate-600">{row.delivery_date}</td>
                  <td className="px-4 py-3 text-slate-600">{row.completed_date}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                      +{row.days_late} {row.days_late === 1 ? 'día' : 'días'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{row.driver_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run tests — ALL PASS**

**Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/LateDeliveriesTable.tsx apps/frontend/src/components/dashboard/LateDeliveriesTable.test.tsx
git commit -m "feat(3b-4): add late deliveries detail table component"
```

---

### Task 5: OrdersDetailTable Component (Paginated, Filterable, Expandable)

**Files:**
- Create: `apps/frontend/src/components/dashboard/OrdersDetailTable.tsx`
- Create: `apps/frontend/src/components/dashboard/OrdersDetailTable.test.tsx`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

const mockOrdersDetail = vi.fn();
vi.mock('@/hooks/useDeliveryMetrics', () => ({
  useOrdersDetail: (...args: unknown[]) => mockOrdersDetail(...args),
}));

import OrdersDetailTable from './OrdersDetailTable';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const MOCK_ROWS = [
  { id: 'u1', order_number: 'ORD-001', retailer_name: 'Falabella', comuna: 'Santiago',
    delivery_date: '2026-03-05', status: 'delivered', completed_at: '2026-03-05 14:30',
    driver_name: 'ALEJANDRO', route_id: 'R-123', failure_reason: null, days_delta: 0 },
  { id: 'u2', order_number: 'ORD-002', retailer_name: 'Ripley', comuna: 'Providencia',
    delivery_date: '2026-03-06', status: 'failed', completed_at: '2026-03-06 16:00',
    driver_name: 'CARLOS', route_id: 'R-124', failure_reason: 'Cliente ausente', days_delta: null },
  { id: 'u3', order_number: 'ORD-003', retailer_name: 'Paris', comuna: 'Las Condes',
    delivery_date: '2026-03-04', status: 'pending', completed_at: null,
    driver_name: null, route_id: null, failure_reason: null, days_delta: null },
];

const MOCK_DATA = { rows: MOCK_ROWS, total_count: 53 };

describe('OrdersDetailTable', () => {
  beforeEach(() => { mockOrdersDetail.mockReset(); });

  it('renders table with order rows', () => {
    mockOrdersDetail.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('orders-detail-table')).toBeInTheDocument();
    expect(screen.getByText('ORD-001')).toBeInTheDocument();
    expect(screen.getByText('ORD-002')).toBeInTheDocument();
    expect(screen.getByText('ORD-003')).toBeInTheDocument();
  });

  it('shows status badges with correct colors', () => {
    mockOrdersDetail.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    const deliveredBadge = screen.getByText('Entregado');
    expect(deliveredBadge.className).toContain('emerald');
    const failedBadge = screen.getByText('Fallido');
    expect(failedBadge.className).toContain('red');
  });

  it('expands row on click to show details', async () => {
    const user = userEvent.setup();
    mockOrdersDetail.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    // Click on the failed order row
    await user.click(screen.getByText('ORD-002'));
    expect(screen.getByText('Cliente ausente')).toBeInTheDocument();
    expect(screen.getByText('CARLOS')).toBeInTheDocument();
  });

  it('shows pagination with page info', () => {
    mockOrdersDetail.mockReturnValue({ data: MOCK_DATA, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByText(/1–25 de 53/)).toBeInTheDocument();
  });

  it('shows loading skeleton', () => {
    mockOrdersDetail.mockReturnValue({ data: undefined, isLoading: true });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" />, { wrapper });

    expect(screen.getByTestId('orders-detail-skeleton')).toBeInTheDocument();
  });

  it('accepts initialStatus filter prop', () => {
    mockOrdersDetail.mockReturnValue({ data: { rows: [], total_count: 0 }, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" initialStatus="failed" />, { wrapper });

    // The status filter dropdown should show 'failed'
    const select = screen.getByTestId('status-filter') as HTMLSelectElement;
    expect(select.value).toBe('failed');
  });

  it('accepts initialOverdueOnly filter prop', () => {
    mockOrdersDetail.mockReturnValue({ data: { rows: [], total_count: 0 }, isLoading: false });
    render(<OrdersDetailTable operatorId="op-1" startDate="2026-03-01" endDate="2026-03-09" initialOverdueOnly={true} />, { wrapper });

    const checkbox = screen.getByTestId('overdue-filter') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });
});
```

**Step 2: Run test — FAIL (module not found)**

**Step 3: Write the component**

Create `apps/frontend/src/components/dashboard/OrdersDetailTable.tsx`:

```typescript
'use client';

import { useState, useEffect, useRef } from 'react';
import { useOrdersDetail, type OrderDetailRow } from '@/hooks/useDeliveryMetrics';

interface OrdersDetailTableProps {
  operatorId: string;
  startDate: string;
  endDate: string;
  initialStatus?: string | null;
  initialOverdueOnly?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  processing: 'Procesando',
  dispatched: 'Despachado',
  delivered: 'Entregado',
  failed: 'Fallido',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  processing: 'bg-blue-100 text-blue-700',
  dispatched: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function ExpandedRow({ row }: { row: OrderDetailRow }) {
  return (
    <tr className="bg-slate-50 border-b border-slate-200">
      <td colSpan={6} className="px-4 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-slate-400 text-xs block">Conductor</span>
            <span className="text-slate-700">{row.driver_name ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 text-xs block">Ruta</span>
            <span className="text-slate-700 font-mono text-xs">{row.route_id ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 text-xs block">Razón de Fallo</span>
            <span className="text-slate-700">{row.failure_reason ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 text-xs block">Delta</span>
            <span className={`font-semibold ${
              row.days_delta === null ? 'text-slate-400' :
              row.days_delta <= 0 ? 'text-emerald-600' : 'text-red-600'
            }`}>
              {row.days_delta === null ? '—' :
               row.days_delta === 0 ? 'A tiempo' :
               row.days_delta > 0 ? `+${row.days_delta} ${row.days_delta === 1 ? 'día' : 'días'}` :
               `${row.days_delta} ${row.days_delta === -1 ? 'día' : 'días'}`}
            </span>
          </div>
        </div>
      </td>
    </tr>
  );
}

const PAGE_SIZE = 25;

export default function OrdersDetailTable({
  operatorId,
  startDate,
  endDate,
  initialStatus = null,
  initialOverdueOnly = false,
}: OrdersDetailTableProps) {
  const [statusFilter, setStatusFilter] = useState<string | null>(initialStatus);
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(initialOverdueOnly);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [statusFilter, search, overdueOnly]);

  // Update filters when initial props change (from card clicks)
  useEffect(() => { setStatusFilter(initialStatus ?? null); }, [initialStatus]);
  useEffect(() => { setOverdueOnly(initialOverdueOnly); }, [initialOverdueOnly]);

  const { data, isLoading } = useOrdersDetail(operatorId, startDate, endDate, {
    status: statusFilter,
    search: search || null,
    overdueOnly,
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = data ? Math.ceil(data.total_count / PAGE_SIZE) : 0;
  const rangeStart = (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, data?.total_count ?? 0);

  if (isLoading && !data) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200" data-testid="orders-detail-skeleton">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-48 bg-slate-200 rounded" />
          <div className="h-10 bg-slate-100 rounded" />
          {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" ref={tableRef} data-testid="orders-detail-table">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-800 mb-3">Detalle de Órdenes</h3>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <select
            data-testid="status-filter"
            value={statusFilter ?? ''}
            onChange={(e) => setStatusFilter(e.target.value || null)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-[#e6c15c]"
          >
            <option value="">Todos los estados</option>
            <option value="delivered">Entregado</option>
            <option value="failed">Fallido</option>
            <option value="pending">Pendiente</option>
            <option value="processing">Procesando</option>
            <option value="dispatched">Despachado</option>
          </select>

          <label className="sr-only" htmlFor="order-search">Buscar orden</label>
          <input
            id="order-search"
            type="text"
            placeholder="Buscar por N° orden..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-[#e6c15c] w-48"
          />

          <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              data-testid="overdue-filter"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="rounded border-slate-300 text-[#e6c15c] focus:ring-[#e6c15c]"
            />
            Solo atrasados
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-medium text-slate-600">Orden</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Cliente</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Comuna</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Fecha Compromiso</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Completado</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row, i) => (
              <>
                <tr
                  key={row.id}
                  className={`cursor-pointer hover:bg-slate-50 transition-colors ${i % 2 === 1 ? 'bg-slate-50/50' : ''} ${expandedId === row.id ? 'bg-slate-100' : ''}`}
                  onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                >
                  <td className="px-4 py-3 text-slate-800 font-mono text-xs">{row.order_number}</td>
                  <td className="px-4 py-3 text-slate-600 truncate max-w-[160px]">{row.retailer_name}</td>
                  <td className="px-4 py-3 text-slate-600">{row.comuna}</td>
                  <td className="px-4 py-3 text-slate-600">{row.delivery_date}</td>
                  <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                  <td className="px-4 py-3 text-slate-600 text-xs">
                    {row.completed_at ? row.completed_at.split(' ')[0] : '—'}
                  </td>
                </tr>
                {expandedId === row.id && <ExpandedRow key={`${row.id}-expand`} row={row} />}
              </>
            ))}
            {(data?.rows ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total_count > 0 && (
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between text-sm text-slate-600">
          <span>{rangeStart}–{rangeEnd} de {data.total_count.toLocaleString('es-CL')}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Anterior
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run tests — ALL PASS**

**Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/OrdersDetailTable.tsx apps/frontend/src/components/dashboard/OrdersDetailTable.test.tsx
git commit -m "feat(3b-4): add paginated orders detail table with expandable rows"
```

---

### Task 6: Wire Everything into DeliveryTab

**Files:**
- Modify: `apps/frontend/src/components/dashboard/DeliveryTab.tsx`
- Modify: `apps/frontend/src/components/dashboard/DeliveryTab.test.tsx`

**Step 1: Update DeliveryTab.tsx**

Key changes:
1. Add `useRef` for the orders table section (scroll target)
2. Add state for `ordersStatusFilter` and `ordersOverdueOnly`
3. Make OutcomeCard and PendingAlertCard accept `onClick` prop
4. Add click handlers that set filter + scroll to orders table
5. Render OtifByRetailerTable, LateDeliveriesTable, OrdersDetailTable below existing strips

Modify the OutcomeCard to accept `onClick`:

```typescript
// Add onClick to OutcomeCard props
onClick?: () => void;

// Add to the div: onClick={onClick} and cursor-pointer when onClick exists
className={`... ${onClick ? 'cursor-pointer' : ''}`}
onClick={onClick}
```

Same for PendingAlertCard.

In the main DeliveryTab function, add:

```typescript
import { useRef } from 'react';
import OtifByRetailerTable from './OtifByRetailerTable';
import LateDeliveriesTable from './LateDeliveriesTable';
import OrdersDetailTable from './OrdersDetailTable';

// Inside DeliveryTab:
const ordersRef = useRef<HTMLDivElement>(null);
const [ordersStatusFilter, setOrdersStatusFilter] = useState<string | null>(null);
const [ordersOverdueOnly, setOrdersOverdueOnly] = useState(false);

const scrollToOrders = (status: string | null, overdue = false) => {
  setOrdersStatusFilter(status);
  setOrdersOverdueOnly(overdue);
  setTimeout(() => ordersRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
};

// In OutcomeCards: add onClick={() => scrollToOrders('delivered')} etc.
// In PendingAlertCards: "Atrasados" gets onClick={() => scrollToOrders(null, true)}

// After pending strip, add:
<OtifByRetailerTable operatorId={operatorId} startDate={startDate} endDate={endDate} />
<LateDeliveriesTable operatorId={operatorId} startDate={startDate} endDate={endDate} />
<div ref={ordersRef}>
  <OrdersDetailTable
    operatorId={operatorId}
    startDate={startDate}
    endDate={endDate}
    initialStatus={ordersStatusFilter}
    initialOverdueOnly={ordersOverdueOnly}
  />
</div>
```

**Step 2: Update DeliveryTab.test.tsx**

Add mocks for new components and test card click scroll behavior:

```typescript
// Add mocks
vi.mock('./OtifByRetailerTable', () => ({ default: () => <div data-testid="otif-retailer-table" /> }));
vi.mock('./LateDeliveriesTable', () => ({ default: () => <div data-testid="late-deliveries-table" /> }));
vi.mock('./OrdersDetailTable', () => ({ default: (props: { initialStatus?: string; initialOverdueOnly?: boolean }) => (
  <div data-testid="orders-detail-table" data-status={props.initialStatus ?? ''} data-overdue={props.initialOverdueOnly ?? false} />
)}));

// Add tests:
it('renders all detail sections', () => {
  mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });
  mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false });
  render(<DeliveryTab operatorId="test-op" />, { wrapper });

  expect(screen.getByTestId('otif-retailer-table')).toBeInTheDocument();
  expect(screen.getByTestId('late-deliveries-table')).toBeInTheDocument();
  expect(screen.getByTestId('orders-detail-table')).toBeInTheDocument();
});

it('clicking outcome card sets status filter on orders table', async () => {
  const user = userEvent.setup();
  mockOtif.mockReturnValue({ data: OTIF_DATA, isLoading: false });
  mockPending.mockReturnValue({ data: PENDING_DATA, isLoading: false });
  render(<DeliveryTab operatorId="test-op" />, { wrapper });

  await user.click(screen.getByTestId('outcome-failed'));
  const table = screen.getByTestId('orders-detail-table');
  expect(table.getAttribute('data-status')).toBe('failed');
});
```

**Step 3: Run all tests**

Run: `npx vitest run src/components/dashboard/DeliveryTab.test.tsx`
Expected: ALL PASS

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS, no regressions

**Step 5: Commit**

```bash
git add apps/frontend/src/components/dashboard/DeliveryTab.tsx apps/frontend/src/components/dashboard/DeliveryTab.test.tsx
git commit -m "feat(3b-4): wire detail sections into DeliveryTab with card click scroll anchors"
```

---

### Task 7: Final Integration & Deploy

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

**Step 2: Run lint**

Run: `npx eslint src/components/dashboard/DeliveryTab.tsx src/components/dashboard/OtifByRetailerTable.tsx src/components/dashboard/LateDeliveriesTable.tsx src/components/dashboard/OrdersDetailTable.tsx src/hooks/useDeliveryMetrics.ts`
Expected: No errors

**Step 3: Push and create PR**

```bash
git push -u origin feat/3b-4-delivery-detail-views
gh pr create --title "feat(3b-4): delivery tab detail views — OTIF by retailer, late deliveries, orders table" --body "..."
gh pr merge --auto --squash
```

**Step 4: Wait for CI, verify merge**

```bash
gh pr checks <N>
gh pr view <N> --json state,mergedAt
```

---

## File Summary

| File | Action |
|------|--------|
| `apps/frontend/supabase/migrations/20260309000002_create_delivery_detail_functions.sql` | Create |
| `apps/frontend/src/hooks/useDeliveryMetrics.ts` | Modify (add 3 hooks + 4 interfaces) |
| `apps/frontend/src/hooks/useDeliveryMetrics.test.ts` | Modify (add 5 tests) |
| `apps/frontend/src/components/dashboard/OtifByRetailerTable.tsx` | Create |
| `apps/frontend/src/components/dashboard/OtifByRetailerTable.test.tsx` | Create |
| `apps/frontend/src/components/dashboard/LateDeliveriesTable.tsx` | Create |
| `apps/frontend/src/components/dashboard/LateDeliveriesTable.test.tsx` | Create |
| `apps/frontend/src/components/dashboard/OrdersDetailTable.tsx` | Create |
| `apps/frontend/src/components/dashboard/OrdersDetailTable.test.tsx` | Create |
| `apps/frontend/src/components/dashboard/DeliveryTab.tsx` | Modify (add sections + click handlers) |
| `apps/frontend/src/components/dashboard/DeliveryTab.test.tsx` | Modify (add mocks + tests) |
