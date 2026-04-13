"use client";

import { useState } from 'react';
import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { TH, TD, TD_MONO, TD_LINK, TD_EMPTY, TR } from './tableStyles';

export interface StagePanelProps {
  operatorId: string;
  lastSyncAt: Date | null;
}

export function PickupPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const [page, setPage] = useState(1);
  const { rows, pageCount } = useStageBreakdown('pickup', operatorId, page);

  const pendientes = rows.length;
  const vencidas = rows.filter((r) => r['overdue_minutes'] && (r['overdue_minutes'] as number) > 0).length;
  const proxVentana = rows.length > 0 ? (rows[0]['window'] as string | undefined) ?? '—' : '—';
  const avgEspera = rows.length > 0
    ? `${Math.round(rows.reduce((sum, r) => sum + ((r['wait_minutes'] as number) ?? 0), 0) / rows.length)}m`
    : '—';

  const kpis = [
    { label: 'Pendientes', value: String(pendientes) },
    { label: 'Vencidas', value: String(vencidas) },
    { label: 'Próx. ventana', value: proxVentana },
    { label: 'Avg espera', value: avgEspera },
  ];

  return (
    <StagePanel
      title="Recogida"
      subtitle="Pickups agrupados por retailer"
      deepLink="/app/pickup"
      deepLinkLabel="Abrir Recogida →"
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
              <th className={TH}># Órdenes</th>
              <th className={TH}>Ventana</th>
              <th className={TH}>Espera</th>
              <th className={TH}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className={TD_EMPTY}>
                  Sin elementos en esta etapa
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={(row['retailer'] as string) ?? i} className={TR}>
                  <td className={TD_LINK}>
                    {(row['retailer'] as string) ?? '—'}
                  </td>
                  <td className={TD_MONO}>{String(row['order_count'] ?? row['orders'] ?? '—')}</td>
                  <td className={TD}>
                    {(row['window'] as string) ?? '—'}
                  </td>
                  <td className={TD_MONO}>
                    {row['wait_minutes'] != null ? `${row['wait_minutes']}m` : '—'}
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
