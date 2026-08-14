import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PipelineStageCount } from '../usePipelineCounts';

let mockData: PipelineStageCount[] | undefined;

vi.mock('../usePipelineCounts', () => ({
  usePipelineCounts: () => ({ data: mockData, isLoading: mockData === undefined }),
}));

import { useDayPromise } from './useDayPromise';

function row(
  status: string,
  count: number,
  extra: Partial<PipelineStageCount> = {},
): PipelineStageCount {
  return {
    status: status as PipelineStageCount['status'],
    count,
    urgent_count: 0,
    alert_count: 0,
    late_count: 0,
    ...extra,
  };
}

beforeEach(() => {
  mockData = undefined;
});

describe('useDayPromise', () => {
  it('is empty while the counts are still loading', () => {
    const { result } = renderHook(() => useDayPromise('op-1'));
    expect(result.current.total).toBe(0);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.segments).toEqual([]);
  });

  it('partitions the day into four segments that sum to the total', () => {
    mockData = [
      row('entregado', 823),
      row('en_ruta', 300, { late_count: 60, alert_count: 39 }),
      row('en_bodega', 161, { late_count: 23, alert_count: 40, urgent_count: 38 }),
    ];
    const { result } = renderHook(() => useDayPromise('op-1'));

    const sum = result.current.segments.reduce((s, seg) => s + seg.value, 0);
    expect(result.current.total).toBe(1284);
    expect(sum).toBe(1284);
  });

  it('reads delivered straight from the entregado row', () => {
    mockData = [row('entregado', 823), row('en_ruta', 100)];
    const { result } = renderHook(() => useDayPromise('op-1'));
    expect(result.current.delivered).toBe(823);
  });

  it('does not count a delivered order as late or at risk', () => {
    // A late_count on the entregado row means "delivered, but late" — it is no
    // longer at risk, and counting it again would double-count the order.
    mockData = [row('entregado', 100, { late_count: 30, alert_count: 10 })];
    const { result } = renderHook(() => useDayPromise('op-1'));
    expect(result.current.late).toBe(0);
    expect(result.current.atRisk).toBe(0);
    expect(result.current.delivered).toBe(100);
  });

  it('treats urgent and alert together as at risk', () => {
    mockData = [row('en_bodega', 50, { urgent_count: 8, alert_count: 12 })];
    const { result } = renderHook(() => useDayPromise('op-1'));
    expect(result.current.atRisk).toBe(20);
  });

  it('never lets the in-flight remainder go negative', () => {
    // Defensive: if the RPC ever reports more flagged orders than rows, a
    // naive subtraction would render a negative-width bar segment.
    mockData = [row('en_ruta', 10, { late_count: 8, alert_count: 7 })];
    const { result } = renderHook(() => useDayPromise('op-1'));
    const inFlight = result.current.segments.find((s) => s.key === 'in_flight')!;
    expect(inFlight.value).toBeGreaterThanOrEqual(0);
  });

  it('reports zero everywhere for an operator with no orders', () => {
    mockData = [];
    const { result } = renderHook(() => useDayPromise('op-1'));
    expect(result.current.total).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });
});
