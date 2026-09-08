import { describe, it, expect } from 'vitest';
import {
  computeReviewCounts,
  dedupeNotFoundBarcodes,
  allMissingNotesComplete,
  closeButtonLabel,
} from './reviewCloseGate';

describe('dedupeNotFoundBarcodes', () => {
  it('returns distinct barcodes among not_found scans', () => {
    const scans = [
      { scan_result: 'verified', barcode_scanned: 'A' },
      { scan_result: 'not_found', barcode_scanned: 'B' },
      { scan_result: 'not_found', barcode_scanned: 'B' },
      { scan_result: 'not_found', barcode_scanned: 'C' },
    ];
    expect(dedupeNotFoundBarcodes(scans)).toEqual(['B', 'C']);
  });

  it('ignores not_found scans with no barcode', () => {
    const scans = [{ scan_result: 'not_found', barcode_scanned: null }];
    expect(dedupeNotFoundBarcodes(scans)).toEqual([]);
  });

  it('returns an empty array when nothing is not_found', () => {
    const scans = [{ scan_result: 'verified', barcode_scanned: 'A' }];
    expect(dedupeNotFoundBarcodes(scans)).toEqual([]);
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

describe('allMissingNotesComplete', () => {
  it('is true when there are no missing packages', () => {
    expect(allMissingNotesComplete([], new Map())).toBe(true);
  });

  it('is false when a missing package has no note', () => {
    const noteMap = new Map([['pkg1', 'Se cayó del camión']]);
    expect(allMissingNotesComplete(['pkg1', 'pkg2'], noteMap)).toBe(false);
  });

  it('is false when a note is only whitespace', () => {
    const noteMap = new Map([['pkg1', '   ']]);
    expect(allMissingNotesComplete(['pkg1'], noteMap)).toBe(false);
  });

  it('is true when every missing package has a non-empty note', () => {
    const noteMap = new Map([
      ['pkg1', 'Se cayó del camión'],
      ['pkg2', 'No llegó al local'],
    ]);
    expect(allMissingNotesComplete(['pkg1', 'pkg2'], noteMap)).toBe(true);
  });
});

describe('closeButtonLabel', () => {
  it('reads "Continuar a firma" when there are no missing packages', () => {
    expect(closeButtonLabel(0)).toBe('Continuar a firma');
  });

  it('reads singular for exactly one missing package', () => {
    expect(closeButtonLabel(1)).toBe('Cerrar con 1 faltante');
  });

  it('reads plural for more than one missing package', () => {
    expect(closeButtonLabel(3)).toBe('Cerrar con 3 faltantes');
  });
});
