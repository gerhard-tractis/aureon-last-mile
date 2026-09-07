import { describe, it, expect } from 'vitest';
import {
  ORDER_AUDIT_RESOURCE_TYPES,
  changedFields,
  decodeAuditEntry,
  meaningfulAuditEntries,
  type AuditEntrySource,
} from './audit-decoder';

function entry(overrides: Partial<AuditEntrySource> = {}): AuditEntrySource {
  return {
    action: 'UPDATE_orders',
    changes_json: null,
    ...overrides,
  };
}

function transition(before: Record<string, unknown>, after: Record<string, unknown>) {
  return { before, after };
}

describe('ORDER_AUDIT_RESOURCE_TYPES', () => {
  // The bug this whole module exists for: the DB trigger writes
  // `resource_type = TG_TABLE_NAME` ('orders'), the bulk importer writes
  // 'order'. Reading only one of the two spellings returns nothing.
  it('covers both the trigger spelling and the importer spelling', () => {
    expect(ORDER_AUDIT_RESOURCE_TYPES).toContain('orders');
    expect(ORDER_AUDIT_RESOURCE_TYPES).toContain('order');
  });
});

describe('changedFields', () => {
  it('lists only the keys whose value actually differs', () => {
    const changes = transition(
      { status: 'ingresado', comuna: 'Ñuñoa', updated_at: 'a' },
      { status: 'verificado', comuna: 'Ñuñoa', updated_at: 'b' },
    );
    expect(changedFields(changes)).toEqual(['status', 'updated_at']);
  });

  it('reports a field added by the update as changed', () => {
    const changes = transition({ status: 'ingresado' }, { status: 'ingresado', comuna: 'Ñuñoa' });
    expect(changedFields(changes)).toEqual(['comuna']);
  });

  it('compares nested values structurally rather than by reference', () => {
    const changes = transition({ meta: { a: 1 } }, { meta: { a: 1 } });
    expect(changedFields(changes)).toEqual([]);
  });

  it('detects a nested value that really did change', () => {
    const changes = transition({ meta: { a: 1 } }, { meta: { a: 2 } });
    expect(changedFields(changes)).toEqual(['meta']);
  });

  it('returns the inserted row keys for an INSERT payload that has no before', () => {
    expect(changedFields({ after: { status: 'ingresado' } })).toEqual(['status']);
  });

  it('returns nothing for a null payload rather than throwing', () => {
    expect(changedFields(null)).toEqual([]);
  });

  it('returns nothing for the truncated-payload marker the trigger writes past 10KB', () => {
    expect(changedFields({ truncated: true, size_bytes: 20000 })).toEqual([]);
  });
});

describe('decodeAuditEntry — meaningfulness', () => {
  // Verified against Musan QA: of the 18 audit rows on a verificado order,
  // 14 changed nothing but updated_at/status_updated_at. Those carry no
  // forensic value and would bury the 2 rows that do.
  it('marks a row that changed only updated_at as not meaningful', () => {
    const decoded = decodeAuditEntry(
      entry({ changes_json: transition({ updated_at: 'a' }, { updated_at: 'b' }) }),
    );
    expect(decoded.isMeaningful).toBe(false);
  });

  it('marks a row that changed only the two timestamp columns as not meaningful', () => {
    const decoded = decodeAuditEntry(
      entry({
        changes_json: transition(
          { updated_at: 'a', status_updated_at: 'a' },
          { updated_at: 'b', status_updated_at: 'b' },
        ),
      }),
    );
    expect(decoded.isMeaningful).toBe(false);
  });

  it('marks an empty diff as not meaningful', () => {
    const decoded = decodeAuditEntry(entry({ changes_json: transition({ status: 'x' }, { status: 'x' }) }));
    expect(decoded.isMeaningful).toBe(false);
  });

  it('marks a real status change as meaningful even though timestamps moved too', () => {
    const decoded = decodeAuditEntry(
      entry({
        changes_json: transition(
          { status: 'ingresado', updated_at: 'a', status_updated_at: 'a' },
          { status: 'verificado', updated_at: 'b', status_updated_at: 'b' },
        ),
      }),
    );
    expect(decoded.isMeaningful).toBe(true);
  });

  it('treats an INSERT as meaningful even when its payload is unreadable', () => {
    const decoded = decodeAuditEntry(entry({ action: 'INSERT_orders', changes_json: null }));
    expect(decoded.isMeaningful).toBe(true);
  });

  it('treats a DELETE as meaningful', () => {
    const decoded = decodeAuditEntry(entry({ action: 'DELETE_orders', changes_json: null }));
    expect(decoded.isMeaningful).toBe(true);
  });

  // Application-written rows ('CSV_IMPORT', 'ORDER_ASSIGNED_TO_ROUTE') carry
  // a free-form detail payload with no before/after to diff. They exist
  // because someone decided the event mattered — never drop them.
  it('keeps an application-written action even though its payload has no diff', () => {
    const decoded = decodeAuditEntry(
      entry({ action: 'CSV_IMPORT', changes_json: { rows_imported: 3 } }),
    );
    expect(decoded.isMeaningful).toBe(true);
  });

  it('drops only the trigger-written rows that changed nothing', () => {
    expect(decodeAuditEntry(entry({ action: 'UPDATE_orders', changes_json: null })).isMeaningful).toBe(false);
    expect(decodeAuditEntry(entry({ action: 'CSV_IMPORT', changes_json: null })).isMeaningful).toBe(true);
  });

  it('keeps a row whose payload was truncated — the change was real, only the diff is missing', () => {
    const decoded = decodeAuditEntry(
      entry({ changes_json: { truncated: true, size_bytes: 20000 } }),
    );
    expect(decoded.isMeaningful).toBe(true);
  });
});

