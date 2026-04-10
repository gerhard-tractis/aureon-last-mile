"use client";

import { useState } from 'react';
import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { TH, TD, TD_MONO, TD_LINK, TD_EMPTY, TR } from './tableStyles';
import type { StagePanelProps } from './PickupPanel';

export function ConsolidationPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const [page, setPage] = useState(1);
  const { rows, pageCount } = useStageBreakdown('consolidation', operatorId, page);

  const listas = rows.filter((r) => r['ready'] === true || r['status'] === 'ready').length;
  const docks = new Set(rows.map((r) => r['dest_dock'])).size;
  const maxAge = rows.length > 0
    ? `${Math.max(...rows.map((r) => (r['age_minutes'] as number) ?? 0))}m`
    : '—';
  const proxCorte = rows.length > 0 ? (rows[0]['next_cut'] as string | undefined) ?? '—' : '—';

  const kpis = [
    { label: 'Listas', value: String(listas) },
    { label: 'Andenes destino', value: String(docks) },
    { label: 'Antigüedad máx', value: maxAge },
    { label: 'Próx. corte', value: proxCorte },
  ];

  return (
    <StagePanel
      title="Consolidación"
      subtitle="Órdenes agrupadas por andén destino"
      deepLink="/app/distribution"
      deepLinkLabel="Abrir Distribución →"
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
              <th className={TH}>Andén destino</th>
              <th className={TH}># Órdenes</th>
              <th className={TH}>Listas desde</th>
              <th className={TH}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className={TD_EMPTY}>
                  Sin elementos en esta etapa
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={(row['dest_dock'] as string) ?? i} className={TR}>
                  <td className={TD_LINK}>
                    {(row['dest_dock'] as string) ?? '—'}
                  </td>
                  <td className={TD_MONO}>{String(row['order_count'] ?? '—')}</td>
                  <td className={TD}>
                    {(row['ready_since'] as string) ?? '—'}
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
