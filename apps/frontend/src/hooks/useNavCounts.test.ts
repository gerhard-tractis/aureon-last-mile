import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { PipelineStageCount } from './usePipelineCounts';

let mockResult: { data: PipelineStageCount[] | undefined; isLoading: boolean } = {
  data: undefined,
  isLoading: true,
};

vi.mock('./usePipelineCounts', () => ({
  usePipelineCounts: () => mockResult,
}));

import { useNavCounts, navCountTone } from './useNavCounts';

function counts(partial: Partial<Record<string, number>>): PipelineStageCount[] {
  return Object.entries(partial).map(([status, count]) => ({
    status: status as PipelineStageCount['status'],
    count: count!,
    urgent_count: 0,
    alert_count: 0,
    late_count: 0,
  }));
}

beforeEach(() => {
  mockResult = { data: undefined, isLoading: true };
});

describe('useNavCounts', () => {
  it('returns null counts while loading so badges do not flash a false zero', () => {
    const { result } = renderHook(() => useNavCounts('op-1'));
    expect(result.current).toEqual({
      pickup: null,
      reception: null,
      distribution: null,
      dispatch: null,
    });
  });

  it('maps each pipeline status to the nav item that owns that queue', () => {
    mockResult = {
      isLoading: false,
      data: counts({ ingresado: 12, verificado: 4, en_bodega: 318 }),
    };
    const { result } = renderHook(() => useNavCounts('op-1'));
    expect(result.current.pickup).toBe(12);
    expect(result.current.reception).toBe(4);
    expect(result.current.distribution).toBe(318);
  });

  it('sums the three pre-dispatch statuses into the Despacho counter', () => {
    mockResult = {
      isLoading: false,
      data: counts({ asignado: 10, en_carga: 12, listo_para_despacho: 5 }),
    };
    const { result } = renderHook(() => useNavCounts('op-1'));
    expect(result.current.dispatch).toBe(27);
  });

  it('reports zero — not null — for a queue that is genuinely empty', () => {
    // An empty queue is information. Suppressing the badge would hide it.
    mockResult = { isLoading: false, data: counts({ ingresado: 5 }) };
    const { result } = renderHook(() => useNavCounts('op-1'));
    expect(result.current.reception).toBe(0);
  });

  it('ignores statuses that belong to no nav item', () => {
    mockResult = { isLoading: false, data: counts({ entregado: 900, en_ruta: 487 }) };
    const { result } = renderHook(() => useNavCounts('op-1'));
    expect(result.current).toEqual({
      pickup: 0,
      reception: 0,
      distribution: 0,
      dispatch: 0,
    });
  });
});

describe('navCountTone', () => {
  it('is neutral below the module threshold and warning at or above it', () => {
    expect(navCountTone('distribution', 249)).toBe('neutral');
    expect(navCountTone('distribution', 250)).toBe('warning');
    expect(navCountTone('pickup', 50)).toBe('warning');
    expect(navCountTone('pickup', 49)).toBe('neutral');
  });

  it('is neutral when the count is unknown', () => {
    expect(navCountTone('pickup', null)).toBe('neutral');
  });
});
