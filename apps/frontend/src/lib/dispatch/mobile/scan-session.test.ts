import { describe, it, expect } from 'vitest';
import {
  buildAcceptedEntry,
  buildRejectedEntry,
  tallyRejections,
  countRejections,
  insertByAtIso,
  latestEntry,
  countAcceptedForOrder,
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
  buildRejectedEntry({ id: '1', code: 'a', atIso: '2026-09-03T09:00:00.000Z', failure: { code: 'NOT_FOUND', message: 'x' } }),
  buildRejectedEntry({ id: '2', code: 'b', atIso: '2026-09-03T09:00:00.000Z', failure: { code: 'NOT_FOUND', message: 'x' } }),
  buildRejectedEntry({ id: '3', code: 'c', atIso: '2026-09-03T09:00:00.000Z', failure: { code: 'IN_CONSOLIDATION', message: 'x' } }),
  buildAcceptedEntry({ id: '4', code: 'd', atIso: '2026-09-03T09:00:00.000Z', response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } }),
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

describe('insertByAtIso', () => {
  it('inserts newest-first — a later atIso goes to the front', () => {
    const a = buildAcceptedEntry({ id: 'a', code: 'A', atIso: '2026-09-03T09:00:00.000Z', response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } });
    const b = buildAcceptedEntry({ id: 'b', code: 'B', atIso: '2026-09-03T09:00:05.000Z', response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } });
    const result = insertByAtIso([a], b);
    expect(result.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('spec-76 review Important #2 — an OUT-OF-ORDER resolution (a slower earlier scan resolving after a faster later one) is inserted by atIso, not prepended blindly', () => {
    // B (started second, resolved first) is already in history; A (started
    // first, resolved second, so it arrives here LATER in wall-clock terms)
    // has an EARLIER atIso — it must land BEHIND b, not jump in front of it.
    const b = buildAcceptedEntry({ id: 'b', code: 'B', atIso: '2026-09-03T09:00:05.000Z', response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } });
    const a = buildAcceptedEntry({ id: 'a', code: 'A', atIso: '2026-09-03T09:00:00.000Z', response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } });
    const result = insertByAtIso([b], a);
    expect(result.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('inserts into the middle of a longer history at the right position', () => {
    const t = (s: string) => `2026-09-03T09:00:${s}.000Z`;
    const e3 = buildAcceptedEntry({ id: '3', code: 'C', atIso: t('03'), response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } });
    const e1 = buildAcceptedEntry({ id: '1', code: 'A', atIso: t('01'), response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } });
    const e2 = buildAcceptedEntry({ id: '2', code: 'B', atIso: t('02'), response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } });
    const result = insertByAtIso([e3, e1], e2);
    expect(result.map((e) => e.id)).toEqual(['3', '2', '1']);
  });
});

describe('latestEntry', () => {
  it('returns the entry with the greatest atIso, regardless of array order', () => {
    const early = buildAcceptedEntry({ id: 'early', code: 'A', atIso: '2026-09-03T09:00:00.000Z', response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } });
    const late = buildAcceptedEntry({ id: 'late', code: 'B', atIso: '2026-09-03T09:05:00.000Z', response: { order_id: 'o', order_number: 'n', contact_name: null, contact_address: null } });
    expect(latestEntry([late, early])?.id).toBe('late');
    expect(latestEntry([early, late])?.id).toBe('late');
  });

  it('returns null for an empty history', () => {
    expect(latestEntry([])).toBeNull();
  });
});

describe('countAcceptedForOrder', () => {
  it('counts only accepted entries for the given order_id', () => {
    const entries: ScanHistoryEntry[] = [
      buildAcceptedEntry({ id: '1', code: 'A', atIso: 't1', response: { order_id: 'o1', order_number: 'n', contact_name: null, contact_address: null } }),
      buildAcceptedEntry({ id: '2', code: 'B', atIso: 't2', response: { order_id: 'o2', order_number: 'n', contact_name: null, contact_address: null } }),
      buildRejectedEntry({ id: '3', code: 'C', atIso: 't3', failure: { code: 'NOT_FOUND', message: 'x' } }),
      buildAcceptedEntry({ id: '4', code: 'D', atIso: 't4', response: { order_id: 'o1', order_number: 'n', contact_name: null, contact_address: null } }),
    ];
    expect(countAcceptedForOrder(entries, 'o1')).toBe(2);
    expect(countAcceptedForOrder(entries, 'o2')).toBe(1);
    expect(countAcceptedForOrder(entries, 'o3')).toBe(0);
  });
});
