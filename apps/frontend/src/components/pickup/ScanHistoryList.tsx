import { cn } from '@/lib/utils';
import type { ScanRecord } from '@/hooks/pickup/usePickupScans';

interface ScanHistoryListProps {
  scans: ScanRecord[];
  maxItems?: number;
}

/**
 * spec-54 mock 1h — "Historial": 7px status dot, error rows carry the reason
 * in place of the time.
 *
 * `scans` comes from `usePickupScans`, which reads `pickup_scans` directly
 * from Supabase — every row here already reached the server, so the dot is
 * always success (sincronizado) or error, never the warning "en cola" state.
 * That third state belongs to rows sourced from the device's offline queue
 * (see `SyncQueuePanel`, which reads `db.scan_queue` via `useSyncQueue`) —
 * this screen's scan mutation has no offline write path today, so there is
 * no queued row to honestly render here.
 */
export function ScanHistoryList({ scans, maxItems = 5 }: ScanHistoryListProps) {
  const recentScans = scans.slice(0, maxItems);

  if (recentScans.length === 0) {
    return (
      <p className="text-sm text-text-secondary text-center py-4">No scans yet</p>
    );
  }

  return (
    <div className="space-y-2">
      {recentScans.map((scan) => {
        const isError = scan.scan_result === 'not_found';
        const isDuplicate = scan.scan_result === 'duplicate';
        const reason = isError ? 'NO ESTÁ EN LA CARGA' : isDuplicate ? 'YA ESCANEADO' : null;

        return (
          <div
            key={scan.id}
            data-testid="scan-history-row"
            className={cn(
              'flex items-center gap-2.5 rounded-[11px] px-3 py-2.5',
              isError
                ? 'border border-status-error-border bg-status-error-bg'
                : isDuplicate
                  ? 'border border-status-warning-border bg-status-warning-bg'
                  : 'bg-surface-raised',
            )}
          >
            <span
              data-testid="scan-history-dot"
              aria-hidden="true"
              className={cn(
                'h-[7px] w-[7px] flex-none rounded-full',
                isError ? 'bg-status-error' : isDuplicate ? 'bg-status-warning' : 'bg-status-success',
              )}
            />
            <span
              className={cn(
                'flex-1 truncate font-mono text-[13px]',
                isError ? 'text-status-error-text' : isDuplicate ? 'text-status-warning-text' : 'text-text',
              )}
            >
              {scan.barcode_scanned}
            </span>
            <span
              className={cn(
                'flex-none font-mono text-[11px]',
                isError ? 'text-status-error-text' : isDuplicate ? 'text-status-warning-text' : 'text-text-muted',
              )}
            >
              {reason ?? new Date(scan.scanned_at).toLocaleTimeString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}
