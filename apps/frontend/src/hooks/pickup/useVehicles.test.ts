import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

/**
 * The chain mock applies the recorded `.eq()` / `.is()` predicates to the
 * fixture rows for real, so a hook that forgets a filter genuinely returns
 * rows it should not have. `.order()` is the terminal call.
 */
type Row = Record<string, unknown>;

const VEHICLE_ROWS: Row[] = [
  { id: 'v-active', operator_id: 'op-1', plate: 'BBB-222', vehicle_type: 'camion', active: true, deleted_at: null },
  { id: 'v-active-2', operator_id: 'op-1', plate: 'AAA-111', vehicle_type: null, active: true, deleted_at: null },
  { id: 'v-inactive', operator_id: 'op-1', plate: 'SIN-REGISTRO', vehicle_type: null, active: false, deleted_at: null },
  { id: 'v-deleted', operator_id: 'op-1', plate: 'DDD-444', vehicle_type: null, active: true, deleted_at: '2026-08-01T00:00:00Z' },
  { id: 'v-other-op', operator_id: 'op-2', plate: 'ZZZ-999', vehicle_type: null, active: true, deleted_at: null },
];

let insertPayload: Row | null = null;
let insertResult: { data: unknown; error: unknown } = { data: null, error: null };

function buildChain(table: string) {
  let rows = table === 'vehicles' ? [...VEHICLE_ROWS] : [];
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((col: string, val: unknown) => {
    rows = rows.filter((r) => r[col] === val);
    return chain;
  });
  chain.is = vi.fn((col: string, val: unknown) => {
    rows = rows.filter((r) => r[col] === val);
    return chain;
  });
  chain.order = vi.fn((col: string) => {
    const sorted = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])));
    return Promise.resolve({ data: sorted, error: null });
  });
  chain.insert = vi.fn((payload: Row) => {
    insertPayload = payload;
    return {
      select: vi.fn(() => ({ single: vi.fn(() => Promise.resolve(insertResult)) })),
    };
  });
  return chain;
}

const mockFrom = vi.fn((table: string) => buildChain(table));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

import { useVehicles, useCreateVehicle, normalizePlate, RESERVED_PLATE } from './useVehicles';

function wrapperFactory() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  }
  return Wrapper;
}

describe('normalizePlate', () => {
  it('trims and uppercases', () => {
    expect(normalizePlate('  abc-123  ')).toBe('ABC-123');
  });
});

describe('useVehicles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertPayload = null;
    insertResult = { data: null, error: null };
  });

  it('lists only active, non-deleted vehicles for the operator', async () => {
    const { result } = renderHook(() => useVehicles('op-1'), { wrapper: wrapperFactory() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const ids = (result.current.data ?? []).map((v) => v.id);
    expect(ids).toEqual(['v-active-2', 'v-active']); // ordered by plate: AAA-111, BBB-222
    expect(ids).not.toContain('v-inactive');
    expect(ids).not.toContain('v-deleted');
    expect(ids).not.toContain('v-other-op');
  });

  it('does not query when operatorId is null', () => {
    renderHook(() => useVehicles(null), { wrapper: wrapperFactory() });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('useCreateVehicle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertPayload = null;
    insertResult = { data: null, error: null };
  });

  it('normalizes the plate before inserting', async () => {
    insertResult = {
      data: { id: 'v-new', operator_id: 'op-1', plate: 'ABC-123', vehicle_type: null, active: true },
      error: null,
    };
    const { result } = renderHook(() => useCreateVehicle('op-1'), { wrapper: wrapperFactory() });

    result.current.mutate({ plate: '  abc-123  ' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(insertPayload).toEqual({ operator_id: 'op-1', plate: 'ABC-123' });
    expect(result.current.data?.id).toBe('v-new');
  });

  it('refuses an empty plate without touching the database', async () => {
    const { result } = renderHook(() => useCreateVehicle('op-1'), { wrapper: wrapperFactory() });

    result.current.mutate({ plate: '   ' });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe('Ingresa una patente');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it(`refuses the reserved ${RESERVED_PLATE} plate with a clear message`, async () => {
    const { result } = renderHook(() => useCreateVehicle('op-1'), { wrapper: wrapperFactory() });

    result.current.mutate({ plate: ' sin-registro ' });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toBe(
      'SIN-REGISTRO es una patente reservada del sistema. Usa la patente real del vehículo.',
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('surfaces the database error message', async () => {
    insertResult = { data: null, error: { message: 'duplicate key value violates unique constraint' } };
    const { result } = renderHook(() => useCreateVehicle('op-1'), { wrapper: wrapperFactory() });

    result.current.mutate({ plate: 'AAA-111' });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error?.message).toMatch(/duplicate key/i);
  });
});
