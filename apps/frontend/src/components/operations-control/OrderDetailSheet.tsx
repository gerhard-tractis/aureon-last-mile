'use client';

/**
 * OrderDetailSheet
 * Slide-out sheet (from right) showing full order details when clicking an order row.
 * Replaces OrderDetailModal (spec-13c).
 */

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { StatusBadge } from '@/components/StatusBadge';
import { useOrderDetail } from '@/hooks/useOrderDetail';
import { PackageStatusBreakdown } from './PackageStatusBreakdown';
import { StatusTimeline } from './StatusTimeline';

interface OrderDetailSheetProps {
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

export function OrderDetailSheet({ orderId, onClose }: OrderDetailSheetProps) {
  const { data, isLoading, isError } = useOrderDetail(orderId);

  return (
    <Sheet open={!!orderId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full max-w-lg overflow-y-auto"
        data-testid="order-detail-sheet"
      >
        {isLoading && (
          <div className="space-y-3 py-4">
            <div className="h-5 w-48 bg-surface-raised rounded animate-pulse" />
            <div className="h-4 w-64 bg-surface-raised rounded animate-pulse" />
            <div className="h-4 w-40 bg-surface-raised rounded animate-pulse" />
          </div>
        )}

        {isError && !isLoading && (
          <p className="text-sm text-[var(--color-status-error)] py-4">
            Error al cargar detalles del pedido
          </p>
        )}

        {!isLoading && !isError && data && (
          <>
            {/* Header */}
            <SheetHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <SheetTitle className="text-lg font-semibold text-text">
                    Orden #{data.order_number}
                  </SheetTitle>
                  <SheetDescription className="text-sm text-text-secondary">
                    {data.retailer_name ? `${data.retailer_name} — ` : ''}{data.customer_name}
                  </SheetDescription>
                </div>
                <StatusBadge status={data.status} size="sm" />
              </div>
              <div className="space-y-0.5 mt-1">
                <p className="text-sm text-text-secondary">
                  {data.delivery_address}, {data.comuna}
                </p>
                <p className="text-xs text-text-muted font-mono">
                  Promesa: {data.delivery_date}
                  {' | '}
                  Ventana: {formatDeliveryWindow(data.delivery_window_start, data.delivery_window_end)}
                </p>
              </div>
            </SheetHeader>

            {/* Packages section */}
            <section className="mt-6">
              <h3 className="text-sm font-semibold text-text mb-2">Paquetes</h3>
              <PackageStatusBreakdown packages={data.packages} />
            </section>

            {/* History section */}
            <section className="mt-6">
              <h3 className="text-sm font-semibold text-text mb-2">Historial</h3>
              <StatusTimeline auditLogs={data.auditLogs} />
            </section>

            {/* Action */}
            <section className="mt-6 pt-4 border-t border-border">
              <button
                onClick={() => {}}
                aria-label="Reasignar zona"
                className="px-4 py-2 text-sm bg-accent text-accent-foreground rounded hover:opacity-90 transition-opacity"
              >
                Reasignar zona
              </button>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
