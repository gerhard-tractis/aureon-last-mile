'use client';

import { Map as MapIcon } from 'lucide-react';
import type { SelectionSummary } from '@/hooks/dispatch/pre-route/useUnroutedGroups';

/**
 * spec-54 phase 4.2 — the centre column (mock 1c).
 *
 * The mock shows a live map with proposed polylines and a metrics card
 * reading DISTANCIA / DURACIÓN / OCUPACIÓN / CPO EST. None of those four are
 * computable today: they come from the OR-Tools optimiser, which has no
 * frontend wiring, and there is no map provider. Inventing plausible numbers
 * on a planning screen would be worse than showing none.
 *
 * So the canvas is an explicitly labelled placeholder and the metrics strip
 * reports what the selection *actually* contains. When the optimiser and a
 * provider land, this component is where they go — the layout does not move.
 */

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-text-muted">
        {label}
      </span>
      <span className="font-mono text-[17px] font-bold leading-none text-text">{value}</span>
    </div>
  );
}

export function RoutePlanCanvas({ summary }: { summary: SelectionSummary }) {
  return (
    <section className="relative flex min-h-[280px] min-w-0 flex-col overflow-hidden bg-map-surface">
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <MapIcon className="h-7 w-7 text-map-line" aria-hidden="true" />
        <p className="max-w-xs text-[12.5px] leading-normal text-text-secondary">
          El mapa de rutas propuestas llega con el proveedor de mapas.
        </p>
        <p className="max-w-xs text-[11px] leading-normal text-text-muted">
          Mientras tanto, arma la ruta desde la selección de la izquierda.
        </p>
      </div>

      <div className="flex flex-none flex-wrap gap-x-8 gap-y-3 border-t border-border bg-surface px-5 py-3.5">
        <Metric label="Órdenes" value={summary.orderCount} />
        <Metric label="Paquetes" value={summary.packageCount} />
        <Metric label="Comunas" value={summary.comunaCount} />
        <Metric label="Grupos" value={summary.groupCount} />
      </div>
    </section>
  );
}
