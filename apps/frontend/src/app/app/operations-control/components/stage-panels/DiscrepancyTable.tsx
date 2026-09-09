'use client';

import { TH, TD, TD_MONO, TD_EMPTY, TR } from './tableStyles';
import { cn } from '@/lib/utils';
import type { DiscrepancyRow } from '@/hooks/ops-control/useDiscrepancies';
import { formatMinutes } from '../../lib/health';

/** "Recogida" for a pickup-source row, "Recepción" for a reception-source one — who closed what. */
const OPERATION_LABELS: Record<DiscrepancyRow['operation_type'], string> = {
  pickup: 'Recogida',
  reception: 'Recepción',
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
            <th className={TH}>Cerró</th>
            <th className={TH}>Abierta hace</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className={TD_EMPTY}>Sin discrepancias abiertas</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className={cn(TR)}>
                <td className={TD}>{row.order_number ?? '—'}</td>
                <td className={TD_MONO}>{row.package_label ?? '—'}</td>
                <td className={TD_MONO}>{row.carga ?? '—'}</td>
                <td className={TD_MONO}>{row.ruta ?? '—'}</td>
                <td className={TD}>{OPERATION_LABELS[row.operation_type]}</td>
                <td className={TD}>{row.closed_by_name ?? '—'}</td>
                <td className={TD_MONO}>{openSince(row.detected_at, now)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** KPIs for the panel header — count only, same shape as computeOrderKpis. */
export function computeDiscrepancyKpis(rows: DiscrepancyRow[]) {
  const pickup = rows.filter((r) => r.operation_type === 'pickup').length;
  const reception = rows.filter((r) => r.operation_type === 'reception').length;
  return [
    { label: 'Abiertas', value: String(rows.length) },
    { label: 'De recogida', value: String(pickup) },
    { label: 'De recepción', value: String(reception) },
  ];
}
