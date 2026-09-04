'use client';

import { ScanResult } from '@/components/scan/ScanResult';
import { formatScanTimestamp, type ScanHistoryEntry } from '@/lib/dispatch/mobile/scan-session';

/**
 * spec-76 2e/2f — the large "last read" card, always rendered in place of
 * itself (decision 5: never a modal, never a blocking dialog — the field
 * behind it stays armed for the next scan). One component covers both an
 * accepted load (`Cargado en la ruta`) and a rejection: colour and icon
 * change together via `ScanResult`'s own `status` prop, the rest of the
 * card composes around it because ScanResult's `context` is a single line
 * and this screen needs several (order, address, client, box count).
 */
export interface DispatchScanLastReadProps {
  entry: ScanHistoryEntry;
  /** ALREADY_IN_ROUTE only — navigates to the route that already owns the
   *  package. Never an offer to move it (decision 5). */
  onViewRoute: (routeId: string) => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-text-muted">{label}</span>
      <span className="truncate text-right font-medium text-text">{value}</span>
    </div>
  );
}

export function DispatchScanLastRead({ entry, onViewRoute }: DispatchScanLastReadProps) {
  if (entry.kind === 'rejected') {
    return (
      <div className="flex flex-col gap-2" data-testid="dispatch-scan-last-read">
        <ScanResult
          status="error"
          title={entry.title}
          context={entry.code}
          timestamp={formatScanTimestamp(entry.atIso)}
        />
        {entry.rejectionCode === 'ALREADY_IN_ROUTE' && (
          <p className="rounded-lg border border-status-error-border bg-status-error-bg px-3 py-2 text-[12px] leading-[1.4] text-status-error-text">
            El paquete NO fue agregado a esta ruta y sigue en la otra.
          </p>
        )}
        {entry.canViewConflictingRoute && entry.conflictingRouteId && (
          <button
            type="button"
            onClick={() => onViewRoute(entry.conflictingRouteId!)}
            className="min-h-[44px] self-start rounded-[10px] border border-border px-4 text-[13px] font-medium text-text active:opacity-90"
          >
            Ver ruta
          </button>
        )}
      </div>
    );
  }

  const contextLine = [entry.orderNumber, entry.contactName].filter(Boolean).join(' · ');
  const stopLabel = entry.stopIndex !== null ? `parada ${String(entry.stopIndex).padStart(2, '0')}` : null;

  return (
    <div className="flex flex-col gap-2" data-testid="dispatch-scan-last-read">
      <ScanResult
        status="ok"
        title="Cargado en la ruta"
        context={contextLine || undefined}
        code={entry.code}
        timestamp={formatScanTimestamp(entry.atIso)}
      />
      <div className="flex flex-col gap-1 rounded-lg border border-border-subtle px-3 py-2">
        {entry.contactAddress && <Row label="Dirección" value={entry.contactAddress} />}
        {entry.retailerName && <Row label="Cliente" value={entry.retailerName} />}
      </div>
      {entry.boxesLoaded !== null && entry.boxesTotal !== null && (
        <p className="text-[11.5px] text-text-muted">
          paquete {entry.boxesLoaded} de {entry.boxesTotal}
          {stopLabel ? ` · ${stopLabel}` : ''}
        </p>
      )}
    </div>
  );
}
