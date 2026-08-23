'use client';

/**
 * OrdersBulkBar — the selection bar on `/app/orders` (spec-65, mock `3a`).
 * Appears only once rows are selected.
 *
 * Spec-65 Decision 3: the mock's "Reasignar ruta", "Marcar excepción",
 * "Reintentar entrega" and "Notificar cliente" have no backing mutation and
 * are deliberately NOT rendered — not disabled, not tooltipped. A dead
 * control in an operations screen reads as broken, not "coming soon".
 * "Exportar" is the only action that ships: `ordersToCsv` (Task 4) returns
 * a string and never touches the DOM, so triggering the browser download
 * is this component's job.
 */

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ordersToCsv } from '@/lib/orders/orders-csv';
import type { OrdersListRow } from '@/hooks/useOrdersList';

interface OrdersBulkBarProps {
  selectedRows: OrdersListRow[];
}

function downloadCsv(rows: OrdersListRow[]) {
  const csv = ordersToCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `pedidos-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function OrdersBulkBar({ selectedRows }: OrdersBulkBarProps) {
  if (selectedRows.length === 0) return null;

  return (
    <div className="flex items-center gap-3 border-t border-border bg-surface px-5.5 py-2.5">
      <span className="flex items-center gap-2 text-[11.5px] font-semibold text-text">
        <span className="font-mono text-accent">{selectedRows.length}</span> seleccionados
      </span>
      <span className="h-4.5 w-px bg-border" />
      <Button variant="outline" size="sm" onClick={() => downloadCsv(selectedRows)}>
        <Download className="h-3 w-3" />
        Exportar
      </Button>
    </div>
  );
}
