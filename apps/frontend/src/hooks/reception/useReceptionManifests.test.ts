import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useReceptionManifests } from './useReceptionManifests';

const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockIs = vi.fn();
const mockOrder = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: mockSelect,
    }),
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
    mockSelect.mockReturnValue({ in: mockIn });
    mockIn.mockReturnValue({ is: mockIs });
    mockIs.mockReturnValue({ order: mockOrder });
  });

  it('does not fetch when operatorId is null', () => {
    renderHook(() => useReceptionManifests(null), { wrapper: createWrapper() });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('fetches manifests with awaiting_reception and reception_in_progress statuses', async () => {
    const mockData = [
      {
        id: 'manifest-1',
        external_load_id: 'CARGA-001',
        retailer_name: 'Easy',
        total_packages: 25,
        completed_at: '2026-03-18T10:00:00Z',
        reception_status: 'awaiting_reception',
        assigned_to_user_id: 'user-1',
        hub_receptions: [],
      },
    ];
    mockOrder.mockResolvedValue({ data: mockData, error: null });

    const { result } = renderHook(
      () => useReceptionManifests('op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockData);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockIn).toHaveBeenCalledWith('reception_status', [
      'awaiting_reception',
      'reception_in_progress',
    ]);
    expect(mockIs).toHaveBeenCalledWith('deleted_at', null);
  });

  it('handles errors from Supabase', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { result } = renderHook(
      () => useReceptionManifests('op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('returns empty array when no manifests match', async () => {
    mockOrder.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => useReceptionManifests('op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
