import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useDriverPrefill } from './useDriverPrefill';
import type { TerritoryHistoryEntry } from '@/lib/dispatch/types';

function entry(overrides: Partial<TerritoryHistoryEntry> = {}): TerritoryHistoryEntry {
  return {
    comunaId: 'comuna-1',
    comunaName: 'Ñuñoa',
    driverName: 'Juan Pérez',
    runCount: 2,
    lastRouteDate: '2026-08-20',
    ...overrides,
  };
}

describe('useDriverPrefill', () => {
  it('pre-fills the driver when territory history agrees on exactly one driver and the field is empty', () => {
    const setDriverName = vi.fn();
    renderHook(() => useDriverPrefill([entry({ driverName: 'Juan Pérez' })], '', setDriverName));
    expect(setDriverName).toHaveBeenCalledWith('Juan Pérez');
  });

  it('does not pre-fill when the field already has a value', () => {
    const setDriverName = vi.fn();
    renderHook(() => useDriverPrefill([entry({ driverName: 'Juan Pérez' })], 'Someone Else', setDriverName));
    expect(setDriverName).not.toHaveBeenCalled();
  });

  it('does not pre-fill when there is no territory history', () => {
    const setDriverName = vi.fn();
    renderHook(() => useDriverPrefill([], '', setDriverName));
    expect(setDriverName).not.toHaveBeenCalled();
  });

  it('does not pre-fill when the territory history names more than one distinct driver (ambiguous)', () => {
    const setDriverName = vi.fn();
    renderHook(() =>
      useDriverPrefill(
        [
          entry({ comunaId: 'c-1', driverName: 'Juan Pérez' }),
          entry({ comunaId: 'c-2', driverName: 'Ana Soto' }),
        ],
        '',
        setDriverName,
      ),
    );
    expect(setDriverName).not.toHaveBeenCalled();
  });

  it('fires only once even if the hook re-renders with the field still empty', () => {
    const setDriverName = vi.fn();
    const { rerender } = renderHook(
      ({ territory, driverName }) => useDriverPrefill(territory, driverName, setDriverName),
      { initialProps: { territory: [entry({ driverName: 'Juan Pérez' })], driverName: '' } },
    );
    expect(setDriverName).toHaveBeenCalledTimes(1);

    // Re-render with the field still reported empty (setDriverName is
    // mocked, so the "real" state never actually changes) — must not fire
    // again, since a manager who clears the field back to empty after the
    // first auto-fill must not be silently re-filled.
    rerender({ territory: [entry({ driverName: 'Juan Pérez' })], driverName: '' });
    expect(setDriverName).toHaveBeenCalledTimes(1);
  });

  it('does not pre-fill once a value has already been set for this mount, even if territory changes', () => {
    const setDriverName = vi.fn();
    const { rerender } = renderHook(
      ({ territory, driverName }) => useDriverPrefill(territory, driverName, setDriverName),
      { initialProps: { territory: [entry({ driverName: 'Juan Pérez' })], driverName: '' } },
    );
    expect(setDriverName).toHaveBeenCalledTimes(1);

    rerender({ territory: [entry({ driverName: 'Ana Soto' })], driverName: '' });
    expect(setDriverName).toHaveBeenCalledTimes(1);
    expect(setDriverName).not.toHaveBeenCalledWith('Ana Soto');
  });

  // Review item 1 (HIGH): a single prior run is not a territory. Refusing
  // to pre-fill on run_count === 1 is what stops a one-time cover driver
  // from silently outranking the regular driver in the field a manager
  // reads.
  it('does not pre-fill from a territory match with run_count 1 (thin evidence)', () => {
    const setDriverName = vi.fn();
    renderHook(() => useDriverPrefill([entry({ driverName: 'Pedro Cobertura', runCount: 1 })], '', setDriverName));
    expect(setDriverName).not.toHaveBeenCalled();
  });

  it('does not pre-fill when ANY covered comuna has run_count 1, even if others are well-established', () => {
    const setDriverName = vi.fn();
    renderHook(() =>
      useDriverPrefill(
        [
          entry({ comunaId: 'c-1', driverName: 'Juan Pérez', runCount: 20 }),
          entry({ comunaId: 'c-2', driverName: 'Juan Pérez', runCount: 1 }),
        ],
        '',
        setDriverName,
      ),
    );
    expect(setDriverName).not.toHaveBeenCalled();
  });

  it('pre-fills once every covered comuna has run_count > 1', () => {
    const setDriverName = vi.fn();
    renderHook(() =>
      useDriverPrefill(
        [
          entry({ comunaId: 'c-1', driverName: 'Juan Pérez', runCount: 20 }),
          entry({ comunaId: 'c-2', driverName: 'Juan Pérez', runCount: 2 }),
        ],
        '',
        setDriverName,
      ),
    );
    expect(setDriverName).toHaveBeenCalledWith('Juan Pérez');
  });

  // "Also consider" item: type -> clear -> territory-resolves must not fire
  // a late fill mid-editing. Locking prefilling the first time the field is
  // observed non-empty (even before territory has arrived) is what prevents
  // this.
  it('never pre-fills once the field has held a value earlier in this mount, even after being cleared', () => {
    const setDriverName = vi.fn();
    const { rerender } = renderHook(
      ({ territory, driverName }) => useDriverPrefill(territory, driverName, setDriverName),
      { initialProps: { territory: [] as TerritoryHistoryEntry[], driverName: 'Someone Typed' } },
    );
    expect(setDriverName).not.toHaveBeenCalled();

    // Manager clears the field, THEN territory history resolves.
    rerender({ territory: [entry({ driverName: 'Juan Pérez' })], driverName: '' });
    expect(setDriverName).not.toHaveBeenCalled();
  });

  // A real caller (RouteBuilder) owns `driverName` via its own `useState` in
  // THE SAME component this hook runs in, so `setDriverName` and this
  // hook's internal `isAutoFilled` state update together in one commit.
  // Modelled with a real `useState` harness here (not an external mock that
  // doesn't feed back) so the effect ordering matches production exactly —
  // see RouteBuilder.test.tsx's "marks a pre-filled driver as suggested"
  // test for the same behaviour exercised end-to-end.
  function useHarness(territory: TerritoryHistoryEntry[]) {
    const [driverName, setDriverName] = useState('');
    const isAutoFilled = useDriverPrefill(territory, driverName, setDriverName);
    return { driverName, setDriverName, isAutoFilled };
  }

  it('returns isAutoFilled=true only for a value it set, and clears it once the field diverges', () => {
    const { result } = renderHook(() => useHarness([entry({ driverName: 'Juan Pérez' })]));

    expect(result.current.driverName).toBe('Juan Pérez');
    expect(result.current.isAutoFilled).toBe(true);

    // Manager edits it — the suggestion marker must clear immediately.
    act(() => result.current.setDriverName('Juan Pérez Editado'));
    expect(result.current.isAutoFilled).toBe(false);
  });
});
