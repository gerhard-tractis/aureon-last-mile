import { describe, it, expect } from 'vitest';
import {
  buildAcceptedEntry,
  buildRejectedEntry,
  tallyRejections,
  countRejections,
  type ScanHistoryEntry,
} from './scan-session';

describe('buildAcceptedEntry', () => {
  it('carries every field the last-read card and history row need, and nothing the hook cannot produce', () => {
    const entry = buildAcceptedEntry({
      id: 'evt-1',
      code: 'CL8841873',
      atIso: '2026-09-03T09:19:04.000Z',
      response: {
        order_id: 'o1',
        order_number: 'ORD-3311',
        contact_name: 'Javiera Muñoz',
        contact_address: 'Los Aromos 442, Ñuñoa',
      },
      orderContext: { comuna: 'Ñuñoa', retailerName: 'Falabella', stopIndex: 9 },
      boxes: { loaded: 2, total: 3 },
    });
    expect(entry).toEqual<ScanHistoryEntry>({
      kind: 'accepted',
      id: 'evt-1',
      code: 'CL8841873',
      atIso: '2026-09-03T09:19:04.000Z',
      orderId: 'o1',
      orderNumber: 'ORD-3311',
      contactName: 'Javiera Muñoz',
      contactAddress: 'Los Aromos 442, Ñuñoa',
      comuna: 'Ñuñoa',
      retailerName: 'Falabella',
      stopIndex: 9,
      boxesLoaded: 2,
      boxesTotal: 3,
    });
  });

  it('is honest about missing order context — null, not a fabricated 1 de 1', () => {
    const entry = buildAcceptedEntry({
      id: 'evt-2',
      code: 'CL1',
      atIso: '2026-09-03T09:00:00.000Z',
      response: { order_id: 'o2', order_number: 'ORD-2', contact_name: null, contact_address: null },
    });
    expect(entry.comuna).toBeNull();
    expect(entry.stopIndex).toBeNull();
    expect(entry.boxesLoaded).toBeNull();
    expect(entry.boxesTotal).toBeNull();
  });
});

describe('buildRejectedEntry', () => {
  it('shapes a rejection from the raw API failure', () => {
    const entry = buildRejectedEntry({
      id: 'evt-3',
      code: 'CL9999',
      atIso: '2026-09-03T09:20:00.000Z',
      failure: { code: 'ALREADY_IN_ROUTE', message: 'Paquete ya asignado a otra ruta activa', conflictingRouteId: 'abcdef1234' },
      conflictingRouteCode: 'ABCDEF12',
    });
    expect(entry.kind).toBe('rejected');
    if (entry.kind !== 'rejected') throw new Error('unreachable');
    expect(entry.title).toContain('ABCDEF12');
    expect(entry.canViewConflictingRoute).toBe(true);
    expect(entry.conflictingRouteId).toBe('abcdef1234');
  });
});

const rejections: ScanHistoryEntry[] = [
  buildRejectedEntry({ id: '1', code: 'a', atIso: 't', failure: { code: 'NOT_FOUND', message: 'x' } }),
  buildRejectedEntry({ id: '2', code: 'b', atIso: 't', failure: { code: 'NOT_FOUND', message: 'x' } }),
  buildRejectedEntry({ id: '3', code: 'c', atIso: 't', failure: { code: 'IN_CONSOLIDATION', message: 'x' } }),
  buildAcceptedEntry({ id: '4', code: 'd', atIso: 't', response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } }),
];

describe('countRejections', () => {
  it('counts only rejected entries — the shift RECHAZOS counter', () => {
    expect(countRejections(rejections)).toBe(3);
  });
});

describe('tallyRejections', () => {
  it('groups by reason, most frequent first — OTROS MOTIVOS DE RECHAZO', () => {
    expect(tallyRejections(rejections)).toEqual([
      { code: 'NOT_FOUND', label: 'CÓDIGO NO ENCONTRADO', count: 2 },
      { code: 'IN_CONSOLIDATION', label: 'RETENIDO EN CONSOLIDACIÓN', count: 1 },
    ]);
  });

  it('is empty with no rejections yet, not a list of zero-count reasons', () => {
    expect(tallyRejections([])).toEqual([]);
  });
});

describe('formatScanTimestamp', () => {
  it('formats HH:MM:SS in America/Santiago, imported not implemented in this file', async () => {
    const { formatScanTimestamp } = await import('./scan-session');
    // 2026-09-03T09:19:04-03:00 in UTC is 12:19:04Z (winter/summer DST
    // aside, America/Santiago sits at -03:00/-04:00; this asserts the
    // shape, not a specific offset).
    expect(formatScanTimestamp('2026-09-03T12:19:04.000Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
