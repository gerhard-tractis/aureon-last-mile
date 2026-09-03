import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRouteScanSession } from './useRouteScanSession';

const mutateMock = vi.fn();
let isPending = false;
vi.mock('@/hooks/dispatch/useScanPackage', () => ({
  useScanPackage: () => ({ mutate: mutateMock, isPending }),
}));

let packagesData: unknown[] = [];
vi.mock('@/hooks/dispatch/useRoutePackages', () => ({
  useRoutePackages: () => ({ data: packagesData }),
}));

let orderContextData: Map<string, unknown> | undefined;
vi.mock('./useRouteScanOrderContext', () => ({
  useRouteScanOrderContext: () => ({ data: orderContextData }),
}));

const refocusMock = vi.fn();
vi.mock('@/lib/scan/refocus-package-field', () => ({
  refocusPackageField: () => refocusMock(),
}));

describe('useRouteScanSession', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    refocusMock.mockReset();
    isPending = false;
    packagesData = [
      { order_id: 'o1', boxesLoaded: 1, boxesTotal: 3 },
    ];
    orderContextData = new Map([
      ['o1', { comuna: 'Ñuñoa', retailerName: 'Falabella', stopIndex: 9 }],
    ]);
  });

  it('spec-76 2e — an accepted scan becomes the last read and prepends to history, field stays armed', () => {
    const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));

    act(() => {
      result.current.submitScan('CL8841873');
    });

    const onSuccess = mutateMock.mock.calls[0][1].onSuccess;
    act(() => {
      onSuccess({
        order_id: 'o1',
        order_number: 'ORD-3311',
        contact_name: 'Javiera Muñoz',
        contact_address: 'Los Aromos 442',
      });
    });

    expect(result.current.lastEntry?.kind).toBe('accepted');
    expect(result.current.history).toHaveLength(1);
    if (result.current.lastEntry?.kind === 'accepted') {
      // Loaded BEFORE this scan was 1 (stale until useRoutePackages
      // refetches) — this scan is the +1 the crew is holding right now.
      expect(result.current.lastEntry.boxesLoaded).toBe(2);
      expect(result.current.lastEntry.boxesTotal).toBe(3);
      expect(result.current.lastEntry.stopIndex).toBe(9);
      expect(result.current.lastEntry.comuna).toBe('Ñuñoa');
    }
    expect(refocusMock).toHaveBeenCalled();
  });

  it('spec-76 2f — a rejected scan becomes the last read WITHOUT throwing, field stays armed, counter increments', () => {
    const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));

    act(() => {
      result.current.submitScan('CL9999');
    });
    const onError = mutateMock.mock.calls[0][1].onError;
    act(() => {
      onError({ code: 'IN_CONSOLIDATION', message: 'Paquete en andén de consolidación: reasígnalo a un andén de reparto antes de cargarlo' });
    });

    expect(result.current.lastEntry?.kind).toBe('rejected');
    expect(result.current.rejectionCount).toBe(1);
    expect(result.current.rejectionTally).toEqual([{ code: 'IN_CONSOLIDATION', label: 'RETENIDO EN CONSOLIDACIÓN', count: 1 }]);
    expect(refocusMock).toHaveBeenCalled();
  });

  it('names the conflicting route from its id, ALREADY_IN_ROUTE only', () => {
    const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));
    act(() => result.current.submitScan('CL1'));
    const onError = mutateMock.mock.calls[0][1].onError;
    act(() => {
      onError({ code: 'ALREADY_IN_ROUTE', message: 'Paquete ya asignado a otra ruta activa', conflictingRouteId: 'abcdef1234567890' });
    });
    expect(result.current.lastEntry?.kind).toBe('rejected');
    if (result.current.lastEntry?.kind === 'rejected') {
      expect(result.current.lastEntry.title).toContain('ABCDEF12');
      expect(result.current.lastEntry.canViewConflictingRoute).toBe(true);
      expect(result.current.lastEntry.conflictingRouteId).toBe('abcdef1234567890');
    }
  });

  it('the route package totals feed the 148/172/86% counter', () => {
    packagesData = [
      { order_id: 'o1', boxesLoaded: 100, boxesTotal: 120 },
      { order_id: 'o2', boxesLoaded: 48, boxesTotal: 52 },
    ];
    const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));
    expect(result.current.packagesLoaded).toBe(148);
    expect(result.current.packagesTotal).toBe(172);
    expect(result.current.percent).toBe(86);
  });

  it('does not divide by zero on an empty route', () => {
    packagesData = [];
    const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));
    expect(result.current.percent).toBe(0);
  });
});
