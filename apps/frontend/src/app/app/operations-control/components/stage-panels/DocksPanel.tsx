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
    <DrillDownPanel
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
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={TH}>Ruta</th>
              <th style={TH}>Andén</th>
              <th style={TH}>Conductor</th>
              <th style={TH}>Órdenes</th>
              <th style={TH}>Dwell</th>
              <th style={TH}>Estado</th>
              <th style={TH}>Ventana</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={EMPTY_TD}>
                  Sin elementos en esta etapa
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={(row['route_id'] as string) ?? i}>
                  <td style={{ ...TD, color: 'var(--md-cobalt)', fontWeight: 600 }}>
                    {(row['route_id'] as string) ?? '—'}
                  </td>
                  <td style={TD}>{(row['dock'] as string) ?? '—'}</td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['driver'] as string) ?? '—'}
                  </td>
                  <td style={TD}>{String(row['order_count'] ?? '—')}</td>
                  <td style={TD}>
                    {row['dwell_minutes'] != null ? `${row['dwell_minutes']}m` : '—'}
                  </td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['status'] as string) ?? '—'}
                  </td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['window'] as string) ?? '—'}
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
