"use client";

import { useState } from 'react';
import { DrillDownPanel } from '../DrillDownPanel';
import { useStageBreakdown } from '@/hooks/ops-control/useStageBreakdown';
import type { StagePanelProps } from './PickupPanel';

const TH: React.CSSProperties = {
  padding: '6px 12px',
  textAlign: 'left',
  fontFamily: 'var(--font-sans)',
  color: 'var(--color-text-secondary)',
  fontWeight: 500,
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  borderBottom: '1px solid var(--color-border)',
  whiteSpace: 'nowrap',
};

const TD: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  fontSize: '0.8rem',
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

const EMPTY_TD: React.CSSProperties = {
  ...TD,
  textAlign: 'center',
  color: 'var(--color-text-muted)',
  fontFamily: 'var(--font-sans)',
  padding: '24px',
};

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
    <DrillDownPanel
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
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={TH}>Lote</th>
              <th style={TH}>Recibido</th>
              <th style={TH}># Ítems</th>
              <th style={TH}>Antigüedad</th>
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
                <tr key={(row['batch_id'] as string) ?? i}>
                  <td style={{ ...TD, color: 'var(--color-status-info)', fontWeight: 600 }}>
                    {(row['batch_id'] as string) ?? '—'}
                  </td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['received_at'] as string) ?? '—'}
                  </td>
                  <td style={TD}>{String(row['item_count'] ?? '—')}</td>
                  <td style={TD}>
                    {row['dwell_minutes'] != null ? `${row['dwell_minutes']}m` : '—'}
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
