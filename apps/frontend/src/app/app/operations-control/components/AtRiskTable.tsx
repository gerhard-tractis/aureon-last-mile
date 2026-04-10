'use client';

import type { AtRiskOrder } from '@/hooks/ops-control/useAtRiskOrders';
import { STATUS_LABELS } from '../lib/labels.es';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface AtRiskTableProps {
  orders: AtRiskOrder[];
  total: number;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

export function AtRiskTable({ orders, page, pageCount, onPageChange }: AtRiskTableProps) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Pedido</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Cliente</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Dirección</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Etapa</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Retailer</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Tiempo</th>
              <th className="px-3 py-2 text-left text-xs text-text-muted uppercase tracking-wide font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                  Sin órdenes en riesgo
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="border-b border-border hover:bg-surface-raised transition-colors">
                  <td className="px-3 py-2 font-mono tabular-nums text-status-info font-semibold">{order.id}</td>
                  <td className="px-3 py-2">{order.customer}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate">{order.address}</td>
                  <td className="px-3 py-2">{order.stage}</td>
                  <td className="px-3 py-2">{order.retailer}</td>
                  <td className={`px-3 py-2 font-mono tabular-nums ${order.status === 'late' ? 'text-status-error' : 'text-status-warning'}`}>
                    {order.label}
                  </td>
                  <td className="px-3 py-2">{STATUS_LABELS[order.status] ?? order.status}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center gap-3 px-3 py-2 border-t border-border text-xs text-text-secondary">
          <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
            Anterior
          </Button>
          <span>Página {page} de {pageCount}</span>
          <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
            Siguiente
          </Button>
        </div>
      )}
    </Card>
  );
}
