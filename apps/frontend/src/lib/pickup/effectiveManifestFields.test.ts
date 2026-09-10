import { describe, it, expect } from 'vitest';
import { effectiveManifestFields, type NetworkManifestFields } from './effectiveManifestFields';
import type { ManifestCacheRecord } from '@/lib/offline/manifest-cache';

const network: NetworkManifestFields = {
  manifestId: 'net-manifest',
  totalPackages: 10,
  pickupRouteId: 'net-route',
  retailerName: 'Net Retailer',
  pickupPoint: 'Net Point',
};

const snapshot: ManifestCacheRecord = {
  operatorId: 'op-1',
  externalLoadId: 'CARGA-1',
  manifestId: 'snap-manifest',
  totalPackages: 25,
  pickupRouteId: 'snap-route',
  retailerName: 'Snap Retailer',
  pickupLocation: 'Snap Point',
  orders: [],
  downloadedAt: '2026-01-01T00:00:00.000Z',
};

describe('effectiveManifestFields', () => {
  it('returns the network fields unchanged when there is no snapshot', () => {
    expect(effectiveManifestFields(null, network)).toEqual(network);
  });

  it('returns the snapshot fields, mapped, when a snapshot exists', () => {
    expect(effectiveManifestFields(snapshot, network)).toEqual({
      manifestId: 'snap-manifest',
      totalPackages: 25,
      pickupRouteId: 'snap-route',
      retailerName: 'Snap Retailer',
      pickupPoint: 'Snap Point',
    });
  });

  it('defaults totalPackages to 0 when the snapshot has it as null, never the network value', () => {
    const result = effectiveManifestFields({ ...snapshot, totalPackages: null }, network);
    expect(result.totalPackages).toBe(0);
  });
});
