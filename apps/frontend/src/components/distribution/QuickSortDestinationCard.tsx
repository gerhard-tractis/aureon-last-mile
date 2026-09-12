'use client';

import type { ReactNode } from 'react';
import type { ZoneMatchResult } from '@/lib/distribution/sectorization-engine';
import type { QuickSortPackageInfo } from '@/hooks/distribution/useQuickSortFlow';

/**
 * spec-96 Fase 1 review round 2, "Also fix" #4 — the accepted-destination
 * card (`LLEVAR A` / 62px zone code / zone name / package line) was a
 * byte-for-byte copy between `QuickSortMobileDock.tsx`'s non-rejected
 * `DestinationCard` branch (`4h`/`4i`) and `QuickSortMobile.tsx`'s
 * `'confirmed'` render (`4j`) — the SAME card the mock draws in both
 * places. Two copies hold only until one of them changes; the phase's own
 * open findings predict the designer will ask for `DOCK-003 · rutas
 * R-2481 · R-2483` on this card, which would then land in one file and
 * silently miss the other.
 *
 * The rejected (`4i`, error-palette) variant is NOT here — it only ever
 * renders from `QuickSortMobileDock`, so extracting it would just move a
 * single-caller block without removing any duplication.
 *
 * `children` is the incomplete-order banner's slot: `4j`'s artboard nests
 * it inside this card; `QuickSortMobileDock` (`4h`) renders it as a
 * sibling instead, matching where each artboard actually draws it — so
 * this component doesn't decide that placement, its caller does.
 */
export interface QuickSortDestinationCardProps {
  destination: ZoneMatchResult;
  currentPackage: QuickSortPackageInfo | null;
  children?: ReactNode;
}

export function QuickSortDestinationCard({
  destination,
  currentPackage,
  children,
}: QuickSortDestinationCardProps) {
  return (
    <div
      data-testid="quicksort-destination-card"
      data-tone="ok"
      className="flex flex-col gap-1.5 rounded-2xl border-2 border-status-success-border bg-status-success-bg px-5 py-5"
    >
      <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.12em] text-status-success-text">
        LLEVAR A
      </span>
      <span className="font-mono text-[62px] font-bold leading-none tracking-tight text-status-success-text">
        {destination.zone_code}
      </span>
      <p className="text-[13px] text-status-success-text">{destination.zone_name}</p>
      {currentPackage && (
        <p className="mt-1 text-[12px] text-status-success-text">
          {currentPackage.comunaName ?? 'Sin comuna'} · {currentPackage.label} · orden{' '}
          {currentPackage.orderNumber}
        </p>
      )}
      {children}
    </div>
  );
}
