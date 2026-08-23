'use client';

/**
 * OrderViewTabs — the seven fixed Pedidos preset tabs (spec-65, mock `3a`).
 *
 * The preset list itself comes from `ORDER_VIEW_PRESETS` (Task 4) — this
 * component only renders it and reports which one was clicked. Per spec-65
 * Decision 2, presets are a fixed set with no persisted custom views, so
 * the mock's "+ Nueva vista" is deliberately not rendered here.
 *
 * Presentational: no fetching. The parent supplies each tab's result count
 * (or omits it while still loading) and owns which preset is active.
 */

import { cn } from '@/lib/utils';
import { ORDER_VIEW_PRESETS, type OrderViewPresetId } from '@/lib/orders/order-view-presets';

interface OrderViewTabsProps {
  activePreset: OrderViewPresetId;
  /** Result count per preset id. A missing key renders the tab with no count badge (e.g. still loading). */
  presetCounts: Partial<Record<OrderViewPresetId, number>>;
  onSelectPreset: (id: OrderViewPresetId) => void;
}

export function OrderViewTabs({ activePreset, presetCounts, onSelectPreset }: OrderViewTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Vistas de pedidos"
      className="flex items-center gap-0.5 border-b border-border px-6"
    >
      {ORDER_VIEW_PRESETS.map((preset) => {
        const isActive = preset.id === activePreset;
        const count = presetCounts[preset.id];

        return (
          <button
            key={preset.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelectPreset(preset.id)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs transition-colors',
              isActive
                ? 'border-accent font-semibold text-text'
                : 'border-transparent font-medium text-text-secondary hover:text-text',
            )}
          >
            {preset.label}
            {count !== undefined && (
              <span
                className={cn(
                  'rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold',
                  isActive ? 'text-text' : 'text-text-muted',
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
