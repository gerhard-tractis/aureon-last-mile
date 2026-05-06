'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/StatusBadge';
import { PackageStatusBreakdown } from '@/components/operations-control/PackageStatusBreakdown';
import { StatusTimeline } from '@/components/operations-control/StatusTimeline';
import { OrderLifecycleRibbon } from './OrderLifecycleRibbon';
import { useOrderDetail } from '@/hooks/useOrderDetail';

interface Props {
  orderId: string | null;
  onClose: () => void;
}

function formatDeliveryWindow(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  if (start && end) return `${fmt(start)}–${fmt(end)}`;
  return null;
}

export function OrderInspector({ orderId, onClose }: Props) {
  const { data, isLoading, isError } = useOrderDetail(orderId);
  const [tab, setTab] = useState<'lifecycle' | 'packages' | 'historial'>('lifecycle');

  return (
    <Sheet open={!!orderId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full max-w-2xl overflow-y-auto flex flex-col gap-0 p-0"
        data-testid="order-inspector"
      >
        {isLoading && (
          <div className="p-6 space-y-3 animate-pulse">
            <div className="h-5 w-48 bg-surface-raised rounded" />
            <div className="h-4 w-64 bg-surface-raised rounded" />
          </div>
        )}

        {isError && !isLoading && (
          <p className="p-6 text-sm text-[var(--color-status-error)]">Error al cargar la orden</p>
        )}

        {!isLoading && !isError && data && (
          <>
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-border">
              <SheetHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SheetTitle className="text-lg font-mono font-semibold text-text">
                      {data.order_number}
                    </SheetTitle>
                    <SheetDescription className="text-sm text-text-secondary mt-0.5">
                      {data.customer_name}
                    </SheetDescription>
                    <p className="text-xs text-text-muted mt-0.5">
                      {data.delivery_address}, {data.comuna}
                    </p>
                  </div>
                  <StatusBadge status={data.leading_status} size="sm" />
                </div>
              </SheetHeader>

              {/* Chips */}
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="inline-flex items-center gap-1.5 text-xs bg-surface-raised border border-border rounded-md px-2 py-1 text-text-muted">
                  <span className="font-medium text-text">{data.packages.length}</span> paquetes
                </span>
                {data.retailer_name && (
                  <span className="inline-flex items-center gap-1.5 text-xs bg-surface-raised border border-border rounded-md px-2 py-1 text-text-muted">
                    {data.retailer_name}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-xs bg-surface-raised border border-border rounded-md px-2 py-1 text-text-muted">
                  promesa <span className="font-medium text-text">{data.delivery_date}</span>
                </span>
                {formatDeliveryWindow(data.delivery_window_start, data.delivery_window_end) && (
                  <span className="inline-flex items-center gap-1.5 text-xs bg-surface-raised border border-border rounded-md px-2 py-1 text-text-muted">
                    {formatDeliveryWindow(data.delivery_window_start, data.delivery_window_end)}
                  </span>
                )}
              </div>
            </div>

            {/* Tabs */}
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as typeof tab)}
              className="flex-1 flex flex-col"
            >
              <TabsList className="mx-6 mt-4 w-auto justify-start">
                <TabsTrigger value="lifecycle">Ciclo de vida</TabsTrigger>
                <TabsTrigger value="packages">
                  Paquetes ({data.packages.length})
                </TabsTrigger>
                <TabsTrigger value="historial">
                  Historial ({data.auditLogs.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent forceMount value="lifecycle" className="px-6 py-4 data-[state=inactive]:hidden">
                <OrderLifecycleRibbon leadingStatus={data.leading_status} />
              </TabsContent>

              <TabsContent forceMount value="packages" className="px-6 py-4 data-[state=inactive]:hidden">
                <PackageStatusBreakdown packages={data.packages} />
              </TabsContent>

              <TabsContent forceMount value="historial" className="px-6 py-4 data-[state=inactive]:hidden">
                <StatusTimeline auditLogs={data.auditLogs} />
              </TabsContent>
            </Tabs>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-border flex justify-between items-center">
              <span className="text-xs text-text-faint font-mono">esc · cerrar</span>
              <button
                className="text-xs bg-surface-raised border border-border rounded px-3 py-1.5 text-text hover:bg-surface-elev transition-colors"
                onClick={() => navigator.clipboard?.writeText(data.order_number)}
              >
                Copiar ID
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
