'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { subDays, format } from 'date-fns';
import {
  useCustomerPerformance,
  type CustomerPerformanceRow,
} from '@/hooks/useDashboardMetrics';
import { createSPAClient } from '@/lib/supabase/client';
import { DataTable, type ColumnDef } from '@/components/data-table/DataTable';
import MetricDrillDownDialog from './MetricDrillDownDialog';
import DashboardErrorBanner from './DashboardErrorBanner';

interface CustomerPerformanceTableProps {
  operatorId: string;
}

type DateRangeOption = '7' | '30' | '90' | 'custom';

function slaColor(val: number | null): string {
  if (val === null) return 'text-text-muted';
  if (val >= 93) return 'text-status-success';
  if (val >= 88) return 'text-status-warning';
  return 'text-status-error';
}

function fadrColor(val: number | null): string {
  if (val === null) return 'text-text-muted';
  if (val >= 93) return 'text-status-success';
  if (val >= 88) return 'text-status-warning';
  return 'text-status-error';
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

const COLUMNS: ColumnDef<CustomerPerformanceRow>[] = [
  {
    accessorKey: 'retailer_name',
    header: 'Cliente',
    sortable: true,
  },
  {
    accessorKey: 'total_orders',
    header: 'Pedidos',
    sortable: true,
    cell: (row) => (
      <span className="font-mono">{row.total_orders.toLocaleString('es-CL')}</span>
    ),
  },
  {
    accessorKey: 'sla_pct',
    header: 'SLA %',
    sortable: true,
    cell: (row) => {
      const val = row.sla_pct;
      const color = slaColor(val);
      return (
        <span className={`font-mono ${color}`}>
          {val !== null ? `${val.toFixed(1)}%` : '—'}
        </span>
      );
    },
  },
  {
    accessorKey: 'failed_deliveries',
    header: 'Fallidos',
    sortable: true,
    cell: (row) => {
      const val = row.failed_deliveries;
      const failureRate = row.total_orders > 0 ? val / row.total_orders : 0;
      const color =
        failureRate === null
          ? 'text-text-muted'
          : failureRate >= 0.12
          ? 'text-status-error'
          : failureRate >= 0.08
          ? 'text-status-warning'
          : 'text-text-primary';
      return <span className={`font-mono ${color}`}>{val.toLocaleString('es-CL')}</span>;
    },
  },
  {
    accessorKey: 'fadr_pct',
    header: 'OTIF',
    sortable: true,
    cell: (row) => {
      const val = row.fadr_pct;
      const color = fadrColor(val);
      return (
        <span className={`font-mono ${color}`}>
          {val !== null ? `${val.toFixed(1)}%` : '—'}
        </span>
      );
    },
  },
];

export default function CustomerPerformanceTable({ operatorId }: CustomerPerformanceTableProps) {
  // Date range state
  const [dateRange, setDateRange] = useState<DateRangeOption>('7');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Drill-down dialog
  const [selectedRetailer, setSelectedRetailer] = useState<CustomerPerformanceRow | null>(null);

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

  const { data, isLoading, isError, isPlaceholderData } = useCustomerPerformance(
    operatorId,
    startDate,
    endDate
  );

  const tableData = data ?? [];

  // CSV export with audit log
  const handleExport = async () => {
    const filename = `aureon-clientes-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    exportCSV(tableData, filename);
    try {
      await (createSPAClient().from('audit_logs').insert as CallableFunction)({
        action: 'EXPORT_DASHBOARD',
        resource_type: 'report',
        details: { filename, rows: tableData.length },
      });
    } catch {
      // Non-blocking — export still succeeds
    }
  };

  const dateRangeLabels: Record<string, string> = {
    '7': 'Últimos 7 días',
    '30': 'Últimos 30 días',
    '90': 'Últimos 90 días',
    custom: 'Rango personalizado',
  };

  return (
    <>
      <div
        className={`relative bg-card rounded-xl border border-border shadow-sm p-6 transition-all duration-300${
          isPlaceholderData ? ' opacity-60' : ''
        }`}
      >
        {isPlaceholderData && (
          <Loader2
            className="absolute top-4 right-4 h-4 w-4 animate-spin text-muted-foreground"
            aria-label="Actualizando..."
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Desempeño por Cliente
          </h2>
          <button
            onClick={handleExport}
            className="text-sm font-medium text-accent hover:opacity-80 px-3 py-1.5 rounded-md hover:bg-surface-raised transition-colors"
          >
            Exportar CSV ↓
          </button>
        </div>

        {/* Date range controls */}
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value as DateRangeOption)}
            className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {Object.entries(dateRangeLabels).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>

          {dateRange === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <span className="text-muted-foreground">—</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                className="text-sm border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          )}
        </div>

        {/* Error banner */}
        {isError && <DashboardErrorBanner />}

        {/* DataTable */}
        <DataTable<CustomerPerformanceRow>
          columns={COLUMNS}
          data={tableData}
          isLoading={isLoading}
          searchPlaceholder="Buscar cliente..."
          onRowClick={setSelectedRetailer}
          emptyMessage={isError ? '' : 'No hay datos de clientes para este periodo'}
        />
      </div>

      {/* Drill-down dialog */}
      <MetricDrillDownDialog
        open={!!selectedRetailer}
        onOpenChange={open => {
          if (!open) setSelectedRetailer(null);
        }}
        title={selectedRetailer?.retailer_name ?? ''}
        description={`Detalle de rendimiento para ${selectedRetailer?.retailer_name ?? ''}`}
      >
        {selectedRetailer && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase">Pedidos</p>
                <p className="text-lg font-semibold text-foreground">
                  {selectedRetailer.total_orders.toLocaleString('es-CL')}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Entregados</p>
                <p className="text-lg font-semibold text-foreground">
                  {selectedRetailer.delivered_orders.toLocaleString('es-CL')}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">SLA %</p>
                <p className={`text-lg font-semibold ${slaColor(selectedRetailer.sla_pct)}`}>
                  {selectedRetailer.sla_pct !== null
                    ? `${selectedRetailer.sla_pct.toFixed(1)}%`
                    : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">OTIF %</p>
                <p className={`text-lg font-semibold ${fadrColor(selectedRetailer.fadr_pct)}`}>
                  {selectedRetailer.fadr_pct !== null
                    ? `${selectedRetailer.fadr_pct.toFixed(1)}%`
                    : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Fallos</p>
                <p className="text-lg font-semibold text-foreground">
                  {selectedRetailer.failed_deliveries.toLocaleString('es-CL')}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase">Tasa de fallo</p>
                <p className="text-lg font-semibold text-foreground">
                  {selectedRetailer.total_orders > 0
                    ? `${(
                        (selectedRetailer.failed_deliveries / selectedRetailer.total_orders) *
                        100
                      ).toFixed(1)}%`
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
