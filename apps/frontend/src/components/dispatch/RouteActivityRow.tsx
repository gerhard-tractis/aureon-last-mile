'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouteDispatches } from '@/hooks/dispatch/useRouteDispatches';
import type { DispatchRoute } from '@/lib/dispatch/types';

interface Props {
  route: DispatchRoute;
  operatorId: string;
  isOpen: boolean;
  onToggle: () => void;
}

type Color = 'green' | 'amber' | 'red';

function completionColor(pct: number): Color {
  if (pct >= 90) return 'green';
  if (pct >= 70) return 'amber';
  return 'red';
}

const DOT_CLASS: Record<Color, string> = {
  green: 'bg-green-500 shadow-[0_0_6px_theme(colors.green.500/50%)]',
  amber: 'bg-amber-500 shadow-[0_0_6px_theme(colors.amber.500/50%)]',
  red:   'bg-red-500   shadow-[0_0_6px_theme(colors.red.500/50%)]',
};
const BAR_CLASS: Record<Color, string> = { green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500' };
const PCT_CLASS: Record<Color, string> = { green: 'text-green-500', amber: 'text-amber-500', red: 'text-red-500' };

export function RouteActivityRow({ route, operatorId, isOpen, onToggle }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: dispatches = [], isLoading, isError, refetch } = useRouteDispatches(
    isOpen ? route.id : null,
    operatorId,
  );

  const firstId = dispatches[0]?.dispatch_id ?? null;
  const effectiveSelectedId = selectedId ?? firstId;
  const selectedOrder = dispatches.find((d) => d.dispatch_id === effectiveSelectedId) ?? null;

  const pct = route.planned_stops > 0
    ? Math.round((route.completed_stops / route.planned_stops) * 1000) / 10
    : 0;
  const color = completionColor(pct);
  const driverLabel = route.driver_name ?? 'Sin conductor';
  const subLabel = [route.truck_identifier, route.external_route_id].filter(Boolean).join(' · ');

  const entregadas = isOpen && !isLoading
    ? dispatches.filter((d) => d.status === 'delivered').length
    : route.completed_stops;
  const fallidas = isOpen && !isLoading
    ? dispatches.filter((d) => d.status === 'failed').length
    : null;
  const pendientes = isOpen && !isLoading
    ? dispatches.filter((d) => d.status === 'pending' || d.status === 'partial').length
    : null;

  const statBoxes = [
    { label: 'Asignadas',  value: route.planned_stops, cls: '',               testId: 'stat-asignadas'  },
    { label: 'Entregadas', value: entregadas,           cls: 'text-green-500', testId: 'stat-entregadas' },
    { label: 'Fallidas',   value: fallidas ?? '—',      cls: fallidas != null ? 'text-red-500' : 'text-text-secondary', testId: 'stat-fallidas' },
    { label: 'Pendientes', value: pendientes ?? '—',    cls: 'text-text-secondary', testId: 'stat-pendientes' },
  ];

  return (
    <div className={cn('rounded-xl border-[1.5px] overflow-hidden bg-surface', isOpen ? 'border-blue-500/60' : 'border-border')}>
      {/* Header */}
      <div
        role="button"
        aria-label={driverLabel}
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        className="flex items-center gap-4 px-5 py-3.5 cursor-pointer hover:bg-surface-raised transition-colors select-none"
      >
        <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', DOT_CLASS[color])} />
        <div className="w-48 flex-shrink-0">
          <p className="text-sm font-bold text-text truncate">{driverLabel}</p>
          {subLabel && <p className="text-xs text-text-secondary mt-0.5 truncate">{subLabel}</p>}
        </div>
        <div className="flex gap-1.5">
          {statBoxes.map(({ label, value, cls, testId }) => (
            <div key={label} className="text-center bg-surface-raised border border-border rounded-lg px-3 py-1.5 min-w-[66px]">
              <p data-testid={testId} className={cn('text-lg font-bold font-mono', cls)}>{value}</p>
              <p className="text-[10px] text-text-secondary mt-0.5">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline mb-1.5">
            <span className="text-xs text-text-secondary">Cumplimiento</span>
            <span className={cn('text-lg font-bold', PCT_CLASS[color])}>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-raised overflow-hidden">
            <div className={cn('h-full rounded-full', BAR_CLASS[color])} style={{ width: `${pct}%` }} />
          </div>
        </div>
        <span className={cn('text-text-secondary transition-transform duration-200', isOpen && 'rotate-90')}>›</span>
      </div>

      {/* Expanded panel */}
      {isOpen && (
        <div data-testid="route-expanded-panel" className="border-t border-border flex h-80">
          {/* Order list — left pane (260px) */}
          <div className="w-[260px] flex-shrink-0 border-r border-border overflow-y-auto">
            {isLoading && (
              <div data-testid="orders-loading" className="p-3 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-md" />
                ))}
              </div>
            )}
            {isError && (
              <div className="p-4 flex flex-col items-center gap-2 text-center">
                <p className="text-sm text-text-secondary">No se pudo cargar las órdenes</p>
                <button onClick={() => refetch()} className="text-xs text-accent underline" aria-label="Reintentar">
                  Reintentar
                </button>
              </div>
            )}
            {!isLoading && !isError && dispatches.map((d) => (
              <button
                key={d.dispatch_id}
                onClick={() => setSelectedId(d.dispatch_id)}
                className={cn(
                  'w-full text-left flex items-center gap-2.5 px-4 py-2.5 border-l-2 transition-colors hover:bg-surface-raised',
                  effectiveSelectedId === d.dispatch_id ? 'border-blue-500 bg-surface-raised' : 'border-transparent',
                )}
              >
                <span className={cn('w-2 h-2 rounded-full flex-shrink-0', {
                  'bg-green-500': d.status === 'delivered',
                  'bg-red-500':   d.status === 'failed',
                  'bg-amber-500': d.status === 'partial',
                  'bg-slate-500': d.status === 'pending',
                })} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono font-semibold text-text truncate">{d.order_number}</p>
                  <p className="text-[11px] text-text-secondary truncate">{d.contact_address ?? '—'}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Order detail — middle pane */}
          <div className="flex-1 overflow-y-auto p-5">
            {selectedOrder ? (
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-bold tracking-widest uppercase text-text-secondary mb-2">Orden</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-xs text-text-secondary">Número</p><p className="text-sm font-mono font-semibold text-accent">{selectedOrder.order_number}</p></div>
                    <div><p className="text-xs text-text-secondary">Estado</p><p className="text-sm font-medium text-text capitalize">{selectedOrder.status}</p></div>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold tracking-widest uppercase text-text-secondary mb-2">Destinatario</p>
                  <div className="space-y-2">
                    <div><p className="text-xs text-text-secondary">Nombre</p><p className="text-sm text-text">{selectedOrder.contact_name ?? '—'}</p></div>
                    <div><p className="text-xs text-text-secondary">Teléfono</p><p data-testid="order-phone" className="text-sm text-text">{selectedOrder.contact_phone ?? '—'}</p></div>
                    <div><p className="text-xs text-text-secondary">Dirección</p><p className="text-sm text-text">{selectedOrder.contact_address ?? '—'}</p></div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-secondary text-center mt-8">Selecciona una orden</p>
            )}
          </div>

          {/* Map placeholder — right pane (280px) */}
          <div data-testid="map-placeholder" className="w-[280px] flex-shrink-0 border-l border-border flex flex-col items-center justify-center gap-2 bg-surface">
            <span className="text-3xl">🗺</span>
            <p className="text-xs text-text-secondary text-center leading-relaxed">Mapa Leaflet<br /><em className="opacity-50">próximo sprint</em></p>
          </div>
        </div>
      )}
    </div>
  );
}
