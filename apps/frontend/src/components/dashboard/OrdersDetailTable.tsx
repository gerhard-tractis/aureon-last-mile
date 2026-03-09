'use client';

import { useState, useEffect, useRef, Fragment } from 'react';
import { useOrdersDetail, type OrderDetailRow } from '@/hooks/useDeliveryMetrics';

interface OrdersDetailTableProps {
  operatorId: string;
  startDate: string;
  endDate: string;
  initialStatus?: string | null;
  initialOverdueOnly?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  processing: 'Procesando',
  dispatched: 'Despachado',
  delivered: 'Entregado',
  failed: 'Fallido',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700',
  processing: 'bg-blue-100 text-blue-700',
  dispatched: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function ExpandedRow({ row }: { row: OrderDetailRow }) {
  return (
    <tr className="bg-slate-50 border-b border-slate-200">
      <td colSpan={6} className="px-4 py-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-slate-400 text-xs block">Conductor</span>
            <span className="text-slate-700">{row.driver_name ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 text-xs block">Ruta</span>
            <span className="text-slate-700 font-mono text-xs">{row.route_id ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 text-xs block">Razón de Fallo</span>
            <span className="text-slate-700">{row.failure_reason ?? '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 text-xs block">Delta</span>
            <span className={`font-semibold ${
              row.days_delta === null ? 'text-slate-400' :
              row.days_delta <= 0 ? 'text-emerald-600' : 'text-red-600'
            }`}>
              {row.days_delta === null ? '—' :
               row.days_delta === 0 ? 'A tiempo' :
               row.days_delta > 0 ? `+${row.days_delta} ${row.days_delta === 1 ? 'día' : 'días'}` :
               `${row.days_delta} ${row.days_delta === -1 ? 'día' : 'días'}`}
            </span>
          </div>
        </div>
      </td>
    </tr>
  );
}

const PAGE_SIZE = 25;

export default function OrdersDetailTable({
  operatorId,
  startDate,
  endDate,
  initialStatus = null,
  initialOverdueOnly = false,
}: OrdersDetailTableProps) {
  const [statusFilter, setStatusFilter] = useState<string | null>(initialStatus);
  const [search, setSearch] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(initialOverdueOnly);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [statusFilter, search, overdueOnly]);

  // Update filters when initial props change (from card clicks)
  useEffect(() => { setStatusFilter(initialStatus ?? null); }, [initialStatus]);
  useEffect(() => { setOverdueOnly(initialOverdueOnly); }, [initialOverdueOnly]);

  const { data, isLoading } = useOrdersDetail(operatorId, startDate, endDate, {
    status: statusFilter ?? undefined,
    search: search || undefined,
    overdueOnly,
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = data ? Math.ceil(data.total_count / PAGE_SIZE) : 0;
  const rangeStart = (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, data?.total_count ?? 0);

  if (isLoading && !data) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200" data-testid="orders-detail-skeleton">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-48 bg-slate-200 rounded" />
          <div className="h-10 bg-slate-100 rounded" />
          {[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" ref={tableRef} data-testid="orders-detail-table">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-800 mb-3">Detalle de Órdenes</h3>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <select
            data-testid="status-filter"
            value={statusFilter ?? ''}
            onChange={(e) => setStatusFilter(e.target.value || null)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-[#e6c15c]"
          >
            <option value="">Todos los estados</option>
            <option value="delivered">Entregado</option>
            <option value="failed">Fallido</option>
            <option value="pending">Pendiente</option>
            <option value="processing">Procesando</option>
            <option value="dispatched">Despachado</option>
          </select>

          <label className="sr-only" htmlFor="order-search">Buscar orden</label>
          <input
            id="order-search"
            type="text"
            placeholder="Buscar por N° orden..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-[#e6c15c] w-48"
          />

          <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              data-testid="overdue-filter"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="rounded border-slate-300 text-[#e6c15c] focus:ring-[#e6c15c]"
            />
            Solo atrasados
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-3 text-left font-medium text-slate-600">Orden</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Cliente</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Comuna</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Fecha Compromiso</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Completado</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row, i) => (
              <Fragment key={row.id}>
                <tr
                  className={`cursor-pointer hover:bg-slate-50 transition-colors ${i % 2 === 1 ? 'bg-slate-50/50' : ''} ${expandedId === row.id ? 'bg-slate-100' : ''}`}
                  onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                >
                  <td className="px-4 py-3 text-slate-800 font-mono text-xs">{row.order_number}</td>
                  <td className="px-4 py-3 text-slate-600 truncate max-w-[160px]">{row.retailer_name}</td>
                  <td className="px-4 py-3 text-slate-600">{row.comuna}</td>
                  <td className="px-4 py-3 text-slate-600">{row.delivery_date}</td>
                  <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                  <td className="px-4 py-3 text-slate-600 text-xs">
                    {row.completed_at ? row.completed_at.split(' ')[0] : '—'}
                  </td>
                </tr>
                {expandedId === row.id && <ExpandedRow row={row} />}
              </Fragment>
            ))}
            {(data?.rows ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Sin resultados</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total_count > 0 && (
        <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between text-sm text-slate-600">
          <span>{rangeStart}\u2013{rangeEnd} de {data.total_count.toLocaleString('es-CL')}</span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="px-3 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              &larr; Anterior
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
              className="px-3 py-1 rounded border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Siguiente &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
