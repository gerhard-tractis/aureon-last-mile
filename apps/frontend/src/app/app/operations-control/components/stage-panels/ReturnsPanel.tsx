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

export function ReturnsPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const [page, setPage] = useState(1);
  const { rows, pageCount } = useStageBreakdown('returns', operatorId, page);

  const pendientes = rows.length;
  const porRetailer = new Set(rows.map((r) => r['retailer'])).size;
  const maxAge = rows.length > 0
    ? `${Math.max(...rows.map((r) => (r['age_minutes'] as number) ?? 0))}m`
    : '—';
  const proxCorte = rows.length > 0 ? (rows[0]['sla_deadline'] as string | undefined) ?? '—' : '—';

  const kpis = [
    { label: 'Pendientes', value: String(pendientes) },
    { label: 'Por retailer', value: String(porRetailer) },
    { label: 'Antigüedad máx', value: maxAge },
    { label: 'Próx. corte SLA', value: proxCorte },
  ];

  return (
    <DrillDownPanel
      title="Devoluciones"
      subtitle="Devoluciones agrupadas por retailer y razón"
      deepLink={null}
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
              <th style={TH}>Pedido</th>
              <th style={TH}>Razón</th>
              <th style={TH}>Antigüedad</th>
              <th style={TH}>SLA</th>
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
                <tr key={(row['order_id'] as string) ?? i}>
                  <td style={{ ...TD, color: 'var(--color-status-info)', fontWeight: 600 }}>
                    {(row['retailer'] as string) ?? '—'}
                  </td>
                  <td style={TD}>{(row['order_id'] as string) ?? '—'}</td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['reason'] as string) ?? '—'}
                  </td>
                  <td style={TD}>
                    {row['age_minutes'] != null ? `${row['age_minutes']}m` : '—'}
                  </td>
                  <td style={{ ...TD, fontFamily: 'var(--font-sans)' }}>
                    {(row['sla_deadline'] as string) ?? '—'}
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
