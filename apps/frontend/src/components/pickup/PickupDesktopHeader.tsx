'use client';

import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { todayLabel } from '@/lib/pickup/pickupPageHelpers';

/**
 * spec-54 mock 1l — the Recogida page header, desktop only.
 *
 * Its own component for symmetry with the mobile branch, which has had
 * `PickupMobileHeader` since spec-54: the page rendered one of them as a
 * component and the other as inline JSX, which is why the "two stacked
 * headers on a 390px screen" bug (found live in QA) was easy to write and
 * hard to see. Both branches now name their header the same way.
 *
 * The caller still owns the `!isBelowLg` guard — this component does not
 * know about the breakpoint, it just IS the desktop header.
 */
export interface PickupDesktopHeaderProps {
  manifestCount: number;
  onNewManifest: () => void;
  /** Already-translated label for the "Nuevo manifiesto" button. */
  newManifestLabel: string;
}

export function PickupDesktopHeader({
  manifestCount,
  onNewManifest,
  newManifestLabel,
}: PickupDesktopHeaderProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="font-heading text-[26px] font-semibold leading-[1.1] tracking-[-.02em] text-text">
          Recogida
        </h1>
        <p className="text-[12.5px] leading-none text-text-secondary">
          {todayLabel(new Date())} ·{' '}
          <span className="font-mono font-semibold text-text">{manifestCount}</span>{' '}
          {manifestCount === 1 ? 'manifiesto por retirar' : 'manifiestos por retirar'}
        </p>
      </div>
      <Button onClick={onNewManifest} className="ml-auto gap-2">
        <Camera className="h-4 w-4" />
        {newManifestLabel}
      </Button>
    </div>
  );
}
