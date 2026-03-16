'use client';

import { useOrdersByClient } from '@/hooks/useLoadingMetrics';

interface OrdersByClientTableProps {
  operatorId: string;
  startDate: string;
  endDate: string;
}

const fmt = (n: number) => n.toLocaleString('es-CL');

export default function OrdersByClientTable({ operatorId, startDate, endDate }: OrdersByClientTableProps) {
  const { data, isLoading } = useOrdersByClient(operatorId, startDate, endDate);

  return (
    <div className="bg-card rounded-xl p-6 shadow-sm border border-border">
      <h2 className="text-lg font-semibold text-foreground mb-4">Órdenes por Cliente</h2>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-4 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Sin datos para el período seleccionado
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="pb-2">Cliente</th>
              <th className="pb-2 text-right">Órdenes</th>
              <th className="pb-2 text-right">Bultos</th>
              <th className="pb-2 text-right">% del Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr
                key={row.retailer_name}
                className={`border-b border-border ${idx % 2 === 1 ? 'bg-muted' : ''}`}
              >
                <td className="py-2">{row.retailer_name}</td>
                <td className="py-2 text-right tabular-nums">{fmt(row.orders)}</td>
                <td className="py-2 text-right tabular-nums">{fmt(row.packages)}</td>
                <td className="py-2 text-right tabular-nums">{row.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
