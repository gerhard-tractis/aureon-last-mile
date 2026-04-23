import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useReceptionManifests } from './useReceptionManifests';

const mockManifestsSelect = vi.fn();
const mockManifestsIn = vi.fn();
const mockManifestsIs = vi.fn();
const mockManifestsOrder = vi.fn();

const mockOrdersSelect = vi.fn();
const mockOrdersIn = vi.fn();
const mockOrdersNot = vi.fn();
const mockOrdersIs = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => {
      if (table === 'orders') return { select: mockOrdersSelect };
      return { select: mockManifestsSelect };
    },
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useReceptionManifests', () => {
  beforeEach(() => {
    mockManifestsSelect.mockReturnValue({ in: mockManifestsIn });
    mockManifestsIn.mockReturnValue({ is: mockManifestsIs });
    mockManifestsIs.mockReturnValue({ order: mockManifestsOrder });

    mockOrdersSelect.mockReturnValue({ in: mockOrdersIn });
    mockOrdersIn.mockReturnValue({ not: mockOrdersNot });
    mockOrdersNot.mockReturnValue({ is: mockOrdersIs });
    mockOrdersIs.mockResolvedValue({ data: [], error: null });
  });

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useReceptionManifests(null), { wrapper: createWrapper() });
    expect(mockManifestsSelect).not.toHaveBeenCalled();
  });

  it('fetches manifests with awaiting_reception and reception_in_progress statuses', async () => {
    const mockData = [
      {
        id: 'manifest-1',
        external_load_id: 'CARGA-001',
        retailer_name: 'Easy',
        pickup_location: null,
        total_packages: 25,
        completed_at: '2026-03-18T10:00:00Z',
        reception_status: 'awaiting_reception',
        assigned_to_user_id: 'user-1',
        hub_receptions: [],
      },
    ];
    mockManifestsOrder.mockResolvedValue({ data: mockData, error: null });
    mockOrdersIs.mockResolvedValue({
      data: [{ external_load_id: 'CARGA-001', pickup_point: { name: 'CD Easy Maipú' } }],
      error: null,
    });

    const { result } = renderHook(
      () => useReceptionManifests('op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { ...mockData[0], pickup_point_name: 'CD Easy Maipú' },
    ]);
    expect(mockManifestsSelect).toHaveBeenCalled();
    expect(mockManifestsIn).toHaveBeenCalledWith('reception_status', [
      'awaiting_reception',
      'reception_in_progress',
    ]);
    expect(mockManifestsIs).toHaveBeenCalledWith('deleted_at', null);
  });

  it('handles errors from Supabase', async () => {
    mockManifestsOrder.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(
      () => useReceptionManifests('op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('returns empty array when no manifests match', async () => {
    mockManifestsOrder.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => useReceptionManifests('op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
