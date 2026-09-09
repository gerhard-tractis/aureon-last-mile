import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { db } from '@/lib/db';
import { saveManifestSnapshot } from '@/lib/offline/manifest-cache';
import { useOfflineScanSource } from './useOfflineScanSource';

const OPERATOR_A = 'operator-a';
const LOAD_1 = 'CARGA-99817';

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useOfflineScanSource', () => {
  beforeEach(async () => {
    await db.manifest_cache.clear();
  });

  it('is inert while online: no unknown, no blocked, no snapshot', () => {
    const { result } = renderHook(
      () => useOfflineScanSource(OPERATOR_A, LOAD_1, false),
      { wrapper: createWrapper() },
    );
    expect(result.current.unknown).toBe(false);
    expect(result.current.blocked).toBe(false);
    expect(result.current.snapshot).toBeNull();
  });

  it('is "unknown" offline before the local read resolves — never "blocked" prematurely', () => {
    const { result } = renderHook(
      () => useOfflineScanSource(OPERATOR_A, LOAD_1, true),
      { wrapper: createWrapper() },
    );
    expect(result.current.unknown).toBe(true);
    expect(result.current.blocked).toBe(false);
  });

  it('is "blocked" offline once resolved, for a carga never downloaded', async () => {
    const { result } = renderHook(
      () => useOfflineScanSource(OPERATOR_A, 'CARGA-NUNCA', true),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.unknown).toBe(false));
    expect(result.current.blocked).toBe(true);
    expect(result.current.snapshot).toBeNull();
  });

  it('provides the snapshot offline for a downloaded carga, and is not blocked', async () => {
    await saveManifestSnapshot(db, {
      operatorId: OPERATOR_A,
      externalLoadId: LOAD_1,
      manifestId: 'manifest-1',
      totalPackages: 25,
      pickupRouteId: 'route-1',
      retailerName: 'Ripley',
      pickupLocation: 'Parque Arauco',
      orders: [],
    });

    const { result } = renderHook(
      () => useOfflineScanSource(OPERATOR_A, LOAD_1, true),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.unknown).toBe(false));
    expect(result.current.blocked).toBe(false);
    expect(result.current.snapshot?.retailerName).toBe('Ripley');
  });
});
