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
  let pickupScansChain: ReturnType<typeof buildChain>;
  let packagesChain: ReturnType<typeof buildChain>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-abc' } },
      error: null,
    });

    manifestChain = buildChain({ data: null, error: null });
    receptionChain = buildChain({ data: null, error: null });
    pickupScansChain = buildChain({ data: [], error: null });
    // The pickup_scans query terminates on `.is('deleted_at', null).then(...)`,
    // so the default `.is` mock must resolve to a Promise (not return the
    // chain) — otherwise tests that only care about manifest loading still
    // need to know about pickup_scans plumbing.
    pickupScansChain.is = vi.fn().mockResolvedValue({ data: [], error: null });
    // packagesChain exists so tests can prove the hook never consults the
    // `packages` table for counting verified packages. Any reference to it
    // from the implementation would be a regression.
    packagesChain = buildChain({
      data: [{ id: 'WRONG_SOURCE_1' }, { id: 'WRONG_SOURCE_2' }, { id: 'WRONG_SOURCE_3' }],
      error: null,
    });

    mockFromHandler = (table: string) => {
      if (table === 'manifests') return manifestChain;
      if (table === 'hub_receptions') return receptionChain;
      if (table === 'pickup_scans') return pickupScansChain;
      if (table === 'packages') return packagesChain;
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

    // Verified package count comes from pickup_scans, deduped by package_id
    pickupScansChain.is = vi.fn().mockResolvedValue({
      data: [
        { package_id: 'pkg-1' },
        { package_id: 'pkg-2' },
        { package_id: 'pkg-3' },
      ],
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
    await waitFor(() => expect(result.current.verifiedPackageCount).toBe(3));

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
    pickupScansChain.is = vi.fn().mockResolvedValue({ data: [{ package_id: 'pkg-1' }], error: null });
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
    pickupScansChain.is = vi.fn().mockResolvedValue({ data: [], error: null });
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
    pickupScansChain.is = vi.fn().mockResolvedValue({ data: [{ package_id: 'pkg-1' }], error: null });
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
    pickupScansChain.is = vi.fn().mockResolvedValue({ data: [], error: null });
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

  it('exposes verifiedPackageCount derived from pickup_scans rows', async () => {
    // Regression for bug: handoff page displayed "0 paquetes verificados"
    // because it queried packages.manifest_id (a non-existent column) instead
    // of counting verified pickup_scans rows.
    const manifestData = {
      id: 'manifest-uuid-count',
      external_load_id: 'CARGA-COUNT',
      retailer_name: 'Easy',
      reception_status: null,
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });
    pickupScansChain.is = vi.fn().mockResolvedValue({
      data: [
        { package_id: 'pkg-a' },
        { package_id: 'pkg-b' },
        { package_id: 'pkg-c' },
        { package_id: 'pkg-d' },
      ],
      error: null,
    });

    const { result } = renderHook(
      () => useQRHandoff('CARGA-COUNT', 'op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.manifest).not.toBeNull());
    await waitFor(() => expect(result.current.verifiedPackageCount).toBe(4));
  });

  it('deduplicates verified package_ids when the same package is scanned twice', async () => {
    // A double-scan creates two pickup_scans rows with scan_result='verified'
    // and the same package_id. The count must reflect unique packages, not raw
    // scan rows — otherwise hub_receptions.expected_count is inflated and the
    // hub is told to expect phantom packages.
    const manifestData = {
      id: 'manifest-uuid-dedupe',
      external_load_id: 'CARGA-DEDUPE',
      retailer_name: 'Easy',
      reception_status: null,
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });
    pickupScansChain.is = vi.fn().mockResolvedValue({
      data: [
        { package_id: 'pkg-1' }, // first scan
        { package_id: 'pkg-2' },
        { package_id: 'pkg-1' }, // duplicate scan of pkg-1
        { package_id: 'pkg-3' },
        { package_id: 'pkg-2' }, // duplicate scan of pkg-2
      ],
      error: null,
    });
    receptionChain.insert = vi.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });
    manifestChain.update = vi.fn().mockReturnValue(manifestChain);

    const { result } = renderHook(
      () => useQRHandoff('CARGA-DEDUPE', 'op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.manifest).not.toBeNull());
    await waitFor(() => expect(result.current.verifiedPackageCount).toBe(3));

    await act(async () => {
      await result.current.initiateHandoff();
    });

    expect(receptionChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ expected_count: 3 })
    );
  });

  it('never reads from the packages table for verified counts (regression guard)', async () => {
    // If the implementation regresses to querying `packages` (by manifest_id
    // or otherwise), packagesChain would return three "WRONG_SOURCE_*" rows
    // and expected_count would land at 3 — but pickup_scans reports 1, so the
    // assertion below catches the regression.
    const manifestData = {
      id: 'manifest-uuid-guard',
      external_load_id: 'CARGA-GUARD',
      retailer_name: 'Easy',
      reception_status: null,
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });
    pickupScansChain.is = vi.fn().mockResolvedValue({
      data: [{ package_id: 'pkg-only' }],
      error: null,
    });
    receptionChain.insert = vi.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });
    manifestChain.update = vi.fn().mockReturnValue(manifestChain);

    const { result } = renderHook(
      () => useQRHandoff('CARGA-GUARD', 'op-123'),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.manifest).not.toBeNull());
    await waitFor(() => expect(result.current.verifiedPackageCount).toBe(1));

    await act(async () => {
      await result.current.initiateHandoff();
    });

    expect(receptionChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ expected_count: 1 })
    );
    // The packagesChain should never have been consulted.
    expect(packagesChain.select).not.toHaveBeenCalled();
  });

  it('refetches verified count from pickup_scans inside initiateHandoff', async () => {
    // Stale-count guard: the page-load count is a snapshot. If more packages
    // get scanned between opening the handoff page and pressing the button,
    // expected_count must reflect the fresh value, not the stale snapshot —
    // otherwise the hub is told to expect fewer packages than actually arrive.
    const manifestData = {
      id: 'manifest-uuid-stale',
      external_load_id: 'CARGA-STALE',
      retailer_name: 'Easy',
      reception_status: null,
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });

    // First call (page-load useEffect): 2 verified packages.
    // Second call (initiateHandoff refetch): 5 verified packages — someone
    // scanned 3 more between page load and button press.
    pickupScansChain.is = vi.fn()
      .mockResolvedValueOnce({
        data: [{ package_id: 'pkg-1' }, { package_id: 'pkg-2' }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { package_id: 'pkg-1' },
          { package_id: 'pkg-2' },
          { package_id: 'pkg-3' },
          { package_id: 'pkg-4' },
          { package_id: 'pkg-5' },
        ],
        error: null,
      });

    receptionChain.insert = vi.fn().mockResolvedValue({ data: { id: 'r1' }, error: null });
    manifestChain.update = vi.fn().mockReturnValue(manifestChain);

    const { result } = renderHook(
      () => useQRHandoff('CARGA-STALE', 'op-123'),
      { wrapper: createWrapper() }
    );

    // Wait for the page-load fetch to settle on 2.
    await waitFor(() => expect(result.current.manifest).not.toBeNull());
    await waitFor(() => expect(result.current.verifiedPackageCount).toBe(2));

    await act(async () => {
      await result.current.initiateHandoff();
    });

    // hub_receptions row must use the FRESH count, not the snapshot.
    expect(receptionChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ expected_count: 5 })
    );

    // The on-screen count must also be updated so the QR view, which renders
    // the same value, shows the correct number to the operator.
    expect(result.current.verifiedPackageCount).toBe(5);
  });

  it('exposes isCountLoading=true until the initial pickup_scans fetch resolves', async () => {
    // The button must distinguish "still loading" from "loaded with zero
    // results" — both cases would otherwise show count=0 and be wrongly
    // interpreted as a legitimate empty handoff.
    const manifestData = {
      id: 'manifest-uuid-loading',
      external_load_id: 'CARGA-LOADING',
      retailer_name: 'Easy',
      reception_status: null,
    };

    manifestChain.single = vi.fn().mockResolvedValue({ data: manifestData, error: null });
    pickupScansChain.is = vi.fn().mockResolvedValue({
      data: [{ package_id: 'pkg-1' }],
      error: null,
    });

    const { result } = renderHook(
      () => useQRHandoff('CARGA-LOADING', 'op-123'),
      { wrapper: createWrapper() }
    );

    // Once the pickup_scans fetch resolves, isCountLoading should flip to false
    // and verifiedPackageCount should reflect the fetched count.
    await waitFor(() => expect(result.current.verifiedPackageCount).toBe(1));
    expect(result.current.isCountLoading).toBe(false);
  });
});
