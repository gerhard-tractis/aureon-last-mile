'use client';

import { TH, TD, TD_MONO, TD_EMPTY, TR } from './tableStyles';
import { cn } from '@/lib/utils';
import { totalDiscrepancyCount, type DiscrepancyRow } from '@/hooks/ops-control/useDiscrepancies';
import { formatMinutes } from '../../lib/health';

/** "Recogida" for a pickup-source row, "Recepción" for a reception-source one — who closed what. */
const OPERATION_LABELS: Record<DiscrepancyRow['operation_type'], string> = {
  pickup: 'Recogida',
  reception: 'Recepción',
};

/**
 * Ronda 3 (#715, M2): the default query is 'open' meaning status <>
 * 'resolved' (spec-86 fase 3, ronda 2 B1) — a 'lost' row sits right next to
 * an 'open' one under the same "Abiertas" label, with nothing distinguishing
 * a closed loss (declared by an operations_manager, already has a
 * resolution) from something Ops still has to act on. This column is what
 * makes that visible.
 */
const STATUS_LABELS: Record<DiscrepancyRow['status'], string> = {
  open: 'Abierta',
  lost: 'Perdida',
  resolved: 'Resuelta',
};

/** How long a discrepancy has been open, in the same coarse units the stage rail uses. */
function openSince(detectedAt: string, now: Date): string {
  const minutes = Math.max(0, (now.getTime() - new Date(detectedAt).getTime()) / 60_000);
  return formatMinutes(minutes);
}

export interface DiscrepancyTableProps {
  rows: DiscrepancyRow[];
  now?: Date;
}

export function DiscrepancyTable({ rows, now = new Date() }: DiscrepancyTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className={TH}>Orden</th>
            <th className={TH}>Paquete</th>
            <th className={TH}>Carga</th>
            <th className={TH}>Ruta</th>
            <th className={TH}>Etapa</th>
            <th className={TH}>Estado</th>
            <th className={TH}>Cerró</th>
            <th className={TH}>Abierta hace</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              {/* Ronda 3 (#715, M2): "abiertas" is no longer accurate on its
                  own -- the default query includes 'lost' too (spec-86 fase 3
                  ronda 2, B1). "Sin resolver" matches the tile's own wording. */}
              <td colSpan={8} className={TD_EMPTY}>Sin discrepancias sin resolver</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className={cn(TR)} data-testid={`discrepancy-row-${row.id}`}>
                <td className={TD}>{row.order_number ?? '—'}</td>
                <td className={TD_MONO}>{row.package_label ?? '—'}</td>
                <td className={TD_MONO}>{row.carga ?? '—'}</td>
                <td className={TD_MONO}>{row.ruta ?? '—'}</td>
                <td className={TD} data-testid={`discrepancy-stage-${row.id}`}>{OPERATION_LABELS[row.operation_type]}</td>
                <td className={TD} data-testid={`discrepancy-status-${row.id}`}>{STATUS_LABELS[row.status]}</td>
                <td className={TD}>{row.closed_by_name ?? '—'}</td>
                <td className={TD_MONO} data-testid={`discrepancy-since-${row.id}`}>{openSince(row.detected_at, now)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * KPIs for the panel header. Ronda 3 (#715, M2/M3): 'Abiertas' renamed to
 * 'Sin resolver' (the set now includes 'lost', not just literally 'open' —
 * see the STATUS_LABELS comment above), and a 4th slot surfaces LIMIT 500
 * truncation (M3) instead of hiding it — 'Mostradas' equals 'Sin resolver'
 * except when the RPC's total_count says otherwise.
 *
 * Ronda 3 seguimiento (#715, anotado, no arreglado): under truncation the
 * four KPIs mix denominators on purpose, and it is worth naming so nobody
 * "fixes" it into something worse. 'Sin resolver' reads total_count — the
 * real count BEFORE the RPC's LIMIT 500 (see 20260930000001's comment on the
 * SQL side for why that is a genuine cost tradeoff, not free). 'De recogida'
 * / 'De recepción' are computed over `rows` — the rows actually RECEIVED,
 * i.e. AFTER the LIMIT. So "Sin resolver 617" next to "De recogida 250" + "De
 * recepción 250" = 500, not 617, is expected, not a bug: the 4th KPI
 * ('Mostradas: 500 de 617') sits right next to them and says why. This is
 * the benign version of the ronda-1 sin — two numbers that do not add up on
 * the same screen — benign specifically because the mismatch is explained in
 * place, not silent.
 */
export function computeDiscrepancyKpis(rows: DiscrepancyRow[]) {
  const pickup = rows.filter((r) => r.operation_type === 'pickup').length;
  const reception = rows.filter((r) => r.operation_type === 'reception').length;
  const total = totalDiscrepancyCount(rows);
  const kpis = [
    { label: 'Sin resolver', value: String(total) },
    { label: 'De recogida', value: String(pickup) },
    { label: 'De recepción', value: String(reception) },
  ];
  if (total > rows.length) {
    kpis.push({ label: 'Mostradas', value: `${rows.length} de ${total}` });
  }
  return kpis;
}
