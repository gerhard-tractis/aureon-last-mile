'use client';

import { useLateDeliveries } from '@/hooks/useDeliveryMetrics';

interface LateDeliveriesTableProps {
  operatorId: string;
  startDate: string;
  endDate: string;
}

export default function LateDeliveriesTable({ operatorId, startDate, endDate }: LateDeliveriesTableProps) {
  const { data, isLoading } = useLateDeliveries(operatorId, startDate, endDate);

  if (isLoading) {
    return (
      <div className="bg-card rounded-xl p-6 shadow-sm border border-border" data-testid="late-deliveries-skeleton">
        <div className="animate-pulse space-y-3">
          <div className="h-5 w-48 bg-muted rounded" />
          {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted rounded" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl shadow-sm border border-border overflow-hidden" data-testid="late-deliveries-table">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">Entregas Tardías</h3>
        {data && data.length > 0 && (
          <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] px-2 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
            {data.length}
          </span>
        )}
      </div>

      {(!data || data.length === 0) ? (
        <div className="px-6 py-8 text-center text-muted-foreground text-sm">
          Sin entregas tardías en el periodo seleccionado
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Orden</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Cliente</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha Compromiso</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha Entrega</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Atraso</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Conductor</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={row.order_number} className={i % 2 === 1 ? 'bg-muted/50' : ''}>
                  <td className="px-4 py-3 text-foreground font-mono text-xs">{row.order_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.retailer_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.delivery_date}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.completed_date}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
                      +{row.days_late} {row.days_late === 1 ? 'día' : 'días'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{row.driver_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
