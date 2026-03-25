import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCompletedReceptions } from './useCompletedReceptions';
import type { ReactNode } from 'react';
import React from 'react';

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () => Promise.resolve({
              data: [{
                id: 'm1', external_load_id: 'CARGA-001', retailer_name: 'Easy',
                total_packages: 20, completed_at: '2026-03-25T10:00:00Z',
                reception_status: 'received', assigned_to_user_id: 'u1',
                hub_receptions: [{ id: 'r1', expected_count: 20, received_count: 20, status: 'completed', completed_at: '2026-03-25T11:00:00Z' }],
              }],
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useCompletedReceptions', () => {
  it('fetches completed manifests', async () => {
    const { result } = renderHook(() => useCompletedReceptions('op-1'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].retailer_name).toBe('Easy');
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => useCompletedReceptions(null), { wrapper });
    expect(result.current.data).toBeUndefined();
  });
});
