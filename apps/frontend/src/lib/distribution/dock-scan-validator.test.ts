import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateDockScan, validateDockDestination } from './dock-scan-validator';
import type { DockZone } from './sectorization-engine';

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

const mockLimit = vi.fn();
const mockSingle = vi.fn();
const mockIs = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

const mockSupabase = {
  from: mockFrom,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default chain setup
  mockFrom.mockReturnValue({ select: mockSelect });
  mockSelect.mockReturnValue({ eq: mockEq });
  mockEq.mockReturnValue({ eq: mockEq, is: mockIs, in: mockIn, limit: mockLimit });
  mockIs.mockReturnValue({ eq: mockEq, limit: mockLimit });
  mockIn.mockReturnValue({ is: mockIs, limit: mockLimit });
  mockLimit.mockResolvedValue({ data: [], error: null });
});

describe('validateDockScan', () => {
  it('rejects when barcode not found in system', async () => {
    // No duplicate, no package found
    mockLimit
      .mockResolvedValueOnce({ data: [], error: null }) // duplicate check
      .mockResolvedValueOnce({ data: [], error: null }); // package lookup

    const result = await validateDockScan({
      barcode: 'UNKNOWN-123',
      batchId: 'batch-1',
      targetZoneId: 'zone-1',
      operatorId: 'op-1',
      mode: 'batch',
    });

    expect(result.scanResult).toBe('rejected');
    expect(result.message).toContain('no encontrado');
  });

  it('rejects duplicate scan in same batch', async () => {
    // Duplicate found
    mockLimit.mockResolvedValueOnce({ data: [{ id: 'existing-scan' }], error: null });

    const result = await validateDockScan({
      barcode: 'PKG-001',
      batchId: 'batch-1',
      targetZoneId: 'zone-1',
      operatorId: 'op-1',
      mode: 'batch',
    });

    expect(result.scanResult).toBe('rejected');
    expect(result.message).toContain('ya escaneado');
  });

  it('rejects package not in en_bodega or sectorizado status', async () => {
    mockLimit
      .mockResolvedValueOnce({ data: [], error: null }) // no duplicate
      .mockResolvedValueOnce({
        data: [{ id: 'pkg-1', label: 'PKG-001', status: 'verificado', order_id: 'ord-1', dock_zone_id: null }],
        error: null,
      });

    const result = await validateDockScan({
      barcode: 'PKG-001',
      batchId: 'batch-1',
      targetZoneId: 'zone-1',
      operatorId: 'op-1',
      mode: 'batch',
    });

    expect(result.scanResult).toBe('rejected');
    expect(result.message).toContain('no está en bodega');
  });

  it('accepts valid en_bodega package in batch mode', async () => {
    mockLimit
      .mockResolvedValueOnce({ data: [], error: null }) // no duplicate
      .mockResolvedValueOnce({
        data: [{ id: 'pkg-1', label: 'PKG-001', status: 'en_bodega', order_id: 'ord-1', dock_zone_id: null }],
        error: null,
      });

    const result = await validateDockScan({
      barcode: 'PKG-001',
      batchId: 'batch-1',
      targetZoneId: 'zone-1',
      operatorId: 'op-1',
      mode: 'batch',
    });

    expect(result.scanResult).toBe('accepted');
    expect(result.packageId).toBe('pkg-1');
  });
});

describe('validateDockDestination', () => {
  const consolidationZone: DockZone = {
    id: 'zone-consol',
    name: 'Consolidación',
    code: 'CONS',
    is_consolidation: true,
    is_active: true,
    comunas: [],
  };
  const andenA: DockZone = {
    id: 'zone-a',
    name: 'Andén A',
    code: 'A1',
    is_consolidation: false,
    is_active: true,
    comunas: [],
  };
  const andenB: DockZone = {
    id: 'zone-b',
    name: 'Andén B',
    code: 'B1',
    is_consolidation: false,
    is_active: true,
    comunas: [],
  };
  const zones: DockZone[] = [andenA, andenB, consolidationZone];

  it('returns accepted_suggested when scanned code matches the suggested zone (case-insensitive)', () => {
    const result = validateDockDestination('a1', { suggestedZoneCode: 'A1', zones });
    expect(result).toEqual({ kind: 'accepted_suggested' });
  });

  it('returns accepted_consolidation with zone id when scanning the consolidación code', () => {
    const result = validateDockDestination('CONS', { suggestedZoneCode: 'A1', zones });
    expect(result).toEqual({ kind: 'accepted_consolidation', zoneId: 'zone-consol' });
  });

  it('returns rejected_wrong_dock with the expected code when scanning a different active dock', () => {
    const result = validateDockDestination('B1', { suggestedZoneCode: 'A1', zones });
    expect(result).toEqual({ kind: 'rejected_wrong_dock', expectedCode: 'A1' });
  });

  it('returns rejected_wrong_dock for an unknown / non-matching code', () => {
    const result = validateDockDestination('ZZZ', { suggestedZoneCode: 'A1', zones });
    expect(result).toEqual({ kind: 'rejected_wrong_dock', expectedCode: 'A1' });
  });

  it('trims whitespace before comparing', () => {
    const result = validateDockDestination('  A1  ', { suggestedZoneCode: 'A1', zones });
    expect(result).toEqual({ kind: 'accepted_suggested' });
  });

  it('treats inactive zones as non-matching', () => {
    const inactiveZones: DockZone[] = [
      { ...andenB, is_active: false },
      consolidationZone,
    ];
    const result = validateDockDestination('B1', { suggestedZoneCode: 'A1', zones: inactiveZones });
    expect(result).toEqual({ kind: 'rejected_wrong_dock', expectedCode: 'A1' });
  });
});
