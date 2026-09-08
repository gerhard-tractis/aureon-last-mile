import { describe, it, expect } from 'vitest';
import { MILESTONES, milestoneTimestamps } from './lifecycle-milestones';
import type { AuditEntry } from '@/hooks/useOrderDetail';

function statusChange(after: string, timestamp: string, before = 'ingresado'): AuditEntry {
  return {
    id: `a-${after}-${timestamp}`,
    action: 'UPDATE_orders',
    timestamp,
    changes_json: { before: { status: before }, after: { status: after } },
  };
}

function created(timestamp: string): AuditEntry {
  return {
    id: 'a-insert',
    action: 'INSERT_orders',
    timestamp,
    changes_json: { after: { status: 'ingresado' } },
  };
}

function keys() {
  return MILESTONES.map((m) => m.key);
}

function at(logs: AuditEntry[], key: string): string | null {
  return milestoneTimestamps(logs)[keys().indexOf(key)];
}

describe('milestoneTimestamps — the bug this replaces', () => {
  // The trigger only ever writes INSERT_orders / UPDATE_orders / DELETE_orders.
  // Matching milestone keywords against `action` meant 'insert_orders' hit
  // "Importada" and NOTHING else ever matched, so every order in the system
  // showed "Importada" and stopped — whatever its real status.
  it('advances past Importada on a verification, which action-keyword matching never did', () => {
    const logs = [created('2026-09-07T15:13:48'), statusChange('verificado', '2026-09-07T17:11:58')];
    expect(at(logs, 'importada')).toBe('2026-09-07T15:13:48');
    expect(at(logs, 'recogida')).toBe('2026-09-07T17:11:58');
  });

  it('does not read the milestone off the action string', () => {
    // Same payload, an action string carrying no hint at all.
    const log: AuditEntry = {
      id: 'a1',
      action: 'UPDATE_orders',
      timestamp: '2026-09-07T17:11:58',
      changes_json: { before: { status: 'ingresado' }, after: { status: 'verificado' } },
    };
    expect(at([log], 'recogida')).toBe('2026-09-07T17:11:58');
  });
});

describe('milestoneTimestamps — mapping', () => {
  it.each([
    ['verificado', 'recogida'],
    ['en_bodega', 'recepcion'],
    ['asignado', 'anden'],
    ['en_carga', 'anden'],
    ['listo_para_despacho', 'anden'],
    ['en_ruta', 'reparto'],
    ['entregado', 'entregada'],
    ['parcialmente_entregado', 'entregada'],
  ])('maps order status %s to milestone %s', (status, milestone) => {
    const logs = [statusChange(status, '2026-09-07T12:00:00')];
    expect(at(logs, milestone)).toBe('2026-09-07T12:00:00');
  });

  it('marks Importada from the INSERT row', () => {
    expect(at([created('2026-09-07T15:13:48')], 'importada')).toBe('2026-09-07T15:13:48');
  });

  // Orders imported before the trigger existed, or via the CSV importer,
  // carry an application action instead of a status diff.
  it('still marks Importada from a CSV_IMPORT action', () => {
    const log: AuditEntry = {
      id: 'a1', action: 'CSV_IMPORT', timestamp: '2026-09-07T10:00:00',
      changes_json: { rows_imported: 3 },
    };
    expect(at([log], 'importada')).toBe('2026-09-07T10:00:00');
  });

  it('leaves a milestone the order never reached empty rather than guessing', () => {
    const logs = [created('2026-09-07T15:13:48'), statusChange('verificado', '2026-09-07T17:11:58')];
    expect(at(logs, 'recepcion')).toBeNull();
    expect(at(logs, 'reparto')).toBeNull();
    expect(at(logs, 'entregada')).toBeNull();
  });

  it('ignores a status that maps to no milestone', () => {
    const logs = [statusChange('cancelado', '2026-09-07T12:00:00')];
    expect(milestoneTimestamps(logs).every((t) => t === null)).toBe(true);
  });

  it('ignores a row where the status did not actually change', () => {
    const logs = [statusChange('verificado', '2026-09-07T12:00:00', 'verificado')];
    expect(at(logs, 'recogida')).toBeNull();
  });

  it('keeps the LATEST timestamp when an order re-enters a milestone', () => {
    const logs = [
      statusChange('en_ruta', '2026-09-07T09:00:00', 'listo_para_despacho'),
      statusChange('en_ruta', '2026-09-07T18:00:00', 'en_retorno'),
    ];
    expect(at(logs, 'reparto')).toBe('2026-09-07T18:00:00');
  });

  it('skips a row with no timestamp rather than throwing', () => {
    const log: AuditEntry = {
      id: 'a1', action: 'UPDATE_orders', timestamp: null,
      changes_json: { before: { status: 'ingresado' }, after: { status: 'verificado' } },
    };
    expect(at([log], 'recogida')).toBeNull();
  });

  it('survives a null payload', () => {
    const log: AuditEntry = { id: 'a1', action: 'UPDATE_orders', timestamp: '2026-09-07T12:00:00', changes_json: null };
    expect(milestoneTimestamps([log]).every((t) => t === null)).toBe(true);
  });
});
