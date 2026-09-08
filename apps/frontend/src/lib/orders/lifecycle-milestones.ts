import type { AuditEntry } from '@/hooks/useOrderDetail';

/**
 * The order lifecycle ribbon's milestones, and where their timestamps come
 * from.
 *
 * WHY THIS REPLACED KEYWORD MATCHING. The ribbon used to find each
 * milestone by testing `audit_logs.action` against a keyword list —
 * "Recogida" looked for `pickup|recogida|verificado|verified`. But the
 * generic row trigger (`audit_trigger_func`) only ever writes three action
 * strings: `INSERT_orders`, `UPDATE_orders`, `DELETE_orders`. Exactly one
 * keyword could ever match — `insert_orders`, on "Importada" — so **every
 * order in the system showed "Importada" and stopped**, whatever its real
 * status. Reported from Musan QA: orders sitting at `verificado` still read
 * as importadas.
 *
 * The bug was invisible until the bitácora fix: `useOrderDetail` /
 * `useOrderDossier` filtered `resource_type = 'order'` while the trigger
 * writes `'orders'`, so `auditLogs` arrived empty and the ribbon rendered
 * every milestone as "future". Feeding it real rows is what made the
 * keyword matching's failure show up.
 *
 * The status transition an order actually made lives in
 * `changes_json.after.status`, never in `action`. That is what this reads.
 */
export interface Milestone {
  key: string;
  label: string;
  /** `order_status_enum` values that put the order at this milestone. */
  statuses: string[];
}

export const MILESTONES: Milestone[] = [
  // Creation, not a transition: an order is imported, it never moves *to*
  // `ingresado` from anything.
  { key: 'importada', label: 'Importada', statuses: [] },
  { key: 'recogida', label: 'Recogida', statuses: ['verificado'] },
  { key: 'recepcion', label: 'Recepción', statuses: ['en_bodega'] },
  // `sectorizado` / `retenido` are package-only states that
  // `recalculate_order_status` collapses back to `en_bodega`, so the andén
  // milestone is reached by the order-level statuses that follow it.
  { key: 'anden', label: 'Andén', statuses: ['asignado', 'en_carga', 'listo_para_despacho'] },
  { key: 'reparto', label: 'En reparto', statuses: ['en_ruta'] },
  { key: 'entregada', label: 'Entregada', statuses: ['entregado', 'parcialmente_entregado'] },
];

/**
 * Actions that mean "the order entered the system". The trigger's own
 * `INSERT_orders`, plus the importer's action for rows written before the
 * trigger existed. Matched case-insensitively as a substring, the one place
 * the old keyword behaviour is still correct.
 */
const CREATION_ACTION_KEYWORDS = ['insert_orders', 'csv_import', 'order_created'];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** The status this row moved the order INTO, or null if it moved none. */
function enteredStatus(entry: AuditEntry): string | null {
  const changes = entry.changes_json;
  if (!changes) return null;
  const after = asRecord(changes.after);
  const before = asRecord(changes.before);
  const next = after?.status;
  if (typeof next !== 'string') return null;
  // A row that rewrote the same status changed nothing worth a milestone.
  if (before && before.status === next) return null;
  return next;
}

function isCreation(entry: AuditEntry): boolean {
  const action = entry.action.toLowerCase();
  return CREATION_ACTION_KEYWORDS.some((kw) => action.includes(kw));
}

/**
 * One timestamp per milestone, in `MILESTONES` order; null where the order
 * has no evidence of reaching it. Latest wins, so an order that re-enters a
 * milestone (a return, a re-dispatch) shows when it was last there.
 */
export function milestoneTimestamps(auditLogs: AuditEntry[]): (string | null)[] {
  return MILESTONES.map((milestone) => {
    let latest: string | null = null;
    for (const log of auditLogs) {
      if (!log.timestamp) continue;
      const matches =
        milestone.key === 'importada'
          ? isCreation(log)
          : (() => {
              const entered = enteredStatus(log);
              return entered !== null && milestone.statuses.includes(entered);
            })();
      if (!matches) continue;
      if (!latest || log.timestamp > latest) latest = log.timestamp;
    }
    return latest;
  });
}
