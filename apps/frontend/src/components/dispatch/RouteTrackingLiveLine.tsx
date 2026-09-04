'use client';

import { useNowTick } from '@/hooks/dispatch/useNowTick';
import { formatFreshness, computeLoadRateFmt } from '@/lib/dispatch/loading-monitor';

interface Props {
  /**
   * Phase-4 review — optional, like `loadPositionLabel` already was. A
   * null `scannerName` (RLS denial, a soft-deleted `users` row) used to
   * gate the WHOLE line at the caller, silently taking `hace 8 s` and
   * `ritmo 214/h` with it. Those two figures don't depend on knowing who
   * is scanning — only on there being a scan at all — so they render on
   * their own, without a name, exactly like the andén clause already does
   * without a position.
   */
  scannerName: string | null;
  loadPositionLabel: string | null;
  lastScanAtIso: string;
  firstScanAtIso: string;
  loadedBoxCount: number;
}

/**
 * spec-75 phase 4 (`1c`) — "<nombre> está escaneando en el andén A3 ·
 * último paquete hace 8 s · ritmo 214/h".
 *
 * Owns its own `useNowTick()` rather than receiving `now` as a prop — the
 * same pattern `ScanFreshness.tsx` (spec-75 phase 3) established, applied
 * here instead of literally embedding that component because its fixed
 * copy ("último escaneo") and stalled/fresh two-state contract don't match
 * this line's single always-fresh sentence. Reuses its underlying pure
 * functions (`formatFreshness`, `computeLoadRateFmt` from
 * `loading-monitor.ts`) so the two screens never compute freshness or pace
 * two different ways. A tick here re-renders only this one line, not the
 * whole tracking view (rule 4 — spec-75 tarea 3 lección).
 */
export function RouteTrackingLiveLine({
  scannerName,
  loadPositionLabel,
  lastScanAtIso,
  firstScanAtIso,
  loadedBoxCount,
}: Props) {
  const now = useNowTick();
  const rate = computeLoadRateFmt(loadedBoxCount, firstScanAtIso, now);

  return (
    <p className="text-[13px] text-text-secondary">
      {scannerName ? (
        <>
          <span className="font-medium text-text">{scannerName}</span>
          {' está escaneando'}
        </>
      ) : (
        'Escaneando'
      )}
      {loadPositionLabel && <> en el andén <span className="font-medium text-text">{loadPositionLabel}</span></>}
      {' · último paquete hace '}
      {formatFreshness(lastScanAtIso, now)}
      {rate !== null && <> · ritmo {rate}/h</>}
    </p>
  );
}
