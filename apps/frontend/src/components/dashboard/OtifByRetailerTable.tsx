'use client';

import { useState } from 'react';
import { useOtifByRetailer } from '@/hooks/useDeliveryMetrics';

interface OtifByRetailerTableProps {
  operatorId: string;
  startDate: string;
  endDate: string;
}

type SortColumn = 'retailer_name' | 'total_orders' | 'delivered' | 'on_time' | 'otif_pct';
type SortDir = 'asc' | 'desc';

function getOtifCellColor(pct: number | null): string {
  if (pct === null) return 'text-slate-400';
  if (pct >= 95) return 'text-emerald-600 font-semibold';
  if (pct >= 85) return 'text-amber-600 font-semibold';
  return 'text-red-600 font-semibold';
}

export default function OtifByRetailerTable({ operatorId, startDate, endDate }: OtifByRetailerTableProps) {
  const { data, isLoading } = useOtifByRetailer(operatorId, startDate, endDate);
  const [sortCol, setSortCol] = useState<SortColumn>('otif_pct');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const handleSort = (col: SortColumn) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir(col === 'retailer_name' ? 'asc' : 'desc');
    }
  };

  const sorted = [...(data ?? [])].sort((a, b) => {
    const aVal = a[sortCol] ?? -1;
    const bVal = b[sortCol] ?? -1;
    if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal as string) : (bVal as string).localeCompare(aVal);
    return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200" data-testid="otif-retailer-skeleton">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-48 bg-slate-200 rounded" />
          {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded" />)}
        </div>
      </div>
    );
  }

  const COLS: { key: SortColumn; label: string; align: string }[] = [
    { key: 'retailer_name', label: 'Cliente', align: 'text-left' },
    { key: 'total_orders', label: 'Total', align: 'text-right' },
    { key: 'delivered', label: 'Entregados', align: 'text-right' },
    { key: 'on_time', label: 'A Tiempo', align: 'text-right' },
    { key: 'otif_pct', label: 'OTIF %', align: 'text-right' },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden" data-testid="otif-retailer-table">
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-800">OTIF por Cliente</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {COLS.map(({ key, label, align }) => (
                <th
                  key={key}
                  className={`px-4 py-3 font-medium text-slate-600 cursor-pointer hover:bg-slate-100 select-none ${align}`}
                  onClick={() => handleSort(key)}
                  aria-sort={sortCol === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  {label} {sortCol === key && (sortDir === 'asc' ? '\u2191' : '\u2193')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.retailer_name} className={i % 2 === 1 ? 'bg-slate-50/50' : ''}>
                <td className="px-4 py-3 text-slate-800">{row.retailer_name}</td>
                <td className="px-4 py-3 text-right text-slate-600" data-testid="retailer-total">
                  {row.total_orders.toLocaleString('es-CL')}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{row.delivered.toLocaleString('es-CL')}</td>
                <td className="px-4 py-3 text-right text-slate-600">{row.on_time.toLocaleString('es-CL')}</td>
                <td className={`px-4 py-3 text-right ${getOtifCellColor(row.otif_pct)}`}>
                  {row.otif_pct !== null ? row.otif_pct.toFixed(1) : '\u2014'}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Sin datos para el periodo seleccionado</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
