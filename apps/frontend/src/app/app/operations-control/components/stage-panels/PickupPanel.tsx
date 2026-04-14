"use client";

import { useMemo, useState } from 'react';
import { StagePanel } from '../StagePanel';
import { useOpsControlSnapshot } from '@/hooks/ops-control/useOpsControlSnapshot';
import { TH, TD, TD_MONO, TD_LINK, TD_EMPTY, TR } from './tableStyles';

export interface StagePanelProps {
  operatorId: string;
  lastSyncAt: Date | null;
}

type Manifest = Record<string, unknown>;

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
}

export function PickupPanel({ operatorId, lastSyncAt }: StagePanelProps) {
  const { snapshot } = useOpsControlSnapshot(operatorId);
  const manifests = (snapshot?.pickups ?? []) as Manifest[];

  // Filter state
  const [clientFilter, setClientFilter] = useState<string>('');
  const [pickupPointFilter, setPickupPointFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');

  // Extract unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const clients = [...new Set(manifests.map((m) => m['retailer_name'] as string).filter(Boolean))].sort();
    const points = [...new Set(manifests.map((m) => m['pickup_point_name'] as string).filter(Boolean))].sort();
    const dates = [...new Set(manifests.map((m) => m['effective_delivery_date'] as string).filter(Boolean))].sort();
    return { clients, points, dates };
  }, [manifests]);

  // Apply filters
  const filtered = useMemo(() => {
    return manifests.filter((m) => {
      if (clientFilter && m['retailer_name'] !== clientFilter) return false;
      if (pickupPointFilter && m['pickup_point_name'] !== pickupPointFilter) return false;
      if (dateFilter && m['effective_delivery_date'] !== dateFilter) return false;
      return true;
    });
  }, [manifests, clientFilter, pickupPointFilter, dateFilter]);

  const activeFilters = [clientFilter, pickupPointFilter, dateFilter].filter(Boolean).length;

  const kpis = [
    { label: 'En tránsito', value: String(filtered.length) },
    { label: 'Clientes', value: String(filterOptions.clients.length) },
    { label: 'Puntos pickup', value: String(filterOptions.points.length) },
    { label: 'Órdenes', value: String(filtered.reduce((sum, m) => sum + ((m['order_count'] as number) ?? 0), 0)) },
  ];

  return (
    <StagePanel
      title="Recogida"
      subtitle="Pickups en tránsito hacia recepción"
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
              <th className={TH}>Carga</th>
              <th className={TH}>Cliente</th>
              <th className={TH}>Punto Pickup</th>
              <th className={TH}>Fecha entrega</th>
              <th className={TH}># Órdenes</th>
              <th className={TH}># Bultos</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className={TD_EMPTY}>
                  {activeFilters > 0 ? 'Sin resultados para los filtros seleccionados' : 'Sin pickups en tránsito'}
                </td>
              </tr>
            ) : (
              filtered.map((m) => (
                <tr key={m['id'] as string} className={TR}>
                  <td className={TD_LINK}>{(m['external_load_id'] as string) ?? '—'}</td>
                  <td className={TD}>{(m['retailer_name'] as string) ?? '—'}</td>
                  <td className={TD}>{(m['pickup_point_name'] as string) ?? '—'}</td>
                  <td className={TD_MONO}>{formatDate(m['effective_delivery_date'] as string | null)}</td>
                  <td className={TD_MONO}>{String(m['order_count'] ?? m['total_orders'] ?? '—')}</td>
                  <td className={TD_MONO}>{String(m['total_packages'] ?? '—')}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </StagePanel>
  );
}
