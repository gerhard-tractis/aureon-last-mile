"use client";

import { useState } from 'react';
import { DrillDownPanel } from '../DrillDownPanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';

export interface StagePanelProps {
  operatorId: string;
  lastSyncAt: Date | null;
}

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
    <DrillDownPanel
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
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={TH}>Retailer</th>
              <th style={TH}># Órdenes</th>
              <th style={TH}>Ventana</th>
              <th style={TH}>Espera</th>
              <th style={TH}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={EMPTY_TD}>
                  Sin elementos en esta etapa
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={(row['retailer'] as string) ?? i}>
                  <td style={{ ...TD, color: 'var(--md-cobalt)', fontWeight: 600 }}>
                    {(row['retailer'] as string) ?? '—'}
                  </td>
                  <td style={TD}>{String(row['order_count'] ?? row['orders'] ?? '—')}</td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['window'] as string) ?? '—'}
                  </td>
                  <td style={TD}>
                    {row['wait_minutes'] != null ? `${row['wait_minutes']}m` : '—'}
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
