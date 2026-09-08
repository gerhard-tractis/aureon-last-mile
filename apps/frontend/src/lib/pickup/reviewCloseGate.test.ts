import { describe, it, expect } from 'vitest';
import {
  computeReviewCounts,
  dedupeNotFoundScans,
  closeButtonLabel,
  primaryButtonLabel,
  missingHeadingLabel,
} from './reviewCloseGate';

describe('dedupeNotFoundScans', () => {
  it('returns distinct barcodes among not_found scans, keeping the first scanned_at seen', () => {
    const scans = [
      { scan_result: 'verified', barcode_scanned: 'A', scanned_at: '2026-09-08T08:00:00Z' },
      { scan_result: 'not_found', barcode_scanned: 'B', scanned_at: '2026-09-08T08:47:00Z' },
      { scan_result: 'not_found', barcode_scanned: 'B', scanned_at: '2026-09-08T08:50:00Z' },
      { scan_result: 'not_found', barcode_scanned: 'C', scanned_at: '2026-09-08T08:48:00Z' },
    ];
    expect(dedupeNotFoundScans(scans)).toEqual([
      { barcode: 'B', scannedAt: '2026-09-08T08:47:00Z' },
      { barcode: 'C', scannedAt: '2026-09-08T08:48:00Z' },
    ]);
  });

  it('ignores not_found scans with no barcode', () => {
    const scans = [{ scan_result: 'not_found', barcode_scanned: null, scanned_at: '2026-09-08T08:00:00Z' }];
    expect(dedupeNotFoundScans(scans)).toEqual([]);
  });

  it('returns an empty array when nothing is not_found', () => {
    const scans = [{ scan_result: 'verified', barcode_scanned: 'A', scanned_at: '2026-09-08T08:00:00Z' }];
    expect(dedupeNotFoundScans(scans)).toEqual([]);
  });
});

describe('computeReviewCounts', () => {
  it('counts verified scans, missing packages, and deduped unexpected barcodes', () => {
    const scans = [
      { scan_result: 'verified', barcode_scanned: 'A' },
      { scan_result: 'verified', barcode_scanned: 'B' },
      { scan_result: 'not_found', barcode_scanned: 'X' },
      { scan_result: 'not_found', barcode_scanned: 'X' },
    ];
    const counts = computeReviewCounts(scans, 3);
    expect(counts).toEqual({
      verifiedCount: 2,
      missingCount: 3,
      unexpectedCount: 1,
      totalCount: 5,
    });
  });

  it('handles zero missing and zero unexpected', () => {
    const scans = [{ scan_result: 'verified', barcode_scanned: 'A' }];
    const counts = computeReviewCounts(scans, 0);
    expect(counts).toEqual({
      verifiedCount: 1,
      missingCount: 0,
      unexpectedCount: 0,
      totalCount: 1,
    });
  });
});

describe('closeButtonLabel', () => {
  it('reads singular for exactly one missing package', () => {
    expect(closeButtonLabel(1)).toBe('Cerrar con 1 faltante');
  });

  it('reads plural for more than one missing package', () => {
    expect(closeButtonLabel(3)).toBe('Cerrar con 3 faltantes');
  });
});

describe('primaryButtonLabel', () => {
  it('reads "Seguir escaneando" while there are missing packages — mock 5e keeps this the gold/primary action, not the close', () => {
    expect(primaryButtonLabel(3)).toBe('Seguir escaneando');
  });

  it('reads "Continuar a firma" once there is nothing missing', () => {
    expect(primaryButtonLabel(0)).toBe('Continuar a firma');
  });
});

describe('missingHeadingLabel', () => {
  it('reads singular "Falta 1 paquete" for exactly one missing package', () => {
    expect(missingHeadingLabel(1)).toBe('Falta 1 paquete');
  });

  it('reads plural "Faltan N paquetes" for more than one', () => {
    expect(missingHeadingLabel(3)).toBe('Faltan 3 paquetes');
  });
});
