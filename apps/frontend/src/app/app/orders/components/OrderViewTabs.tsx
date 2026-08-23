'use client';

/**
 * OrderViewTabs — the seven fixed Pedidos preset tabs (spec-65, mock `3a`).
 *
 * The preset list itself comes from `ORDER_VIEW_PRESETS` (Task 4) — this
 * component only renders it and reports which one was clicked. Per spec-65
 * Decision 2, presets are a fixed set with no persisted custom views, so
 * the mock's "+ Nueva vista" is deliberately not rendered here.
 *
 * Built on the shared Radix `Tabs`/`TabsList`/`TabsTrigger` (not plain
 * `role="tab"` buttons) specifically for the keyboard contract those roles
 * promise — arrow-key navigation and roving tabindex — which hand-rolled
 * ARIA roles do not get for free. There is no `TabsContent`: the page owns
 * what renders below these tabs, and Radix's tab/list roles work correctly
 * without one.
 *
 * Presentational: no fetching. The parent supplies each tab's result count
 * (or omits it while still loading) and owns which preset is active.
 */

import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ORDER_VIEW_PRESETS, type OrderViewPresetId } from '@/lib/orders/order-view-presets';

interface OrderViewTabsProps {
  activePreset: OrderViewPresetId;
  /** Result count per preset id. A missing key renders the tab with no count badge (e.g. still loading). */
  presetCounts: Partial<Record<OrderViewPresetId, number>>;
  onSelectPreset: (id: OrderViewPresetId) => void;
}

export function OrderViewTabs({ activePreset, presetCounts, onSelectPreset }: OrderViewTabsProps) {
  return (
    <Tabs
      value={activePreset}
      onValueChange={(id) => onSelectPreset(id as OrderViewPresetId)}
      // Radix defaults to "automatic": arrow-key focus movement fires
      // onValueChange on every keypress. Task 6 wires each preset change to
      // a URL update and a refetch — holding Right Arrow would fire one
      // fetch per tab. "manual" keeps arrow keys to focus movement only;
      // Enter/Space (or a click) is what actually activates a tab.
      activationMode="manual"
    >
      <TabsList
        aria-label="Vistas de pedidos"
        className="h-auto w-full justify-start gap-0.5 rounded-none border-b border-border bg-transparent p-0 px-6"
      >
        {ORDER_VIEW_PRESETS.map((preset) => {
          const isActive = preset.id === activePreset;
          const count = presetCounts[preset.id];

          return (
            <TabsTrigger
              key={preset.id}
              value={preset.id}
              className={cn(
                '-mb-px flex items-center gap-1.5 rounded-none border-b-2 border-transparent px-3 py-2.5 text-xs font-medium text-text-secondary shadow-none transition-colors hover:text-text',
                'data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-text data-[state=active]:shadow-none',
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
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