describe('decodeAuditEntry — title', () => {
  it('names the status transition in Spanish instead of showing UPDATE_orders', () => {
    const decoded = decodeAuditEntry(
      entry({ changes_json: transition({ status: 'ingresado' }, { status: 'verificado' }) }),
    );
    expect(decoded.title).toBe('Estado: Ingresado → Verificado');
  });

  it('falls back to the raw status value when it has no known label', () => {
    const decoded = decodeAuditEntry(
      entry({ changes_json: transition({ status: 'ingresado' }, { status: 'zzz_nuevo' }) }),
    );
    expect(decoded.title).toBe('Estado: Ingresado → zzz_nuevo');
  });

  it('labels cancelado, which is not a pipeline stage', () => {
    const decoded = decodeAuditEntry(
      entry({ changes_json: transition({ status: 'ingresado' }, { status: 'cancelado' }) }),
    );
    expect(decoded.title).toBe('Estado: Ingresado → Cancelada');
  });

  it('names a leading_status change distinctly from a status change', () => {
    const decoded = decodeAuditEntry(
      entry({ changes_json: transition({ leading_status: 'ingresado' }, { leading_status: 'verificado' }) }),
    );
    expect(decoded.title).toBe('Estado principal: Ingresado → Verificado');
  });

  it('prefers the status transition when status and leading_status both moved', () => {
    const decoded = decodeAuditEntry(
      entry({
        changes_json: transition(
          { status: 'ingresado', leading_status: 'ingresado' },
          { status: 'verificado', leading_status: 'verificado' },
        ),
      }),
    );
    expect(decoded.title).toBe('Estado: Ingresado → Verificado');
  });

  it('titles an INSERT as the order being created', () => {
    const decoded = decodeAuditEntry(
      entry({ action: 'INSERT_orders', changes_json: { after: { status: 'ingresado' } } }),
    );
    expect(decoded.title).toBe('Pedido creado');
  });

  it('titles a DELETE as the order being removed', () => {
    const decoded = decodeAuditEntry(entry({ action: 'DELETE_orders', changes_json: null }));
    expect(decoded.title).toBe('Pedido eliminado');
  });

  it('names the changed fields for a non-status update', () => {
    const decoded = decodeAuditEntry(
      entry({ changes_json: transition({ comuna: 'Ñuñoa' }, { comuna: 'Providencia' }) }),
    );
    expect(decoded.title).toBe('Actualización: comuna');
  });

  it('omits the timestamp churn from a non-status update title', () => {
    const decoded = decodeAuditEntry(
      entry({
        changes_json: transition(
          { comuna: 'Ñuñoa', updated_at: 'a' },
          { comuna: 'Providencia', updated_at: 'b' },
        ),
      }),
    );
    expect(decoded.title).toBe('Actualización: comuna');
  });

  it('falls back to a generic title when the payload says nothing usable', () => {
    const decoded = decodeAuditEntry(entry({ changes_json: null }));
    expect(decoded.title).toBe('Actualización');
  });

  it('keeps a non-order action string readable rather than inventing a transition', () => {
    const decoded = decodeAuditEntry(entry({ action: 'order_imported', changes_json: null }));
    expect(decoded.title).toBe('order_imported');
  });
});

describe('meaningfulAuditEntries', () => {
  it('drops the housekeeping-only rows and keeps the real ones', () => {
    const rows = [
      entry({ changes_json: transition({ updated_at: 'a' }, { updated_at: 'b' }) }),
      entry({ changes_json: transition({ status: 'ingresado' }, { status: 'verificado' }) }),
      entry({ action: 'INSERT_orders', changes_json: { after: { status: 'ingresado' } } }),
    ];
    const kept = meaningfulAuditEntries(rows);
    expect(kept).toHaveLength(2);
    expect(kept.map((r) => r.action)).toEqual(['UPDATE_orders', 'INSERT_orders']);
  });

  it('preserves the objects it keeps rather than reshaping them', () => {
    const row = entry({ changes_json: transition({ status: 'a' }, { status: 'b' }) });
    expect(meaningfulAuditEntries([row])[0]).toBe(row);
  });

  it('returns an empty list when every row is housekeeping', () => {
    expect(meaningfulAuditEntries([entry({ changes_json: null })])).toEqual([]);
  });
});
