import { Check, X, Copy, type LucideIcon } from 'lucide-react';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';
import type { ManifestOrder } from '@/hooks/pickup/useManifestOrders';

interface ScanResultCardProps {
  /** The most recent scan of any outcome, or null before the first one lands. */
  scan: ScanRecord | null;
  /** The order the scanned package belongs to, when it could be matched. */
  order: ManifestOrder | null;
  verifiedInOrder: number;
  totalInOrder: number;
}

interface Variant {
  containerClass: string;
  iconBgClass: string;
  iconClass: string;
  dividerClass: string;
  Icon: LucideIcon;
  headline: string;
}

const VARIANTS: Record<ScanRecord['scan_result'], Variant> = {
  verified: {
    containerClass: 'border-status-success-border bg-status-success-bg',
    iconBgClass: 'bg-status-success-border',
    iconClass: 'text-status-success-text',
    dividerClass: 'bg-status-success-border',
    Icon: Check,
    headline: 'Paquete verificado',
  },
  not_found: {
    containerClass: 'border-status-error-border bg-status-error-bg',
    iconBgClass: 'bg-status-error-border',
    iconClass: 'text-status-error-text',
    dividerClass: 'bg-status-error-border',
    Icon: X,
    headline: 'No está en la carga',
  },
  duplicate: {
    containerClass: 'border-status-warning-border bg-status-warning-bg',
    iconBgClass: 'bg-status-warning-border',
    iconClass: 'text-status-warning-text',
    dividerClass: 'bg-status-warning-border',
    Icon: Copy,
    headline: 'Ya fue escaneado',
  },
};

/**
 * spec-54 mock 1h — "Bloque de resultado". Always reflects the most recent
 * scan attempt, whatever its outcome — an earlier revision only looked at
 * the newest *verified* scan, which left a stale green "Paquete verificado"
 * card on screen after a not_found or duplicate scan immediately after it.
 *
 * No "guardado en el dispositivo" footer: `scan` comes from `usePickupScans`,
 * which reads `pickup_scans` back from Supabase, so by the time a scan
 * reaches this card it has already round-tripped to the server — there is
 * no per-scan sync state to honestly render. `useSyncQueue`'s `status` is a
 * device-global online/offline flag, not per-scan provenance, so it cannot
 * stand in for one: a scan that synced fine and then the device went offline
 * would wrongly be relabelled "saved on device, awaiting upload". What would
 * unblock this: a Dexie write path in `useScanMutation` that records each
 * scan's own sync state (queued vs. confirmed) instead of writing straight
 * to Supabase.
 */
export function ScanResultCard({ scan, order, verifiedInOrder, totalInOrder }: ScanResultCardProps) {
  if (!scan) return null;

  const variant = VARIANTS[scan.scan_result];
  const { Icon } = variant;

  return (
    <div
      data-testid="scan-result-card"
      className={`rounded-2xl border p-5 ${variant.containerClass}`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl ${variant.iconBgClass}`}>
          <Icon className={`h-6 w-6 ${variant.iconClass}`} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-heading text-[17px] font-semibold leading-tight text-text">
            {variant.headline}
          </p>
          <p className="mt-0.5 font-mono text-[12px] text-text-secondary truncate">
            {scan.barcode_scanned}
          </p>
        </div>
      </div>

      {order && (
        <>
          <div className={`my-3 h-px ${variant.dividerClass}`} />
          <p className="text-sm text-text-body truncate">{order.customer_name}</p>
          <p className="text-xs text-text-secondary truncate">{order.delivery_address}</p>
          <p className="mt-1 text-xs font-medium text-text-secondary">
            paquete {verifiedInOrder} de {totalInOrder}
          </p>
        </>
      )}
    </div>
  );
}
