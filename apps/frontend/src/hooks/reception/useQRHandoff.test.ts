import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Auth mock
const mockGetUser = vi.fn();

/**
 * Build a chainable Supabase query mock.
 * Each method returns the chain, with the terminal call resolving to `result`.
 */
function buildChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(result);
  chain.insert = vi.fn().mockResolvedValue(result);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  return chain;
}

let mockFromHandler: (table: string) => Record<string, unknown>;

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: (table: string) => mockFromHandler(table),
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock('@/hooks/useOperatorId', () => ({
  useOperatorId: () => ({ operatorId: 'op-123', role: 'driver', permissions: ['pickup'] }),
}));

import { useQRHandoff } from './useQRHandoff';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('useQRHandoff', () => {
  let manifestChain: ReturnType<typeof buildChain>;
  let receptionChain: ReturnType<typeof buildChain>;
  let packageChain: ReturnType<typeof buildChain>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
      error: null,
    });

    manifestChain = buildChain({ data: null, error: null });
    receptionChain = buildChain({ data: null, error: null });
    packageChain = buildChain({ data: null, error: null });

    mockFromHandler = (table: string) => {
      if (table === 'manifests') return manifestChain;
      if (table === 'hub_receptions') return receptionChain;
      if (table === 'packages') return packageChain;
      return buildChain({ data: null, error: null });
    };
  });

  it('fetches manifest data by externalLoadId and operatorId', async () => {
    const manifestData = {
      id: 'manifest-uuid-123',
      external_load_id: 'CARGA-001',
      retailer_name: 'Easy',
      reception_status: null,
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });

    const { result } = renderHook(
      () => useQRHandoff('CARGA-001', 'op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(result.current.manifest).not.toBeNull();
    });
    expect(result.current.manifest?.id).toBe('manifest-uuid-123');
    expect(result.current.manifest?.retailer_name).toBe('Easy');
  });

  it('does not fetch when operatorId is null', () => {
    const { result } = renderHook(
      () => useQRHandoff('CARGA-001', null),
      { wrapper: createWrapper() }
    );

    expect(manifestChain.select).not.toHaveBeenCalled();
    expect(result.current.manifest).toBeNull();
  });

  it('does not fetch when externalLoadId is empty', () => {
    const { result } = renderHook(
      () => useQRHandoff('', 'op-123'),
      { wrapper: createWrapper() }
    );

    expect(manifestChain.select).not.toHaveBeenCalled();
    expect(result.current.manifest).toBeNull();
  });

  it('creates hub_receptions record and updates manifest on handoff', async () => {
    const manifestData = {
      id: 'manifest-uuid-123',
      external_load_id: 'CARGA-001',
      retailer_name: 'Easy',
      reception_status: null,
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });

    // Package count: 3 verificado packages
    packageChain.is = vi.fn().mockResolvedValue({
      data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      error: null,
    });

    // Hub reception insert success
    receptionChain.insert = vi.fn().mockResolvedValue({ data: { id: 'reception-001' }, error: null });

    // Manifest update success (for reception_status)
    manifestChain.update = vi.fn().mockReturnValue(manifestChain);

    const { result } = renderHook(
      () => useQRHandoff('CARGA-001', 'op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.manifest).not.toBeNull());

    await act(async () => {
      await result.current.initiateHandoff();
    });

    // Should have inserted a hub_receptions record
    expect(receptionChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest_id: 'manifest-uuid-123',
        operator_id: 'op-123',
        delivered_by: 'user-abc',
        status: 'pending',
        expected_count: 3,
        received_count: 0,
      })
    );
  });

  it('returns manifestId for QR encoding after handoff', async () => {
    const manifestData = {
      id: 'manifest-uuid-456',
      external_load_id: 'CARGA-002',
      retailer_name: 'Sodimac',
      reception_status: null,
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });
    packageChain.is = vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null });
    receptionChain.insert = vi.fn().mockResolvedValue({ data: { id: 'reception-002' }, error: null });
    manifestChain.update = vi.fn().mockReturnValue(manifestChain);

    const { result } = renderHook(
      () => useQRHandoff('CARGA-002', 'op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.manifest).not.toBeNull());

    await act(async () => {
      await result.current.initiateHandoff();
    });

    expect(result.current.qrPayload).toBe('manifest-uuid-456');
  });

  it('sets isHandoffComplete to true after successful handoff', async () => {
    const manifestData = {
      id: 'manifest-uuid-789',
      external_load_id: 'CARGA-003',
      retailer_name: 'Falabella',
      reception_status: null,
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });
    packageChain.is = vi.fn().mockResolvedValue({ data: [], error: null });
    receptionChain.insert = vi.fn().mockResolvedValue({ data: { id: 'reception-003' }, error: null });
    manifestChain.update = vi.fn().mockReturnValue(manifestChain);

    const { result } = renderHook(
      () => useQRHandoff('CARGA-003', 'op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.manifest).not.toBeNull());
    expect(result.current.isHandoffComplete).toBe(false);

    await act(async () => {
      await result.current.initiateHandoff();
    });

    expect(result.current.isHandoffComplete).toBe(true);
  });

  it('skips manifest reception_status update when already set', async () => {
    const manifestData = {
      id: 'manifest-uuid-already',
      external_load_id: 'CARGA-004',
      retailer_name: 'Ripley',
      reception_status: 'awaiting_reception',
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });
    packageChain.is = vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null });
    receptionChain.insert = vi.fn().mockResolvedValue({ data: { id: 'reception-004' }, error: null });
    manifestChain.update = vi.fn().mockReturnValue(manifestChain);

    const { result } = renderHook(
      () => useQRHandoff('CARGA-004', 'op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.manifest).not.toBeNull());

    await act(async () => {
      await result.current.initiateHandoff();
    });

    // Should NOT have called update on manifests (reception_status already set)
    expect(manifestChain.update).not.toHaveBeenCalled();
    expect(result.current.isHandoffComplete).toBe(true);
  });

  it('handles errors during handoff', async () => {
    const manifestData = {
      id: 'manifest-uuid-err',
      external_load_id: 'CARGA-ERR',
      retailer_name: 'Error Store',
      reception_status: null,
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });
    packageChain.is = vi.fn().mockResolvedValue({ data: [], error: null });
    receptionChain.insert = vi.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } });

    const { result } = renderHook(
      () => useQRHandoff('CARGA-ERR', 'op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.manifest).not.toBeNull());

    await act(async () => {
      await result.current.initiateHandoff();
    });

    expect(result.current.isHandoffComplete).toBe(false);
    expect(result.current.error).toBeTruthy();
  });
});
