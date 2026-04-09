"use client";

import type { AtRiskOrder } from '@/hooks/ops-control/useAtRiskOrders';
import { STATUS_LABELS } from '@/app/app/operations-control/lib/labels.es';

export interface AtRiskListProps {
  orders: AtRiskOrder[];
  total: number;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

const TH_STYLE: React.CSSProperties = {
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

const TD_STYLE: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  fontSize: '0.8rem',
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

export function AtRiskList({ orders, page, pageCount, onPageChange }: AtRiskListProps) {
  const showPagination = pageCount > 1;

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={TH_STYLE}>Pedido</th>
              <th style={TH_STYLE}>Cliente</th>
              <th style={TH_STYLE}>Dirección</th>
              <th style={TH_STYLE}>Etapa</th>
              <th style={TH_STYLE}>Retailer</th>
              <th style={TH_STYLE}>Tiempo</th>
              <th style={TH_STYLE}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    ...TD_STYLE,
                    textAlign: 'center',
                    color: 'var(--color-text-muted)',
                    fontFamily: 'var(--font-sans)',
                    padding: '24px',
                  }}
                >
                  Sin órdenes en riesgo
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} style={{ transition: 'background 0.1s' }}>
                  <td style={{ ...TD_STYLE, color: 'var(--color-status-info)', fontWeight: 600 }}>
                    {order.id}
                  </td>
                  <td style={{ ...TD_STYLE, fontFamily: 'var(--font-sans)' }}>
                    {order.customer}
                  </td>
                  <td
                    style={{
                      ...TD_STYLE,
                      fontFamily: 'var(--font-sans)',
                      maxWidth: '200px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {order.address}
                  </td>
                  <td style={{ ...TD_STYLE, fontFamily: 'var(--font-sans)' }}>
                    {order.stage}
                  </td>
                  <td style={{ ...TD_STYLE, fontFamily: 'var(--font-sans)' }}>
                    {order.retailer}
                  </td>
                  <td
                    style={{
                      ...TD_STYLE,
                      color:
                        order.status === 'late'
                          ? 'var(--color-status-error)'
                          : 'var(--color-status-warning)',
                    }}
                  >
                    {order.label}
                  </td>
                  <td style={{ ...TD_STYLE, fontFamily: 'var(--font-sans)' }}>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showPagination && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '8px 12px',
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
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              color: page <= 1 ? 'var(--color-text-muted)' : 'var(--color-text)',
              padding: '3px 10px',
              borderRadius: '3px',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
            }}
          >
            Anterior
          </button>

          <span>
            Página {page} de {pageCount}
          </span>

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              color: page >= pageCount ? 'var(--color-text-muted)' : 'var(--color-text)',
              padding: '3px 10px',
              borderRadius: '3px',
              cursor: page >= pageCount ? 'not-allowed' : 'pointer',
              fontSize: '0.75rem',
            }}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
