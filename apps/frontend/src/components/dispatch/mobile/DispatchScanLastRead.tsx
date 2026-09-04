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
 *
 * spec-78 review — `size` (`ScanField`'s own pattern) scales the detail
 * rows and the "paquete N de M" line. `ScanResult` itself is untouched
 * (shared by three other modules; its 34px code is already sized for 3m).
 * `'md'` is the exact pre-existing sizing (2e, unchanged); `'lg'` is 3a's
 * — the phone's rows were never distance-checked and don't read from
 * across a dock the way `ScanResult`'s own code already does.
 */
export interface DispatchScanLastReadProps {
  entry: ScanHistoryEntry;
  /** ALREADY_IN_ROUTE only — navigates to the route that already owns the
   *  package. Never an offer to move it (decision 5). */
  onViewRoute: (routeId: string) => void;
  size?: 'md' | 'lg';
}

const SIZES = {
  md: { row: 'text-[13px]', meta: 'text-[11.5px]', banner: 'text-[12px]' },
  lg: { row: 'text-[17px]', meta: 'text-[15px]', banner: 'text-[15px]' },
} as const;

function Row({ label, value, size }: { label: string; value: string; size: keyof typeof SIZES }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${SIZES[size].row}`}>
      <span className="text-text-muted">{label}</span>
      <span className="truncate text-right font-medium text-text">{value}</span>
    </div>
  );
}

export function DispatchScanLastRead({ entry, onViewRoute, size = 'md' }: DispatchScanLastReadProps) {
  const s = SIZES[size];

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
          <p className={`rounded-lg border border-status-error-border bg-status-error-bg px-3 py-2 leading-[1.4] text-status-error-text ${s.banner}`}>
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
        {entry.contactAddress && <Row label="Dirección" value={entry.contactAddress} size={size} />}
        {entry.retailerName && <Row label="Cliente" value={entry.retailerName} size={size} />}
      </div>
      {entry.boxesLoaded !== null && entry.boxesTotal !== null && (
        <p className={`text-text-muted ${s.meta}`}>
          paquete {entry.boxesLoaded} de {entry.boxesTotal}
          {stopLabel ? ` · ${stopLabel}` : ''}
        </p>
      )}
    </div>
  );
}
