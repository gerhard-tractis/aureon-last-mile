"use client";

import type { AtRiskOrder } from '@/hooks/ops-control/useAtRiskOrders';

export interface AtRiskBarProps {
  orders: AtRiskOrder[];
  total: number;
  onSelect: () => void;
}

const INLINE_LIMIT = 3;

export function AtRiskBar({ orders, total, onSelect }: AtRiskBarProps) {
  const visible = orders.slice(0, INLINE_LIMIT);
  const overflow = total - INLINE_LIMIT;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-4 py-2 text-xs text-left transition-opacity hover:opacity-90"
      style={{
        background: 'var(--md-crimson)',
        color: 'var(--md-text)',
        fontFamily: 'var(--font-mono)',
      }}
    >
      {/* Count badge */}
      <span
        className="font-bold text-sm tabular-nums"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {total}
      </span>

      <span style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'var(--font-sans)' }}>
        órdenes en riesgo
      </span>

      {/* Inline IDs */}
      <span className="flex items-center gap-2">
        {visible.map((o) => (
          <span
            key={o.id}
            className="px-1.5 py-0.5 rounded text-xs"
            style={{
              background: 'rgba(0,0,0,0.25)',
              color: 'var(--md-text)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {o.id}
          </span>
        ))}
      </span>

      {/* Overflow */}
      {overflow > 0 && (
        <span className="ml-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
          + {overflow} MÁS →
        </span>
      )}
    </button>
  );
}
