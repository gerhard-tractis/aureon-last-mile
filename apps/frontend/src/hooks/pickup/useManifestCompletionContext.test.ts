import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useManifestCompletionContext } from './useManifestCompletionContext';

const mockFrom = vi.fn();
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
  }),
}));

function chain(data: unknown) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          is: () => ({ single: () => Promise.resolve({ data }) }),
        }),
      }),
    }),
  };
}

/** `users` lookup only does one `.eq()`, no `.is()` — a shallower chain. */
function usersChain(data: unknown) {
  return {
    select: () => ({
      eq: () => ({ single: () => Promise.resolve({ data }) }),
    }),
  };
}

describe('useManifestCompletionContext', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: undefined } });
  });

  it('resolves the manifest, its route code, and does nothing until operatorId is known', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'manifests') {
        return chain({
          id: 'm1',
          started_at: '2026-09-09T10:00:00Z',
          retailer_name: 'Falabella',
          pickup_route_id: 'route-1',
        });
      }
      if (table === 'pickup_routes') {
        return chain({ code: 'PR-2026-0148' });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result, rerender } = renderHook(
      ({ operatorId }) => useManifestCompletionContext(operatorId, 'CARGA-001'),
      { initialProps: { operatorId: null as string | null } },
    );

    expect(result.current.manifestId).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();

    rerender({ operatorId: 'op-1' });

    await waitFor(() => expect(result.current.manifestId).toBe('m1'));
    expect(result.current.retailerName).toBe('Falabella');
    expect(result.current.routeId).toBe('route-1');
    await waitFor(() => expect(result.current.routeExternalId).toBe('PR-2026-0148'));
  });

  it('does not query pickup_routes when the manifest has no route yet', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'manifests') {
        return chain({
          id: 'm2',
          started_at: '2026-09-09T10:00:00Z',
          retailer_name: null,
          pickup_route_id: null,
        });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useManifestCompletionContext('op-1', 'CARGA-002'));

    await waitFor(() => expect(result.current.manifestId).toBe('m2'));
    expect(result.current.routeId).toBeNull();
    expect(result.current.routeExternalId).toBeNull();
    expect(mockFrom).not.toHaveBeenCalledWith('pickup_routes');
  });

  it('resolves operatorName from the signed-in user', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'manifests') {
        return chain({ id: 'm3', started_at: null, retailer_name: null, pickup_route_id: null });
      }
      if (table === 'users') {
        return usersChain({ full_name: 'Test User' });
      }
      throw new Error(`unexpected table ${table}`);
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'u1@x.com' } } });

    const { result } = renderHook(() => useManifestCompletionContext('op-1', 'CARGA-003'));

    await waitFor(() => expect(result.current.operatorName).toBe('Test User'));
  });
});
