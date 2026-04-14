"use client";

import { Fragment, useMemo, useState } from 'react';
import { StagePanel } from '../StagePanel';
import { useOpsControlSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import { TH, TD, TD_MONO, TD_LINK, TD_EMPTY, TR } from './tableStyles';
import { cn } from '@/lib/utils';

export interface StagePanelProps {
  operatorId: string;
  lastSyncAt: Date | null;
}

type PickupOrder = Record<string, unknown>;
type Package = { id: string; label: string; status: string; declared_box_count: number | null };

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
}

export function PickupPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const { snapshot } = useOpsControlSnapshot(operatorId);
  const orders = (snapshot?.pickups ?? []) as PickupOrder[];

  const [clientFilter, setClientFilter] = useState<string>('');
  const [pickupPointFilter, setPickupPointFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  const filterOptions = useMemo(() => {
    const clients = [...new Set(orders.map((o) => o['retailer_name'] as string).filter(Boolean))].sort();
    const points = [...new Set(orders.map((o) => o['pickup_point_name'] as string).filter(Boolean))].sort();
    const dates = [...new Set(orders.map((o) => o['effective_delivery_date'] as string).filter(Boolean))].sort();
    return { clients, points, dates };
  }, [orders]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (clientFilter && o['retailer_name'] !== clientFilter) return false;
      if (pickupPointFilter && o['pickup_point_name'] !== pickupPointFilter) return false;
      if (dateFilter && o['effective_delivery_date'] !== dateFilter) return false;
      return true;
    });
  }, [orders, clientFilter, pickupPointFilter, dateFilter]);

  const activeFilters = [clientFilter, pickupPointFilter, dateFilter].filter(Boolean).length;

  const kpis = [
    { label: 'Órdenes', value: String(filtered.length) },
    { label: 'Bultos', value: String(filtered.reduce((sum, o) => sum + ((o['packages'] as Package[])?.length ?? 0), 0)) },
    { label: 'Clientes', value: String(filterOptions.clients.length) },
    { label: 'Puntos pickup', value: String(filterOptions.points.length) },
  ];

  return (
    <StagePanel
      title="Recogida"
      subtitle="Órdenes en tránsito hacia recepción"
      deepLink="/app/pickup"
      deepLinkLabel="Abrir Recogida"
      kpis={kpis}
      page={1}
      pageCount={1}
      onPageChange={() => {}}
      lastSyncAt={lastSyncAt}
    >
      {/* Filters */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-surface-raised">
        <select
          value={clientFilter}
          onChange={(e) => setClientFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
        >
          <option value="">Todos los clientes</option>
          {filterOptions.clients.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <select
          value={pickupPointFilter}
          onChange={(e) => setPickupPointFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
        >
          <option value="">Todos los puntos</option>
          {filterOptions.points.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
        >
          <option value="">Todas las fechas</option>
          {filterOptions.dates.map((d) => (
            <option key={d} value={d}>{formatDate(d)}</option>
          ))}
        </select>

        {activeFilters > 0 && (
          <button
            type="button"
            onClick={() => { setClientFilter(''); setPickupPointFilter(''); setDateFilter(''); }}
            className="text-xs text-status-info hover:underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(TH, 'w-8')} />
              <th className={TH}>Orden</th>
              <th className={TH}>Cliente</th>
              <th className={TH}>Punto Pickup</th>
              <th className={TH}>Carga</th>
              <th className={TH}>Fecha entrega</th>
              <th className={TH}>Comuna</th>
              <th className={TH}>Bultos</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className={TD_EMPTY}>
                  {activeFilters > 0 ? 'Sin resultados para los filtros seleccionados' : 'Sin órdenes en tránsito'}
                </td>
              </tr>
            ) : (
              filtered.map((o) => {
                const id = o['id'] as string;
                const packages = (o['packages'] as Package[]) ?? [];
                const isExpanded = expandedOrder === id;

                return (
                  <Fragment key={id}>
                    <tr
                      className={cn(TR, 'cursor-pointer')}
                      onClick={() => setExpandedOrder(isExpanded ? null : id)}
                    >
                      <td className="px-2 py-2 text-text-muted text-xs">
                        {packages.length > 0 ? (isExpanded ? '▾' : '▸') : ''}
                      </td>
                      <td className={TD_LINK}>{(o['order_number'] as string) ?? '—'}</td>
                      <td className={TD}>{(o['retailer_name'] as string) ?? '—'}</td>
                      <td className={TD}>{(o['pickup_point_name'] as string) ?? '—'}</td>
                      <td className={TD_MONO}>{(o['external_load_id'] as string) ?? '—'}</td>
                      <td className={TD_MONO}>{formatDate(o['effective_delivery_date'] as string | null)}</td>
                      <td className={TD}>{(o['comuna'] as string) ?? '—'}</td>
                      <td className={TD_MONO}>{packages.length}</td>
                    </tr>
                    {isExpanded && packages.length > 0 && (
                      <tr>
                        <td colSpan={8} className="bg-surface-raised px-6 py-2">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border-subtle">
                                <th className="px-2 py-1 text-left text-text-muted font-medium">Etiqueta</th>
                                <th className="px-2 py-1 text-left text-text-muted font-medium">Estado</th>
                                <th className="px-2 py-1 text-left text-text-muted font-medium">Cajas</th>
                              </tr>
                            </thead>
                            <tbody>
                              {packages.map((pkg) => (
                                <tr key={pkg.id} className="border-b border-border-subtle last:border-0">
                                  <td className="px-2 py-1 font-mono">{pkg.label ?? '—'}</td>
                                  <td className="px-2 py-1">{pkg.status ?? '—'}</td>
                                  <td className="px-2 py-1 font-mono">{pkg.declared_box_count ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </StagePanel>
  );
}

