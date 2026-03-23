'use client';

/**
 * OrderDetailModal
 * Modal/slideout showing full order details when clicking an order row.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useOrderDetail } from '@/hooks/useOrderDetail';
import { PackageStatusBreakdown } from './PackageStatusBreakdown';
import { StatusTimeline } from './StatusTimeline';

interface OrderDetailModalProps {
  orderId: string | null;
  onClose: () => void;
}

function formatDeliveryWindow(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export function OrderDetailModal({ orderId, onClose }: OrderDetailModalProps) {
  const { data, isLoading, isError } = useOrderDetail(orderId);

  // Escape key is handled natively by Radix Dialog via onOpenChange.

  return (
    <Dialog open={!!orderId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="order-detail-modal">
        {isLoading && (
          <p className="text-sm text-text-muted py-4">Cargando detalles...</p>
        )}

        {isError && !isLoading && (
          <p className="text-sm text-status-error py-4">Error al cargar detalles del pedido</p>
        )}

        {!isLoading && !isError && data && (
          <>
            {/* Header */}
            <DialogHeader>
              <div className="flex items-start justify-between">
                <div>
                  <DialogTitle className="text-lg font-semibold">
                    Orden #{data.order_number}
                  </DialogTitle>
                  <p className="text-sm text-text-secondary mt-1">
                    {data.retailer_name ? `${data.retailer_name} — ` : ''}{data.customer_name}
                  </p>
                  <p className="text-sm text-text-muted">
                    {data.delivery_address}, {data.comuna}
                  </p>
                  <p className="text-xs text-text-muted mt-1">
                    Promesa: {data.delivery_date}
                    {' | '}
                    Ventana: {formatDeliveryWindow(data.delivery_window_start, data.delivery_window_end)}
                  </p>
                </div>
                <button
                  data-testid="modal-close-btn"
                  onClick={onClose}
                  className="ml-4 text-text-muted hover:text-text-secondary text-lg leading-none"
                  aria-label="Cerrar"
                >
                  ×
                </button>
              </div>
            </DialogHeader>

            {/* Packages section */}
            <section className="mt-4">
              <h3 className="text-sm font-semibold text-text-secondary mb-2">Paquetes</h3>
              <PackageStatusBreakdown packages={data.packages} />
            </section>

            {/* History section */}
            <section className="mt-4">
              <h3 className="text-sm font-semibold text-text-secondary mb-2">Historial</h3>
              <StatusTimeline auditLogs={data.auditLogs} />
            </section>

            {/* Placeholder action */}
            <section className="mt-4 pt-4 border-t border-border">
              <button
                onClick={() => {}}
                aria-label="Reasignar zona"
                className="px-4 py-2 text-sm text-accent bg-accent-muted border border-border rounded hover:bg-accent-muted/80"
              >
                Reasignar zona
              </button>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
