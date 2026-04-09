"use client";

import { useState } from 'react';
import { DrillDownPanel } from '../DrillDownPanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import type { StagePanelProps } from './PickupPanel';

const TH: React.CSSProperties = {
  padding: '6px 12px',
  textAlign: 'left',
  fontFamily: 'var(--font-sans)',
  color: 'var(--md-dim)',
  fontWeight: 500,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  borderBottom: '1px solid var(--md-hairline)',
  whiteSpace: 'nowrap',
};

const TD: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--md-hairline)',
  color: 'var(--md-text)',
  fontSize: '0.8rem',
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

const EMPTY_TD: React.CSSProperties = {
  ...TD,
  textAlign: 'center',
  color: 'var(--md-dimmer)',
  fontFamily: 'var(--font-sans)',
  padding: '24px',
};

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
    <DrillDownPanel
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
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={TH}>Ruta</th>
              <th style={TH}>Conductor</th>
              <th style={TH}>Progreso</th>
              <th style={TH}>Entregadas / total</th>
              <th style={TH}>Próx. parada</th>
              <th style={TH}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={EMPTY_TD}>
                  Sin elementos en esta etapa
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={(row['route_id'] as string) ?? i}>
                  <td style={{ ...TD, color: 'var(--md-cobalt)', fontWeight: 600 }}>
                    {(row['route_id'] as string) ?? '—'}
                  </td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['driver'] as string) ?? '—'}
                  </td>
                  <td style={TD}>
                    {row['progress_pct'] != null ? `${row['progress_pct']}%` : '—'}
                  </td>
                  <td style={TD}>
                    {row['delivered_count'] != null && row['total_count'] != null
                      ? `${row['delivered_count']} / ${row['total_count']}`
                      : '—'}
                  </td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['next_stop'] as string) ?? '—'}
                  </td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['status'] as string) ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </DrillDownPanel>
  );
}
