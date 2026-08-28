import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useQuickSortFlow } from './useQuickSortFlow';
import type { DockZone } from '@/lib/distribution/sectorization-engine';

/**
 * spec-71 phase 3 — `mode: 'stage'`. Extends the same hook the andén sort
 * (`mode: 'sectorize'`, the default, covered by useQuickSortFlow.test.ts)
 * already uses. Kept in its own file: the stage-mode package lookup goes
 * through `findExpectedLoadPosition` (its own suite,
 * expected-load-position.test.ts) rather than the raw supabase chain the
 * sectorize suite mocks, so mocking that module directly is simpler and
 * does not risk the two suites' chain mocks drifting against each other.
 */

const zones: DockZone[] = [];

const mockLimit = vi.fn();
const mockIs = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/hooks/distribution/useDockBatches', () => ({
  useCreateDockBatch: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({ id: 'batch-1' }) })),
  useCloseDockBatch: vi.fn(() => ({ mutate: vi.fn() })),
}));

vi.mock('@/hooks/distribution/useDockScans', () => ({
  useDockScanMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

const mockFindExpectedLoadPosition = vi.fn();
vi.mock('@/lib/dispatch/expected-load-position', () => ({
  findExpectedLoadPosition: (...args: unknown[]) => mockFindExpectedLoadPosition(...args),
}));

const PACKAGE_ROW = {
  id: 'pkg-1',
  label: 'CTN-1',
  status: 'sectorizado',
  order_id: 'o1',
  orders: { order_number: 'ORD-1', comuna_id: 'comuna-1', delivery_date: '2026-08-27', chile_comunas: { nombre: 'Las Condes' } },
};

const EXPECTED_POSITION = {
  dispatchId: 'd1',
  routeId: 'route-1',
  positionId: 'lp-1',
  positionCode: 'POS-04',
  positionLabel: 'Zona frente a Andén 4',
};

function packagesChain(result: { data: unknown; error: unknown }) {
  mockLimit.mockResolvedValue(result);
  return { eq: mockEq, is: mockIs, limit: mockLimit };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, is: mockIs });
  mockIs.mockReturnValue({ limit: mockLimit, eq: mockEq });
  packagesChain({ data: [PACKAGE_ROW], error: null });
  mockFindExpectedLoadPosition.mockResolvedValue({ ok: true, position: EXPECTED_POSITION });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useQuickSortFlow — mode: stage', () => {
  it('defaults to sectorize mode (unchanged behaviour) when mode is omitted', () => {
    const { result } = renderHook(() => useQuickSortFlow({ operatorId: 'op-1', userId: 'u-1', zones }));
    expect(result.current.state).toBe('scan_package');
  });

  it('arms the position field with the route-occupied position after a package scan', async () => {
    const { result } = renderHook(() =>
      useQuickSortFlow({ operatorId: 'op-1', userId: 'u-1', zones, mode: 'stage' }),
    );

    await act(async () => {
      await result.current.handlePackageScan('CTN-1');
    });

    await waitFor(() => expect(result.current.state).toBe('scan_position'));
    expect(result.current.positionDestination).toEqual(EXPECTED_POSITION);
    expect(mockFindExpectedLoadPosition).toHaveBeenCalledWith(mockSupabase, { operatorId: 'op-1', orderId: 'o1' });
  });

  it('shows a message and stays on step 1 when the route has no position yet', async () => {
    mockFindExpectedLoadPosition.mockResolvedValue({
      ok: false, code: 'NO_POSITION_ASSIGNED', message: 'Esta ruta aún no tiene una posición asignada',
    });
    const { result } = renderHook(() =>
      useQuickSortFlow({ operatorId: 'op-1', userId: 'u-1', zones, mode: 'stage' }),
    );

    await act(async () => {
      await result.current.handlePackageScan('CTN-1');
    });

    expect(result.current.state).toBe('scan_package');
    expect(result.current.error).toBe('Esta ruta aún no tiene una posición asignada');
  });

  it('accepts a position scan matching the expected code exactly, calling the staging endpoint', async () => {
    const { result } = renderHook(() =>
      useQuickSortFlow({ operatorId: 'op-1', userId: 'u-1', zones, mode: 'stage' }),
    );

    await act(async () => { await result.current.handlePackageScan('CTN-1'); });
    await waitFor(() => expect(result.current.state).toBe('scan_position'));

    await act(async () => { await result.current.handlePositionScan('POS-04'); });

    expect(fetch).toHaveBeenCalledWith('/api/dispatch/load-positions/scan', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ packageCode: 'CTN-1', positionCode: 'POS-04' }),
    }));
    expect(result.current.state).toBe('scan_package');
    expect(result.current.counter).toBe(1);
  });

  it('accepts a position scan despite the layout-corrupted hyphen (client-side match against the shown suggestion)', async () => {
    const { result } = renderHook(() =>
      useQuickSortFlow({ operatorId: 'op-1', userId: 'u-1', zones, mode: 'stage' }),
    );

    await act(async () => { await result.current.handlePackageScan('CTN-1'); });
    await waitFor(() => expect(result.current.state).toBe('scan_position'));

    await act(async () => { await result.current.handlePositionScan("POS'04"); });

    expect(fetch).toHaveBeenCalledWith('/api/dispatch/load-positions/scan', expect.objectContaining({
      body: JSON.stringify({ packageCode: 'CTN-1', positionCode: "POS'04" }),
    }));
    expect(result.current.counter).toBe(1);
  });

  it('rejects a mismatched position scan exactly like a mismatched andén — error + rejectedCode, no navigation, no network call', async () => {
    const { result } = renderHook(() =>
      useQuickSortFlow({ operatorId: 'op-1', userId: 'u-1', zones, mode: 'stage' }),
    );

    await act(async () => { await result.current.handlePackageScan('CTN-1'); });
    await waitFor(() => expect(result.current.state).toBe('scan_position'));

    await act(async () => { await result.current.handlePositionScan('POS-99'); });

    expect(result.current.state).toBe('scan_position');
    expect(result.current.error).toContain('POS-04');
    // Review item 7 — the andén reject shows the RAW scan
    // (trim+uppercase), not its normalized form; the position path now
    // matches that convention instead of showing "POS99".
    expect(result.current.rejectedCode).toBe('POS-99');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces the server rejection (e.g. a race where the position was released) without advancing the counter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ code: 'POSITION_NOT_OCCUPIED', message: 'La posición POS-04 no tiene una ruta asignada' }),
    }));
    const { result } = renderHook(() =>
      useQuickSortFlow({ operatorId: 'op-1', userId: 'u-1', zones, mode: 'stage' }),
    );

    await act(async () => { await result.current.handlePackageScan('CTN-1'); });
    await waitFor(() => expect(result.current.state).toBe('scan_position'));
    await act(async () => { await result.current.handlePositionScan('POS-04'); });

    expect(result.current.error).toBe('La posición POS-04 no tiene una ruta asignada');
    expect(result.current.counter).toBe(0);
    expect(result.current.state).toBe('scan_position');
  });
});
