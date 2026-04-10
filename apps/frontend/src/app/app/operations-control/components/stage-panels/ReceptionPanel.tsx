"use client";

import { useState } from 'react';
import { StagePanel } from '../StagePanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import { TH, TD, TD_MONO, TD_LINK, TD_EMPTY, TR } from './tableStyles';
import type { StagePanelProps } from './PickupPanel';

export function ReceptionPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const [page, setPage] = useState(1);
  const { rows, pageCount } = useStageBreakdown('reception', operatorId, page);

  const total = rows.length;
  const sinClasificar = rows.filter((r) => r['status'] === 'pending' || !r['status']).length;
  const maxAge = rows.length > 0
    ? `${Math.max(...rows.map((r) => (r['dwell_minutes'] as number) ?? 0))}m`
    : '—';
  const throughput = rows.length > 0
    ? `${rows.reduce((sum, r) => sum + ((r['item_count'] as number) ?? 0), 0)}/h`
    : '—';

  const kpis = [
    { label: 'Total', value: String(total) },
    { label: 'Sin clasificar', value: String(sinClasificar) },
    { label: 'Antigüedad máx', value: maxAge },
    { label: 'Throughput/h', value: throughput },
  ];

  return (
    <StagePanel
      title="Recepción"
      subtitle="Lotes recibidos ordenados por antigüedad"
      deepLink="/app/reception"
      deepLinkLabel="Abrir Recepción →"
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
              <th className={TH}>Lote</th>
              <th className={TH}>Recibido</th>
              <th className={TH}># Ítems</th>
              <th className={TH}>Antigüedad</th>
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
                <tr key={(row['batch_id'] as string) ?? i} className={TR}>
                  <td className={TD_LINK}>
                    {(row['batch_id'] as string) ?? '—'}
                  </td>
                  <td className={TD}>
                    {(row['received_at'] as string) ?? '—'}
                  </td>
                  <td className={TD_MONO}>{String(row['item_count'] ?? '—')}</td>
                  <td className={TD_MONO}>
                    {row['dwell_minutes'] != null ? `${row['dwell_minutes']}m` : '—'}
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
