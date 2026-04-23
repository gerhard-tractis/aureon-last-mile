import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PreRouteAnden } from '@/lib/types';
import { ComunaBreakdown } from './ComunaBreakdown';

type Props = {
  anden: PreRouteAnden;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onCreateRoute: (orderIds: string[]) => void;
};

export function AndenCard({
  anden,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
  onCreateRoute,
}: Props) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Checkbox — sibling to expand button; click must not propagate */}
        <label
          className="flex items-center cursor-pointer shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            className="h-4 w-4 rounded border-border"
          />
        </label>

        {/* Expand body */}
        <button
          type="button"
          aria-label={anden.name}
          onClick={onToggleExpand}
          className="flex-1 flex items-center gap-3 text-left"
        >
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm">{anden.name}</span>
            {anden.comunas_list.length > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                {anden.comunas_list.join(', ')}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {anden.order_count} órd · {anden.package_count} bultos
          </span>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </button>

        {/* Crear ruta — acts only on this card's order_ids */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCreateRoute(anden.order_ids);
          }}
          className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Crear ruta
        </button>
      </div>

      {isExpanded && anden.comunas.length > 0 && (
        <ComunaBreakdown comunas={anden.comunas} />
      )}
    </div>
  );
}
