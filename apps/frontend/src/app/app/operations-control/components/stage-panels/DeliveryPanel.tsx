"use client";

import { useState } from 'react';
import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { TH, TD, TD_MONO, TD_LINK, TD_EMPTY, TR } from './tableStyles';
import type { StagePanelProps } from './PickupPanel';

export function DeliveryPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const [page, setPage] = useState(1);
  const { rows, pageCount } = useStageBreakdown('delivery', operatorId, page);

  const rutasActivas = rows.filter((r) => r['status'] === 'active').length;
  const enTiempo = rows.filter((r) => !r['behind_plan_minutes'] || (r['behind_plan_minutes'] as number) <= 0).length;
  const atrasadas = rows.filter((r) => r['behind_plan_minutes'] && (r['behind_plan_minutes'] as number) > 0).length;
  const entregadasHoy = rows.reduce((s, r) => s + ((r['delivered_count'] as number) ?? 0), 0);

  const kpis = [
    { label: 'Rutas activas', value: String(rutasActivas) },
    { label: 'En tiempo', value: String(enTiempo) },
    { label: 'Atrasadas', value: String(atrasadas) },
    { label: 'Entregadas hoy', value: String(entregadasHoy) },
  ];

  return (
    <StagePanel
      title="Reparto"
      subtitle="Rutas activas de reparto"
      deepLink="/app/dispatch?view=routes"
      deepLinkLabel="Abrir Rutas →"
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
              <th className={TH}>Ruta</th>
              <th className={TH}>Conductor</th>
              <th className={TH}>Progreso</th>
              <th className={TH}>Entregadas / total</th>
              <th className={TH}>Próx. parada</th>
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
                <tr key={(row['route_id'] as string) ?? i} className={TR}>
                  <td className={TD_LINK}>
                    {(row['route_id'] as string) ?? '—'}
                  </td>
                  <td className={TD}>
                    {(row['driver'] as string) ?? '—'}
                  </td>
                  <td className={TD_MONO}>
                    {row['progress_pct'] != null ? `${row['progress_pct']}%` : '—'}
                  </td>
                  <td className={TD_MONO}>
                    {row['delivered_count'] != null && row['total_count'] != null
                      ? `${row['delivered_count']} / ${row['total_count']}`
                      : '—'}
                  </td>
                  <td className={TD}>
                    {(row['next_stop'] as string) ?? '—'}
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
