'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { subDays, format } from 'date-fns';
import {
  useCustomerPerformance,
  type CustomerPerformanceRow,
} from '@/hooks/useDashboardMetrics';
import { createSPAClient } from '@/lib/supabase/client';
import CustomerPerformanceTableSkeleton from './CustomerPerformanceTableSkeleton';
import MetricDrillDownDialog from './MetricDrillDownDialog';
import DashboardErrorBanner from './DashboardErrorBanner';

interface CustomerPerformanceTableProps {
  operatorId: string;
}

type SortColumn = 'retailer_name' | 'total_orders' | 'sla_pct' | 'fadr_pct' | 'failed_deliveries';
type SortDirection = 'asc' | 'desc';

type DateRangeOption = '7' | '30' | '90' | 'custom';

function getSlaColor(value: number | null): { bg: string; text: string } {
  if (value === null) return { bg: 'bg-muted', text: 'text-muted-foreground' };
  if (value >= 95) return { bg: 'bg-[#10b981]/10', text: 'text-[#10b981]' };
  if (value >= 90) return { bg: 'bg-[#f59e0b]/10', text: 'text-[#f59e0b]' };
  return { bg: 'bg-[#ef4444]/10', text: 'text-[#ef4444]' };
}

function getFadrColor(value: number | null): { bg: string; text: string } {
  if (value === null) return { bg: 'bg-muted', text: 'text-muted-foreground' };
  if (value >= 90) return { bg: 'bg-[#10b981]/10', text: 'text-[#10b981]' };
  if (value >= 80) return { bg: 'bg-[#f59e0b]/10', text: 'text-[#f59e0b]' };
  return { bg: 'bg-[#ef4444]/10', text: 'text-[#ef4444]' };
}

