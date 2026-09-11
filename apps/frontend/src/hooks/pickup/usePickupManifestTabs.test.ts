import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePickupManifestTabs } from './usePickupManifestTabs';

const mockUsePendingManifests = vi.fn();
const mockUseInTransitManifests = vi.fn();
const mockUseCompletedManifests = vi.fn();
const mockUseSignatureRescueManifests = vi.fn();
vi.mock('@/hooks/pickup/useManifests', () => ({
  usePendingManifests: (...args: unknown[]) => mockUsePendingManifests(...args),
  useInTransitManifests: (...args: unknown[]) => mockUseInTransitManifests(...args),
  useCompletedManifests: (...args: unknown[]) => mockUseCompletedManifests(...args),
  useSignatureRescueManifests: (...args: unknown[]) => mockUseSignatureRescueManifests(...args),
}));

const mockUseRoutedManifests = vi.fn();
vi.mock('@/hooks/pickup/useRoutedManifests', () => ({
  useRoutedManifests: (...args: unknown[]) => mockUseRoutedManifests(...args),
}));

describe('usePickupManifestTabs', () => {
  beforeEach(() => {
    mockUsePendingManifests.mockReturnValue({ data: [] });
    mockUseRoutedManifests.mockReturnValue({ data: [] });
    mockUseInTransitManifests.mockReturnValue({ data: [] });
    mockUseCompletedManifests.mockReturnValue({ data: [] });
    mockUseSignatureRescueManifests.mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
      fetchStatus: 'idle',
      refetch: vi.fn(),
    });
  });

  it('calls all five queries, forwarding operatorId', () => {
    renderHook(() => usePickupManifestTabs('op-1', false));
    expect(mockUsePendingManifests).toHaveBeenCalledWith('op-1');
    expect(mockUseRoutedManifests).toHaveBeenCalledWith('op-1');
    expect(mockUseCompletedManifests).toHaveBeenCalledWith('op-1');
    expect(mockUseSignatureRescueManifests).toHaveBeenCalledWith('op-1');
  });

  // item 8 (spec-54 3h) — mobile has no "en tránsito" tab.
  it('forwards isBelowLg as the in-transit query`s enabled flag, inverted', () => {
    renderHook(() => usePickupManifestTabs('op-1', true));
    expect(mockUseInTransitManifests).toHaveBeenCalledWith('op-1', false);

    renderHook(() => usePickupManifestTabs('op-1', false));
    expect(mockUseInTransitManifests).toHaveBeenCalledWith('op-1', true);
  });

  it('maps pending manifests into ManifestRow[] via pendingToRows', () => {
    mockUsePendingManifests.mockReturnValue({
      data: [
        {
          id: 'm1',
          external_load_id: 'CARGA-001',
          retailer_name: 'Easy',
          order_count: 5,
          package_count: 12,
          created_at: '2026-09-10T09:00:00Z',
          pickup_point: 'Easy Vespucio',
          verified_count: 0,
        },
      ],
    });
    const { result } = renderHook(() => usePickupManifestTabs('op-1', false));
    expect(result.current.pendingRows).toEqual([
      expect.objectContaining({ externalLoadId: 'CARGA-001', orderCount: 5, packageCount: 12 }),
    ]);
  });

  it('passes routed manifests through unmapped (RoutedManifestTable reads snake_case directly)', () => {
    const routedData = [
      {
        id: 'r1',
        external_load_id: 'CARGA-DOCK',
        retailer_name: 'Easy',
        total_orders: 5,
        total_packages: 12,
        created_at: '2026-09-10T09:00:00Z',
        pickup_point: 'Easy Vespucio',
        labels_printed_at: null,
        labels_printed_by_name: null,
        route_code: 'PR-2026-0042',
        route_started_at: '2026-09-10T08:00:00Z',
        driver_name: 'Juan',
        route_status: 'in_progress',
        closed_at: null,
        missing_count: 0,
        verified_count: 2,
      },
    ];
    mockUseRoutedManifests.mockReturnValue({ data: routedData });
    const { result } = renderHook(() => usePickupManifestTabs('op-1', false));
    expect(result.current.routedRows).toEqual(routedData);
    expect(result.current.routed).toEqual(routedData);
  });

  it('defaults every query result to an empty array while loading', () => {
    mockUsePendingManifests.mockReturnValue({ data: undefined });
    mockUseRoutedManifests.mockReturnValue({ data: undefined });
    mockUseInTransitManifests.mockReturnValue({ data: undefined });
    mockUseCompletedManifests.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => usePickupManifestTabs('op-1', false));
    expect(result.current.pending).toEqual([]);
    expect(result.current.routed).toEqual([]);
    expect(result.current.inTransit).toEqual([]);
    expect(result.current.completed).toEqual([]);
  });
});
