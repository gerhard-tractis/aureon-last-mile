"use client";

import type { ReactNode } from 'react';

export interface KpiSlot {
  label: string;
  value: string;
  trend?: string;
}

export interface DrillDownPanelProps {
  title: string;
  subtitle: string;
  deepLink: string | null;
  deepLinkLabel?: string;
  kpis: KpiSlot[];
  children: ReactNode;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  lastSyncAt: Date | null;
}

const PANEL: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: '4px',
  overflow: 'hidden',
};

const BTN: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--color-border)',
  borderRadius: '3px',
  color: 'var(--color-text)',
  padding: '4px 12px',
  fontSize: '0.75rem',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
};

const BTN_DISABLED: React.CSSProperties = {
  ...BTN,
  color: 'var(--color-text-muted)',
  cursor: 'not-allowed',
};

export function DrillDownPanel({
  title,
  subtitle,
  deepLink,
  deepLinkLabel = 'Abrir →',
  kpis,
  children,
  page,
  pageCount,
  onPageChange,
  lastSyncAt,
}: DrillDownPanelProps) {
  return (
    <div style={PANEL}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <h2
            data-testid="drilldown-title"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '1.1rem',
              fontWeight: 700,
              color: 'var(--color-text)',
              margin: 0,
            }}
          >
            {title}
          </h2>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '0.75rem',
              color: 'var(--color-text-secondary)',
              margin: 0,
            }}
          >
            {subtitle}
          </p>
        </div>

        {/* Deep link / Próximamente */}
        {deepLink !== null ? (
          <a
            href={deepLink}
            style={{
              ...BTN,
              textDecoration: 'none',
              display: 'inline-block',
              color: 'var(--color-status-info)',
              borderColor: 'var(--color-status-info)',
            }}
          >
            {deepLinkLabel}
          </a>
        ) : (
          <button type="button" disabled style={BTN_DISABLED}>
            Próximamente
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        {kpis.slice(0, 4).map((kpi) => (
          <div
            key={kpi.label}
            style={{
              padding: '12px 16px',
              borderRight: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '0.65rem',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {kpi.label}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1.4rem',
                fontWeight: 700,
                color: 'var(--color-text)',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}
            >
              {kpi.value}
              {kpi.trend && (
                <span style={{ fontSize: '0.8rem', marginLeft: '4px', color: 'var(--color-text-secondary)' }}>
                  {kpi.trend}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Table slot (children) */}
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>

      {/* Pagination */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 16px',
          borderTop: '1px solid var(--color-border)',
          fontFamily: 'var(--font-sans)',
          fontSize: '0.75rem',
          color: 'var(--color-text-secondary)',
        }}
      >
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          style={page <= 1 ? BTN_DISABLED : BTN}
        >
          Anterior
        </button>

        <span>Página {page} de {pageCount}</span>

        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pageCount}
          style={page >= pageCount ? BTN_DISABLED : BTN}
        >
          Siguiente
        </button>

        {/* Footer hint — pushed right */}
        <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)', fontSize: '0.7rem' }}>
          Tiempo real · Supabase Realtime
          {lastSyncAt && (
            <> · {lastSyncAt.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</>
          )}
        </span>
      </div>
    </div>
  );
}
