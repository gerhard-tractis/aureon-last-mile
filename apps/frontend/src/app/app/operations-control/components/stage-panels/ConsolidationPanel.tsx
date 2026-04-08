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
    <DrillDownPanel
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
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={TH}>Andén destino</th>
              <th style={TH}># Órdenes</th>
              <th style={TH}>Listas desde</th>
              <th style={TH}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} style={EMPTY_TD}>
                  Sin elementos en esta etapa
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={(row['dest_dock'] as string) ?? i}>
                  <td style={{ ...TD, color: 'var(--md-cobalt)', fontWeight: 600 }}>
                    {(row['dest_dock'] as string) ?? '—'}
                  </td>
                  <td style={TD}>{String(row['order_count'] ?? '—')}</td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['ready_since'] as string) ?? '—'}
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
