'use client';

import { useNowTick } from '@/hooks/dispatch/useNowTick';
import { computeLoadRateFmt } from '@/lib/dispatch/loading-monitor';

export interface DispatchTabletRateProps {
  packagesLoaded: number;
  /** Oldest ACCEPTED entry's `atIso` in this session's own history — not
   *  schema-impossible (unlike Turno/volume/sector): `ScanHistoryEntry
   *  .atIso` is already in `useRouteScanSession`'s `history`, so
   *  packages-per-hour is a pure derivation, not a fabricated figure. */
  firstScanAtIso: string | null;
}

/**
 * spec-78 Goal ("ritmo") — reuses `computeLoadRateFmt` verbatim (the same
 * pure function `RouteTrackingLiveLine`, `1c`, already uses), in its own
 * component so its tick re-renders only this text (Lecciones aplicadas
 * #9/#4 — a per-second tick anywhere higher would re-render the whole
 * screen on every clock second). 15s, not 1s: a rate does not need
 * sub-minute precision, and this repo's other slow ticks (loading-monitor
 * polling) already run on that cadence.
 */
export function DispatchTabletRate({ packagesLoaded, firstScanAtIso }: DispatchTabletRateProps) {
  const now = useNowTick(15_000);
  const rate = firstScanAtIso ? computeLoadRateFmt(packagesLoaded, firstScanAtIso, now) : null;
  if (rate === null) return null;
  return <span className="text-[20px] font-medium text-text-secondary">· ritmo {rate}/h</span>;
}
