import { PIPELINE_STAGES } from '@/lib/types/pipeline';

/**
 * The bitácora's AUREON side reads `audit_logs`, and until this module
 * existed it read nothing at all: `useOrderDetail`/`useOrderDossier`
 * filtered `resource_type = 'order'` (singular), while the row writers use
 * two different spellings —
 *
 *   - `audit_trigger_func()` (the DB trigger behind `audit_orders_changes`)
 *     writes `resource_type = TG_TABLE_NAME`, i.e. **'orders'**;
 *   - `api/orders/bulk-import` writes **'order'**.
 *
 * The trigger is the one that records status transitions, so the singular
 * filter matched zero rows and every order's bitácora showed "Sin eventos
 * registrados" — confirmed on Musan QA, where `audit_logs` held 19,922
 * rows under 'orders' and 0 under 'order'. Both spellings are real and
 * both must be read; normalising the stored value instead would need a
 * backfill of live audit data, which is exactly the table you least want
 * to rewrite.
 */
export const ORDER_AUDIT_RESOURCE_TYPES = ['order', 'orders'] as const;

/**
 * Columns every `UPDATE orders` touches whether or not anything real
 * happened. On Musan QA, 14 of the 18 audit rows on a verificado order
 * differed in nothing else — they are the row-level trigger firing on
 * writes that changed no business field. They are not hidden from the
 * operator to tidy the view; they carry no information to hide.
 */
const HOUSEKEEPING_FIELDS = new Set(['updated_at', 'status_updated_at', 'created_at']);

/** `cancelado` is a real `order_status_enum` value but not a pipeline stage. */
const EXTRA_STATUS_LABELS: Record<string, string> = { cancelado: 'Cancelada' };

const STATUS_LABELS: Record<string, string> = {
  ...Object.fromEntries(PIPELINE_STAGES.map((s) => [s.status, s.label])),
  ...EXTRA_STATUS_LABELS,
};

export interface AuditEntrySource {
  action: string;
  changes_json: Record<string, unknown> | null;
}

export interface DecodedAuditEntry {
  /** Operator-facing row title — never the raw `UPDATE_orders`. */
  title: string;
  /** Business fields this row changed, housekeeping columns excluded. */
  changedFields: string[];
  /** False for rows that changed nothing an operator could act on. */
  isMeaningful: boolean;
}

function statusLabel(value: unknown): string {
  const raw = value === null || value === undefined ? '—' : String(value);
  return STATUS_LABELS[raw] ?? raw;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * Past 10KB the trigger replaces the whole diff with this marker, so there
 * is no before/after to compare — the change happened, we just can't say
 * what it was.
 */
function isTruncated(changes: Record<string, unknown> | null): boolean {
  return changes?.truncated === true;
}

/**
 * Structural comparison, not reference comparison: `before`/`after` are
 * `row_to_json` snapshots, so every nested object is a fresh instance and
 * `!==` would call every jsonb column changed on every row.
 */
function differs(before: unknown, after: unknown): boolean {
  if (before === after) return false;
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}

/**
 * Keys whose value the update actually altered. An INSERT payload has only
 * `after`, and every key in it counts as introduced by the insert.
 */
export function changedFields(changes: Record<string, unknown> | null): string[] {
  if (!changes || isTruncated(changes)) return [];
  const after = asRecord(changes.after);
  const before = asRecord(changes.before);
  if (!after) return before ? Object.keys(before) : [];
  return Object.keys(after).filter((key) => differs(before?.[key], after[key]));
}

function transitionTitle(
  changes: Record<string, unknown>,
  field: 'status' | 'leading_status',
  label: string,
): string | null {
  const after = asRecord(changes.after);
  const before = asRecord(changes.before);
  if (!after || !(field in after)) return null;
  return `${label}: ${statusLabel(before?.[field])} → ${statusLabel(after[field])}`;
}

export function decodeAuditEntry(entry: AuditEntrySource): DecodedAuditEntry {
  const changes = entry.changes_json;
  const fields = changedFields(changes);
  const business = fields.filter((f) => !HOUSEKEEPING_FIELDS.has(f));

  if (entry.action.startsWith('INSERT_')) {
    return { title: 'Pedido creado', changedFields: business, isMeaningful: true };
  }
  if (entry.action.startsWith('DELETE_')) {
    return { title: 'Pedido eliminado', changedFields: business, isMeaningful: true };
  }

  // A truncated payload is a real change we cannot describe — keep the row.
  if (isTruncated(changes)) {
    return { title: 'Actualización', changedFields: [], isMeaningful: true };
  }

  if (changes && business.includes('status')) {
    const title = transitionTitle(changes, 'status', 'Estado');
    if (title) return { title, changedFields: business, isMeaningful: true };
  }
  if (changes && business.includes('leading_status')) {
    const title = transitionTitle(changes, 'leading_status', 'Estado principal');
    if (title) return { title, changedFields: business, isMeaningful: true };
  }

  if (business.length > 0) {
    return {
      title: `Actualización: ${business.join(', ')}`,
      changedFields: business,
      isMeaningful: true,
    };
  }

  // No readable diff. Only the generic row trigger emits rows like this:
  // its action is TG_OP || '_' || TG_TABLE_NAME, and with no business field
  // changed the row records nothing. Anything else — 'CSV_IMPORT',
  // 'ORDER_ASSIGNED_TO_ROUTE' — was written deliberately by application
  // code precisely because it mattered, and its payload is a free-form
  // detail object with no before/after to diff. Those are always kept, and
  // their own action string is the best title we have.
  const isTriggerAction = /^(INSERT|UPDATE|DELETE)_/.test(entry.action);
  return {
    title: isTriggerAction ? 'Actualización' : entry.action,
    changedFields: [],
    isMeaningful: !isTriggerAction,
  };
}

/**
 * The rows worth showing an operator. Shared by `UnifiedEventLog` (which
 * renders them) and `FichaCenterColumn` (which counts them) so the "N
 * eventos" header can never disagree with the list underneath it.
 */
export function meaningfulAuditEntries<T extends AuditEntrySource>(entries: T[]): T[] {
  return entries.filter((entry) => decodeAuditEntry(entry).isMeaningful);
}
