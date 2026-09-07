import { describe, it, expect } from 'vitest';
import {
  decodePickupScan,
  pickupScanRouteLabel,
  type DossierPickupScan,
} from './pickup-scan-events';

function scan(overrides: Partial<DossierPickupScan> = {}): DossierPickupScan {
  return {
    id: 'ps-1',
    scanned_at: '2026-09-07T17:11:57',
    scan_result: 'verified',
    barcode_scanned: 'CTN001',
    package_id: 'pkg-1',
    scanned_by_user_id: 'u-1',
    route_id: '4835b161-33c4-4d12-9e4d-b3c9ae4e0eea',
    route_code: 'PR-2026-2298',
    actorName: 'Musan Líder de Recogida',
    ...overrides,
  };
}

describe('decodePickupScan — title', () => {
  it('names a verified scan as the pickup verification it is', () => {
    expect(decodePickupScan(scan()).title).toBe('Paquete verificado en recogida');
  });

  it('distinguishes a duplicate scan from a verification', () => {
    expect(decodePickupScan(scan({ scan_result: 'duplicate' })).title).toBe(
      'Escaneo duplicado en recogida',
    );
  });

  it('distinguishes an unrecognised barcode', () => {
    expect(decodePickupScan(scan({ scan_result: 'not_found' })).title).toBe(
      'Código no reconocido en recogida',
    );
  });

  // A new enum value must not render as a blank row.
  it('falls back to a generic pickup title for an unknown scan_result', () => {
    expect(decodePickupScan(scan({ scan_result: 'nuevo_estado' })).title).toBe('Escaneo de recogida');
  });
});

describe('decodePickupScan — package', () => {
  it('names the package by the label the operator sees, not the raw barcode', () => {
    const decoded = decodePickupScan(scan({ barcode_scanned: 'RAW-9' }), { 'pkg-1': 'CTN001' });
    expect(decoded.packageLabel).toBe('CTN001');
  });

  it('falls back to the scanned barcode when the package is unknown', () => {
    const decoded = decodePickupScan(scan({ package_id: null, barcode_scanned: 'RAW-9' }));
    expect(decoded.packageLabel).toBe('RAW-9');
  });

  // A not_found scan has no package by definition — the barcode is all there is.
  it('uses the barcode for a not_found scan', () => {
    const decoded = decodePickupScan(
      scan({ scan_result: 'not_found', package_id: null, barcode_scanned: 'BASURA-1' }),
      { 'pkg-1': 'CTN001' },
    );
    expect(decoded.packageLabel).toBe('BASURA-1');
  });
});

describe('pickupScanRouteLabel', () => {
  it('shows the human route code', () => {
    expect(pickupScanRouteLabel(scan())).toBe('PR-2026-2298');
  });

  // Omit, never fabricate — a manifest with no pickup route is a real state.
  it('returns null when the scan has no route', () => {
    expect(pickupScanRouteLabel(scan({ route_code: null, route_id: null }))).toBeNull();
  });

  it('falls back to the route uuid when the code is missing but the route exists', () => {
    expect(pickupScanRouteLabel(scan({ route_code: null }))).toBe(
      '4835b161-33c4-4d12-9e4d-b3c9ae4e0eea',
    );
  });
});
