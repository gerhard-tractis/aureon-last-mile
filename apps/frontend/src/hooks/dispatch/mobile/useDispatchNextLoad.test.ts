import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/dispatch/mobile/useCrewLoadingBoard', () => ({
  useCrewLoadingBoard: vi.fn(),
}));

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ auth: { getUser: mockGetUser } }),
}));

import { useCrewLoadingBoard } from '@/hooks/dispatch/mobile/useCrewLoadingBoard';
import { useDispatchNextLoad } from './useDispatchNextLoad';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

describe('useDispatchNextLoad — item 17, a concrete next load or null', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  });

  it('returns the first loadable route in the crew queue, excluding the just-dispatched one', async () => {
    (useCrewLoadingBoard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        queue: [{ id: 'r-90', code: 'RUT-2026-0090', comuna: 'Maipú' }],
      },
    });
    const { result } = renderHook(() => useDispatchNextLoad('op-1', 'r-just-dispatched'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toEqual({ id: 'r-90', code: 'RUT-2026-0090', comuna: 'Maipú' }));
  });

  it('returns null when the queue is empty — never invents a next load', async () => {
    (useCrewLoadingBoard as ReturnType<typeof vi.fn>).mockReturnValue({ data: { queue: [] } });
    const { result } = renderHook(() => useDispatchNextLoad('op-1', 'r1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('skips the just-dispatched route even if the board has not refetched yet', async () => {
    (useCrewLoadingBoard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        queue: [
          { id: 'r-just-dispatched', code: 'RUT-0001', comuna: 'Ñuñoa' },
          { id: 'r-90', code: 'RUT-2026-0090', comuna: 'Maipú' },
        ],
      },
    });
    const { result } = renderHook(() => useDispatchNextLoad('op-1', 'r-just-dispatched'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current).toEqual({ id: 'r-90', code: 'RUT-2026-0090', comuna: 'Maipú' }));
  });
});
