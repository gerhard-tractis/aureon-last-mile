'use client';

import { cn } from '@/lib/utils';
import type { ConnectionState } from '@/hooks/useSyncQueue';
import type { ScanQueue } from '@/lib/db';

/**
 * spec-54 phase 4.5 — "Cola de sincronización" (mock 1e, right column).
 *
 * The explanatory line is the point of this panel, and the handoff is
 * explicit about its wording: it must tell the operator that their work is
 * safe and that they can keep counting. "Sin conexión" alone leaves them
 * wondering whether the last twenty scans are gone.
 */

function timeLabel(at: Date | string): string {
  return new Date(at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

interface SyncQueuePanelProps {
  status: ConnectionState;
  queuedCount: number;
  recent: ScanQueue[];
  onRetry: () => void;
  isRetrying?: boolean;
}

export function SyncQueuePanel({
  status,
  queuedCount,
  recent,
  onRetry,
  isRetrying = false,
}: SyncQueuePanelProps) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-border bg-surface">
      <header className="flex flex-none items-baseline gap-2 border-b border-border px-4 py-3.5">
        <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
          Cola de sincronización
        </h2>
        <span
          className={cn(
            'ml-auto font-mono text-[11px] font-semibold leading-none',
            queuedCount > 0 ? 'text-status-warning-text' : 'text-status-success-text',
          )}
        >
          {queuedCount}
        </span>
      </header>

      <div className="flex flex-none flex-col gap-2.5 border-b border-border px-4 py-3.5">
        <p className="text-[11.5px] leading-[1.5] text-text-secondary">
          {status === 'offline'
            ? 'Sin conexión. Los escaneos se guardan en el dispositivo y se envían solos al recuperar señal. Puedes seguir contando.'
            : queuedCount > 0
              ? 'Hay escaneos guardados en el dispositivo esperando envío. Se envían solos; puedes seguir contando.'
              : 'Todo sincronizado. Los escaneos se envían apenas los registras.'}
        </p>
        {queuedCount > 0 && (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="h-8 rounded-md border border-border-strong text-[11.5px] font-semibold text-text-body transition-colors hover:bg-surface-raised disabled:opacity-50"
          >
            {isRetrying ? 'Reintentando…' : 'Reintentar ahora'}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {recent.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12.5px] text-text-secondary">
            Los escaneos de esta sesión aparecen aquí.
          </p>
        ) : (
          recent.map((scan) => (
            <div
              key={scan.id ?? `${scan.barcode_scanned}-${String(scan.scanned_at)}`}
              data-testid="sync-row"
              className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 flex-none rounded-full',
                  scan.synced ? 'bg-status-success' : 'bg-status-warning',
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  'truncate font-mono text-[11px] font-semibold',
                  scan.synced ? 'text-text-muted' : 'text-text',
                )}
              >
                {scan.barcode_scanned}
              </span>
              <span className="ml-auto flex-none font-mono text-[10px] font-medium text-text-muted">
                {scan.synced ? timeLabel(scan.scanned_at) : 'en cola'}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