function escapeCSVField(value: string | number): string {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || /^[=+\-@\t\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportCSV(data: CustomerPerformanceRow[], filename: string) {
  const headers = ['Cliente', 'Pedidos', 'SLA %', 'FADR %', 'Fallos'];
  const rows = data.map(r => [
    r.retailer_name,
    r.total_orders,
    r.sla_pct?.toFixed(1) ?? 'N/A',
    r.fadr_pct?.toFixed(1) ?? 'N/A',
    r.failed_deliveries,
  ]);
  const csv = [headers, ...rows].map(r => r.map(escapeCSVField).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const SORT_ICON = { asc: ' ↑', desc: ' ↓' } as const;

export default function CustomerPerformanceTable({ operatorId }: CustomerPerformanceTableProps) {
  // Date range state
  const [dateRange, setDateRange] = useState<DateRangeOption>('7');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { startDate, endDate } = useMemo(() => {
    if (dateRange === 'custom' && customStart && customEnd) {
      return { startDate: customStart, endDate: customEnd };
    }
    const today = new Date();
    const end = format(today, 'yyyy-MM-dd');
    const days = dateRange === 'custom' ? 7 : Number(dateRange);
    const start = format(subDays(today, days - 1), 'yyyy-MM-dd');
    return { startDate: start, endDate: end };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally recompute only on dateRange/custom changes; today's date is stable within a session
  }, [dateRange, customStart, customEnd]);

  // Sort state
  const [sortColumn, setSortColumn] = useState<SortColumn>('total_orders');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Search state
  const [search, setSearch] = useState('');

  // Pagination state
  const [visibleCount, setVisibleCount] = useState(10);

  // Drill-down dialog
  const [selectedRetailer, setSelectedRetailer] = useState<CustomerPerformanceRow | null>(null);

  const { data, isLoading, isError, isPlaceholderData } = useCustomerPerformance(operatorId, startDate, endDate);

  // Reset pagination on date range change
  const handleDateRangeChange = (value: DateRangeOption) => {
    setDateRange(value);
    setVisibleCount(10);
  };

  // Sort handler
  const handleSort = (column: SortColumn) => {
    if (column === sortColumn) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Filtered + sorted data
  const processedData = useMemo(() => {
    if (!data) return [];
    let filtered = data;
    if (search) {
      const lower = search.toLowerCase();
      filtered = filtered.filter(r => r.retailer_name.toLowerCase().includes(lower));
    }
    const sorted = [...filtered].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDirection === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [data, search, sortColumn, sortDirection]);

  const visibleData = processedData.slice(0, visibleCount);
  const totalCount = processedData.length;

  // CSV export with audit log
  const handleExport = async () => {
    const filename = `aureon-clientes-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    exportCSV(processedData, filename);
    try {
      await (createSPAClient().from('audit_logs').insert as CallableFunction)({
        action: 'EXPORT_DASHBOARD',
        resource_type: 'report',
        details: { filename, rows: processedData.length },
      });
    } catch {
      // Non-blocking — export still succeeds
    }
  };

  if (isLoading) return <CustomerPerformanceTableSkeleton />;

  const ariaSortValue = (col: SortColumn): 'ascending' | 'descending' | undefined => {
    if (col !== sortColumn) return undefined;
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  };

  const dateRangeLabels: Record<string, string> = {
    '7': 'Últimos 7 días',
    '30': 'Últimos 30 días',
    '90': 'Últimos 90 días',
    custom: 'Rango personalizado',
  };

  return (
    <>
      <div className={`relative bg-card rounded-xl border border-border shadow-sm p-6 transition-all duration-300${isPlaceholderData ? ' opacity-60' : ''}`}>
        {isPlaceholderData && (
          <Loader2 className="absolute top-4 right-4 h-4 w-4 animate-spin text-muted-foreground" aria-label="Actualizando..." />
        )}
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Desempeño por Cliente
          </h2>
          <button
            onClick={handleExport}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-md hover:bg-blue-50 transition-colors"
          >
            Exportar CSV ↓
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4 mb-4">
          {/* Search */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Buscar cliente..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-56"
            />
          </div>

          {/* Date range */}
          <select
            value={dateRange}
            onChange={e => handleDateRangeChange(e.target.value as DateRangeOption)}
            className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.entries(dateRangeLabels).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>

          {dateRange === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={e => { setCustomStart(e.target.value); setVisibleCount(10); }}
                className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-muted-foreground">—</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => { setCustomEnd(e.target.value); setVisibleCount(10); }}
                className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>

        {/* Error banner */}
        {isError && <DashboardErrorBanner />}

        {/* Table */}
        {processedData.length === 0 && !isLoading && !isError ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No hay datos de clientes para este periodo
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted border-b-2 border-border">
                    {([
                      { key: 'retailer_name' as SortColumn, label: 'Cliente', width: '25%', align: 'left' },
                      { key: 'total_orders' as SortColumn, label: 'Pedidos', width: '15%', align: 'right' },
                      { key: 'sla_pct' as SortColumn, label: 'SLA %', width: '15%', align: 'right' },
                      { key: 'fadr_pct' as SortColumn, label: 'FADR %', width: '15%', align: 'right' },
                      { key: 'failed_deliveries' as SortColumn, label: 'Fallos', width: '15%', align: 'right' },
                    ]).map(col => (
                      <th
                        key={col.key}
                        scope="col"
                        style={{ width: col.width }}
                        aria-sort={ariaSortValue(col.key)}
                        className={`px-4 py-3 text-xs font-medium text-foreground uppercase tracking-wider cursor-pointer select-none hover:bg-muted/80 transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                        onClick={() => handleSort(col.key)}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSort(col.key); } }}
                        tabIndex={0}
                        role="columnheader"
                      >
                        {col.label}
                        {sortColumn === col.key && (
                          <span aria-hidden="true">{SORT_ICON[sortDirection]}</span>
                        )}
                      </th>
                    ))}
                    <th scope="col" style={{ width: '15%' }} className="px-4 py-3 text-xs font-medium text-foreground uppercase tracking-wider text-center">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleData.map((row, idx) => {
                    const slaColor = getSlaColor(row.sla_pct);
                    const fadrColor = getFadrColor(row.fadr_pct);
                    const failureWarning = row.total_orders > 0 && (row.failed_deliveries / row.total_orders) > 0.08;

                    return (
                      <tr
                        key={row.retailer_name}
                        className={`border-b border-border hover:bg-muted transition-colors ${idx % 2 === 1 ? 'bg-muted/50' : ''}`}
                        style={{ height: 56 }}
                      >
                        <td
                          className="px-4 py-3 text-sm font-semibold text-foreground truncate max-w-0"
                          title={row.retailer_name}
                        >
                          {row.retailer_name}
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground text-right tabular-nums">
                          {row.total_orders.toLocaleString('es-CL')}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right tabular-nums ${slaColor.bg} ${slaColor.text} font-medium`}>
                          {row.sla_pct !== null ? `${row.sla_pct.toFixed(1)}%` : '0'}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right tabular-nums ${fadrColor.bg} ${fadrColor.text} font-medium`}>
                          {row.fadr_pct !== null ? `${row.fadr_pct.toFixed(1)}%` : '0'}
                        </td>
                        <td className={`px-4 py-3 text-sm text-right tabular-nums ${failureWarning ? 'text-amber-600 font-medium' : 'text-foreground'}`}>
                          {row.failed_deliveries.toLocaleString('es-CL')}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setSelectedRetailer(row)}
                            className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                            aria-label={`Ver detalles de ${row.retailer_name}`}
                          >
                            Ver detalles
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">
                Mostrando {Math.min(visibleCount, totalCount)} de {totalCount} clientes
              </span>
              {visibleCount < totalCount && (
                <button
                  onClick={() => setVisibleCount(prev => prev + 10)}
                  className="text-sm font-medium text-blue-600 hover:text-blue-800 px-4 py-2 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  Cargar más
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* Drill-down dialog */}
      <MetricDrillDownDialog
        open={!!selectedRetailer}
        onOpenChange={open => { if (!open) setSelectedRetailer(null); }}
        title={selectedRetailer?.retailer_name ?? ''}
        description={`Detalle de rendimiento para ${selectedRetailer?.retailer_name ?? ''}`}
      >
        {selectedRetailer && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase">Pedidos</p>
                <p className="text-lg font-semibold text-foreground">{selectedRetailer.total_orders.toLocaleString('es-CL')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Entregados</p>
                <p className="text-lg font-semibold text-foreground">{selectedRetailer.delivered_orders.toLocaleString('es-CL')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">SLA %</p>
                <p className={`text-lg font-semibold ${getSlaColor(selectedRetailer.sla_pct).text}`}>
                  {selectedRetailer.sla_pct !== null ? `${selectedRetailer.sla_pct.toFixed(1)}%` : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">FADR %</p>
                <p className={`text-lg font-semibold ${getFadrColor(selectedRetailer.fadr_pct).text}`}>
                  {selectedRetailer.fadr_pct !== null ? `${selectedRetailer.fadr_pct.toFixed(1)}%` : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Fallos</p>
                <p className="text-lg font-semibold text-foreground">{selectedRetailer.failed_deliveries.toLocaleString('es-CL')}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Tasa de fallo</p>
                <p className="text-lg font-semibold text-foreground">
                  {selectedRetailer.total_orders > 0
                    ? `${((selectedRetailer.failed_deliveries / selectedRetailer.total_orders) * 100).toFixed(1)}%`
                    : 'N/A'}
                </p>
              </div>
            </div>
          </div>
        )}
      </MetricDrillDownDialog>
    </>
  );
}
