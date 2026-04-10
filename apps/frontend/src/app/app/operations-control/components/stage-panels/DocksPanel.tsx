"use client";

import { useState } from 'react';
import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { TH, TD, TD_MONO, TD_LINK, TD_EMPTY, TR } from './tableStyles';
import type { StagePanelProps } from './PickupPanel';

export function DocksPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const [page, setPage] = useState(1);
  const { rows, pageCount } = useStageBreakdown('docks', operatorId, page);

  const rutasListas = rows.filter((r) => r['status'] === 'ready').length;
  const avgDwell = rows.length > 0
    ? `${Math.round(rows.reduce((s, r) => s + ((r['dwell_minutes'] as number) ?? 0), 0) / rows.length)}m`
    : '—';
  const masAntigua = rows.length > 0
    ? `${Math.max(...rows.map((r) => (r['idle_minutes'] as number) ?? 0))}m`
    : '—';
  const ordenesEnAnden = rows.reduce((s, r) => s + ((r['order_count'] as number) ?? 0), 0);

  const kpis = [
    { label: 'Rutas listas', value: String(rutasListas) },
    { label: 'Avg dwell', value: avgDwell },
    { label: 'Más antigua inactiva', value: masAntigua },
    { label: 'Órdenes en andén', value: String(ordenesEnAnden) },
  ];

  return (
    <StagePanel
      title="Andenes"
      subtitle="Rutas agrupadas por andén"
      deepLink="/app/dispatch"
      deepLinkLabel="Abrir Despacho →"
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
              <th className={TH}>Andén</th>
              <th className={TH}>Conductor</th>
              <th className={TH}>Órdenes</th>
              <th className={TH}>Dwell</th>
              <th className={TH}>Estado</th>
              <th className={TH}>Ventana</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className={TD_EMPTY}>
                  Sin elementos en esta etapa
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={(row['route_id'] as string) ?? i} className={TR}>
                  <td className={TD_LINK}>
                    {(row['route_id'] as string) ?? '—'}
                  </td>
                  <td className={TD_MONO}>{(row['dock'] as string) ?? '—'}</td>
                  <td className={TD}>
                    {(row['driver'] as string) ?? '—'}
                  </td>
                  <td className={TD_MONO}>{String(row['order_count'] ?? '—')}</td>
                  <td className={TD_MONO}>
                    {row['dwell_minutes'] != null ? `${row['dwell_minutes']}m` : '—'}
                  </td>
                  <td className={TD}>
                    {(row['status'] as string) ?? '—'}
                  </td>
                  <td className={TD}>
                    {(row['window'] as string) ?? '—'}
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
