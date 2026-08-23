'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import type { OrderDossierData, DossierDispatch } from '@/hooks/useOrderDossier';

/**
 * spec-65 Task 9 — `3b`'s header. Deliberately not shared with `1f`'s own
 * header markup (`OrderInspectorBody`) — same underlying fields, different
 * layout (a full identity row vs. a sheet title), per the task brief.
 *
 * Rulings this component follows without exception (spec-65 Task 9 brief):
 * no SLA-delta badge (the dossier query doesn't select the
 * `rescheduled_*`/`delivered_at` columns `classifyRisk` needs — see the
 * task report for the requested extension), no courier guide number chip
 * (`dispatches.external_dispatch_id` isn't selected either), no customer
 * RUT (`orders` has no such column), no "N de M" paginator, and none of
 * the three unbacked action buttons (no backing mutation — spec-65
 * Decision 3).
 */
interface Props {
  order: OrderDossierData;
  /** Most recent audit-log timestamp, or null when there are none — never a fabricated fallback. */
  lastUpdated: string | null;
  deliveryDispatch: DossierDispatch | null;
  /** `/app/orders`, plus the query string this page was reached with, if any. */
  breadcrumbHref: string;
}

function formatChipTime(iso: string): string {
  return format(new Date(iso), 'HH:mm');
}

function formatDeliveryWindow(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  return `${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-text-secondary">
      {children}
    </span>
  );
}

export function FichaHeader({ order, lastUpdated, deliveryDispatch, breadcrumbHref }: Props) {
  const window_ = formatDeliveryWindow(order.delivery_window_start, order.delivery_window_end);
  const route = deliveryDispatch?.external_route_id ?? null;

  const handleCopyLink = () => {
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast.success('Enlace copiado'))
      .catch((err) => {
        console.error('[orders/[id]] copy link failed', err);
        toast.error('No se pudo copiar el enlace');
      });
  };

  return (
    <div className="flex flex-none flex-col gap-3 border-b border-border bg-surface px-6 py-4">
      <div className="flex items-center gap-3">
        <Link
          href={breadcrumbHref}
          className="flex items-center gap-1.5 text-[11.5px] font-medium text-text-secondary hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Pedidos
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-xl font-semibold tracking-tight text-text">{order.order_number}</h1>
            <StatusBadge status={order.leading_status} size="md" />
            {lastUpdated && (
              <span className="font-mono text-[10px] text-text-muted">
                actualizado {formatChipTime(lastUpdated)}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Chip>{order.customer_name}</Chip>
            {order.retailer_name && <Chip>{order.retailer_name}</Chip>}
            <Chip>
              <span className="font-semibold text-text">{order.packages.length}</span> paquetes
            </Chip>
            <Chip>
              promesa <span className="font-semibold text-text">{order.delivery_date}</span>
              {window_ && <> · ventana {window_}</>}
            </Chip>
            {route && (
              <Chip>
                ruta <span className="font-semibold text-text">{route}</span>
                {deliveryDispatch?.driver_name && <> · {deliveryDispatch.driver_name}</>}
              </Chip>
            )}
          </div>
        </div>

        <div className="flex flex-none items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopyLink}>
            Copiar enlace
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/app/audit-logs">Auditoría</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
