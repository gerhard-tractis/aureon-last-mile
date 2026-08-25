import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordQuickSortException } from './quicksort-exception';
import type { DockZone } from './sectorization-engine';

const mockInsert = vi.fn();
const mockFrom = vi.fn(() => ({ insert: mockInsert }));

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => ({ from: mockFrom })),
}));

const zones: DockZone[] = [
  { id: 'zone-b7', name: 'Andén B7', code: 'B7', is_consolidation: false, is_active: true, comunas: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
});

describe('recordQuickSortException', () => {
  it('resolves the scanned code to its zone and records dock_zone_id, keeping barcode as the package label', async () => {
    await recordQuickSortException({
      operatorId: 'op-1',
      batchId: 'batch-1',
      packageId: 'pkg-1',
      packageLabel: 'PKG-001',
      rejectedCode: 'b7',
      zones,
      userId: 'user-1',
    });

    expect(mockFrom).toHaveBeenCalledWith('dock_scans');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: 'op-1',
        batch_id: 'batch-1',
        package_id: 'pkg-1',
        barcode: 'PKG-001',
        dock_zone_id: 'zone-b7',
        scan_result: 'wrong_zone',
        scanned_by: 'user-1',
      }),
    );
  });

  it('keeps the raw scanned code recoverable in barcode, with dock_zone_id null, when it matches no known zone', async () => {
    await recordQuickSortException({
      operatorId: 'op-1',
      batchId: 'batch-1',
      packageId: 'pkg-1',
      packageLabel: 'PKG-001',
      rejectedCode: 'GARBLED-9',
      zones,
      userId: 'user-1',
    });

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        barcode: 'GARBLED-9',
        dock_zone_id: null,
      }),
    );
  });

  it('throws when PostgREST returns an error object instead of throwing itself', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'permission denied' } });
    await expect(
      recordQuickSortException({
        operatorId: 'op-1',
        batchId: 'batch-1',
        packageId: 'pkg-1',
        packageLabel: 'PKG-001',
        rejectedCode: 'B7',
        zones,
        userId: 'user-1',
      }),
    ).rejects.toEqual({ message: 'permission denied' });
  });
});
