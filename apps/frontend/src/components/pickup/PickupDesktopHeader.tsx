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
 *
 * spec-95 fase 8 (mock `5a:63-67`) — the checklist calls out "el buscador
 * de la cabecera pasa a ser el global (orden/paquete/RUT)". That search box
 * is already app-wide: `TopBar` renders it (`onOpenSearch`, gated by
 * `showOpsTools`) above every page, including this one, in `AppLayout`.
 * This component never owned a search box of its own to begin with — there
 * is nothing to move here. The module's OWN search (carga/punto/cliente)
 * lives in `PickupDesktopView`, its own bar above the client chips.
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
