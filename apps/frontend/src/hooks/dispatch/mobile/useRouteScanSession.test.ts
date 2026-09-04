import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouteScanSession } from './useRouteScanSession';

const mutateMock = vi.fn();
vi.mock('@/hooks/dispatch/useScanPackage', () => ({
  useScanPackage: () => ({ mutate: mutateMock, isPending: false }),
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

/** Grabs the Nth (0-based) call's {onSuccess, onError} options object. */
function callbacksAt(n: number) {
  return mutateMock.mock.calls[n][1] as {
    onSuccess: (r: unknown) => void;
    onError: (e: unknown) => void;
  };
}

describe('useRouteScanSession', () => {
  beforeEach(() => {
    mutateMock.mockReset();
    refocusMock.mockReset();
    packagesData = [{ order_id: 'o1', boxesLoaded: 1, boxesTotal: 3 }];
    orderContextData = new Map([['o1', { comuna: 'Ñuñoa', retailerName: 'Falabella', stopIndex: 9 }]]);
  });

  it('spec-76 2e — an accepted scan becomes the last read and prepends to history, field stays armed', () => {
    const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));

    act(() => result.current.submitScan('CL8841873'));
    act(() =>
      callbacksAt(0).onSuccess({
        order_id: 'o1',
        order_number: 'ORD-3311',
        contact_name: 'Javiera Muñoz',
        contact_address: 'Los Aromos 442',
      }),
    );

    expect(result.current.lastEntry?.kind).toBe('accepted');
    expect(result.current.history).toHaveLength(1);
    if (result.current.lastEntry?.kind === 'accepted') {
      expect(result.current.lastEntry.boxesLoaded).toBe(2);
      expect(result.current.lastEntry.boxesTotal).toBe(3);
      expect(result.current.lastEntry.stopIndex).toBe(9);
      expect(result.current.lastEntry.comuna).toBe('Ñuñoa');
    }
    expect(refocusMock).toHaveBeenCalled();
  });

  it('spec-76 2f — a rejected scan becomes the last read WITHOUT throwing, field stays armed, counter increments', () => {
    const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));

    act(() => result.current.submitScan('CL9999'));
    act(() =>
      callbacksAt(0).onError({
        code: 'IN_CONSOLIDATION',
        message: 'Paquete en andén de consolidación: reasígnalo a un andén de reparto antes de cargarlo',
      }),
    );

    expect(result.current.lastEntry?.kind).toBe('rejected');
    expect(result.current.rejectionCount).toBe(1);
    expect(result.current.rejectionTally).toEqual([{ code: 'IN_CONSOLIDATION', label: 'RETENIDO EN CONSOLIDACIÓN', count: 1 }]);
    expect(refocusMock).toHaveBeenCalled();
  });

  it('rejects en_bodega with NOT_ON_DOCK, distinct from the generic WRONG_STATUS bucket', () => {
    const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));
    act(() => result.current.submitScan('CL1'));
    act(() => callbacksAt(0).onError({ code: 'NOT_ON_DOCK', message: 'Paquete en bodega — no pasó por andén' }));
    expect(result.current.lastEntry?.kind).toBe('rejected');
    if (result.current.lastEntry?.kind === 'rejected') {
      expect(result.current.lastEntry.rejectionCode).toBe('NOT_ON_DOCK');
      expect(result.current.lastEntry.title).toBe('Paquete en bodega — no pasó por andén');
    }
  });

  it('names the conflicting route from its id, ALREADY_IN_ROUTE only', () => {
    const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));
    act(() => result.current.submitScan('CL1'));
    act(() =>
      callbacksAt(0).onError({
        code: 'ALREADY_IN_ROUTE',
        message: 'Paquete ya asignado a otra ruta activa',
        conflictingRouteId: 'abcdef1234567890',
      }),
    );
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

  describe('spec-76 review Important #2 — overlapping scans resolve out of order', () => {
    it('a slow scan A that resolves AFTER a faster scan B does not become lastEntry, and lands behind B in history', () => {
      // Fake timers so A and B get distinct, controlled atIso values —
      // real timers in a fast test run can land both submitScan() calls
      // in the same millisecond, which would make this assertion
      // non-deterministic instead of proving the atIso-ordering fix.
      vi.useFakeTimers();
      try {
        const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));

        // A starts first (earlier atIso)...
        act(() => result.current.submitScan('CL-A'));
        vi.advanceTimersByTime(1000);
        // ...B starts second (later atIso)...
        act(() => result.current.submitScan('CL-B'));
        // ...but B's request resolves FIRST (it was faster).
        act(() =>
          callbacksAt(1).onSuccess({
            order_id: 'o1',
            order_number: 'ORD-B',
            contact_name: null,
            contact_address: null,
          }),
        );
        // A resolves LATE, after B is already showing.
        act(() =>
          callbacksAt(0).onSuccess({
            order_id: 'o1',
            order_number: 'ORD-A',
            contact_name: null,
            contact_address: null,
          }),
        );

        // B has the later atIso (it was scanned second), so it stays on
        // top and stays lastEntry, even though A's callback fired last.
        expect(result.current.history.map((e) => e.code)).toEqual(['CL-B', 'CL-A']);
        expect(result.current.lastEntry?.code).toBe('CL-B');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('spec-76 review Important #3 — paquete N de M for consecutive boxes of the same order', () => {
    it('two boxes of the SAME order scanned before the query refetch land as box 2 and box 3, not both as box 2', () => {
      // Baseline: 1 already loaded, 3 total — from BEFORE this session
      // scanned anything. `packages` never changes here, simulating the
      // refetch not having landed yet for either scan.
      packagesData = [{ order_id: 'o1', boxesLoaded: 1, boxesTotal: 3 }];
      const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));

      act(() => result.current.submitScan('CL-BOX-2'));
      act(() =>
        callbacksAt(0).onSuccess({ order_id: 'o1', order_number: 'ORD-1', contact_name: null, contact_address: null }),
      );
      act(() => result.current.submitScan('CL-BOX-3'));
      act(() =>
        callbacksAt(1).onSuccess({ order_id: 'o1', order_number: 'ORD-1', contact_name: null, contact_address: null }),
      );

      const [newest, oldest] = result.current.history;
      if (newest.kind !== 'accepted' || oldest.kind !== 'accepted') throw new Error('unreachable');
      expect(oldest.boxesLoaded).toBe(2); // 1 (baseline) + 1st accepted this session
      expect(newest.boxesLoaded).toBe(3); // 1 (baseline) + 2nd accepted this session
      expect(newest.boxesTotal).toBe(3);
    });
  });

  describe('spec-76 review Important #4 — a double trigger-pull is deduped client-side', () => {
    it('a repeat of a code still in flight is never sent again, and is shown as YA CARGADO instead of a network failure', () => {
      const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));

      act(() => result.current.submitScan('CL-DOUBLE'));
      expect(mutateMock).toHaveBeenCalledTimes(1);

      // The trigger double-fires before the first request has settled.
      act(() => result.current.submitScan('CL-DOUBLE'));
      expect(mutateMock).toHaveBeenCalledTimes(1); // still 1 — never sent twice

      expect(result.current.lastEntry?.kind).toBe('rejected');
      if (result.current.lastEntry?.kind === 'rejected') {
        expect(result.current.lastEntry.rejectionCode).toBe('ALREADY_STAGED');
        expect(result.current.lastEntry.tallyLabel).toBe('YA CARGADO');
      }
      expect(refocusMock).toHaveBeenCalled();

      // The first request finally resolves — its own entry is added too,
      // and a THIRD submit of the same code (now no longer in flight) is
      // sent normally.
      act(() =>
        callbacksAt(0).onSuccess({ order_id: 'o1', order_number: 'ORD-1', contact_name: null, contact_address: null }),
      );
      act(() => result.current.submitScan('CL-DOUBLE'));
      expect(mutateMock).toHaveBeenCalledTimes(2);
    });

    it('two DIFFERENT codes in flight at once are both sent — the dedupe is per-code, not global', () => {
      const { result } = renderHook(() => useRouteScanSession('r1', 'op-1'));
      act(() => result.current.submitScan('CL-A'));
      act(() => result.current.submitScan('CL-B'));
      expect(mutateMock).toHaveBeenCalledTimes(2);
    });
  });
});
