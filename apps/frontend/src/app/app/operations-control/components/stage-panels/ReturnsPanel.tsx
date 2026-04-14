"use client";

import { useState } from 'react';
import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { TH, TD, TD_MONO, TD_LINK, TD_EMPTY, TR } from './tableStyles';
import type { StagePanelProps } from './PickupPanel';

export function ReturnsPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const [page, setPage] = useState(1);
  const { rows, pageCount } = useStageBreakdown('returns', operatorId, page);

  const pendientes = rows.length;
  const porRetailer = new Set(rows.map((r) => r['retailer'])).size;
  const maxAge = rows.length > 0
    ? `${Math.max(...rows.map((r) => (r['age_minutes'] as number) ?? 0))}m`
    : '—';
  const proxCorte = rows.length > 0 ? (rows[0]['sla_deadline'] as string | undefined) ?? '—' : '—';

  const kpis = [
    { label: 'Pendientes', value: String(pendientes) },
    { label: 'Por retailer', value: String(porRetailer) },
    { label: 'Antigüedad máx', value: maxAge },
    { label: 'Próx. corte SLA', value: proxCorte },
  ];

  return (
    <StagePanel
      title="Reingresos"
      subtitle="Reingresos agrupados por retailer y razón"
      deepLink={null}
      kpis={kpis}
      page={page}
      pageCount={Math.max(pageCount, 1)}
      onPageChange={setPage}
      lastSyncAt={lastSyncAt}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Retailer</th>
              <th className={TH}>Pedido</th>
              <th className={TH}>Razón</th>
              <th className={TH}>Antigüedad</th>
              <th className={TH}>SLA</th>
              <th className={TH}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className={TD_EMPTY}>
                  Sin elementos en esta etapa
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={(row['order_id'] as string) ?? i} className={TR}>
                  <td className={TD_LINK}>
                    {(row['retailer'] as string) ?? '—'}
                  </td>
                  <td className={TD_MONO}>{(row['order_id'] as string) ?? '—'}</td>
                  <td className={TD}>
                    {(row['reason'] as string) ?? '—'}
                  </td>
                  <td className={TD_MONO}>
                    {row['age_minutes'] != null ? `${row['age_minutes']}m` : '—'}
                  </td>
                  <td className={TD}>
                    {(row['sla_deadline'] as string) ?? '—'}
                  </td>
                  <td className={TD}>
                    {(row['status'] as string) ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </StagePanel>
  );
}
