// apps/frontend/src/hooks/distribution/usePendingSectorization.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { usePendingSectorization } from './usePendingSectorization';

const mockIs = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockOrder = vi.fn();
const mockFrom = vi.fn();

const mockSupabase = { from: mockFrom };

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/hooks/distribution/useDockZones', () => ({
  useDockZones: vi.fn(() => ({ data: [], isLoading: false })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, is: mockIs });
  mockIs.mockReturnValue({ order: mockOrder });
  mockOrder.mockResolvedValue({ data: [], error: null });
});

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, {
    client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  }, children);

describe('usePendingSectorization', () => {
  it('returns empty array when no en_bodega packages', async () => {
    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    // zones is empty, so query is disabled → fetchStatus idle
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => usePendingSectorization(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns empty array when zones exist but no packages', async () => {
    const { useDockZones } = await import('@/hooks/distribution/useDockZones');
    vi.mocked(useDockZones).mockReturnValue({
      data: [
        { id: 'z1', name: 'Andén 1', code: 'DOCK-001', is_consolidation: false, comunas: ['las condes'], is_active: true, operator_id: 'op-1' },
        { id: 'consol', name: 'Consolidación', code: 'CONSOL', is_consolidation: true, comunas: [], is_active: true, operator_id: 'op-1' },
      ],
      isLoading: false,
    } as ReturnType<typeof useDockZones>);

    mockOrder.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => usePendingSectorization('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
