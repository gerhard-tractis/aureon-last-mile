'use client';

import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { StopPackageRow } from '@/lib/dispatch/mobile/route-packages-by-stop';

export interface DispatchRemovePackageSheetProps {
  target: StopPackageRow | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
  errorMessage: string | null;
}

/**
 * spec-76 2h — "Quitar" confirmation. The copy here is deliberately more
 * specific than decision 7's own wording, because `DELETE
 * /api/dispatch/routes/[id]/packages/[pkgId]` (read before writing this —
 * see useRemovePackageFromRoute.ts's header) does not do what decision 7
 * describes:
 *
 * - it removes the WHOLE stop (every package on this order), not just the
 *   one row tapped — there is no per-package removal endpoint;
 * - it resets the sibling packages to `sectorizado`, not `asignado`
 *   (verified against the endpoint's own test file).
 *
 * Both facts are named on screen rather than the (false) ones spec-76
 * decision 7 assumed — Lecciones aplicadas "no proxy under a label
 * asserting a fact" applies to a confirmation dialog exactly as much as it
 * does to a status chip. "Queda registrado quién lo quitó y cuándo" IS
 * true here (the endpoint writes an `audit_logs` row with `user_id` and a
 * timestamp) even though the status claim is not — the two are verified
 * independently, not bundled.
 */
export function DispatchRemovePackageSheet({
  target,
  onOpenChange,
  onConfirm,
  isPending,
  errorMessage,
}: DispatchRemovePackageSheetProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (target) setReason('');
  }, [target]);

  const trimmed = reason.trim();

  return (
    <Sheet open={!!target} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Quitar pedido {target?.orderNumber}</SheetTitle>
          <SheetDescription>
            Se quitará todo el pedido {target?.orderNumber} de la ruta — todos sus bultos, no solo{' '}
            {target?.barcode}. Vuelve al andén en estado <span className="font-mono">sectorizado</span>, listo para
            volver a escanearse. Queda registrado quién lo quitó y cuándo.
          </SheetDescription>
        </SheetHeader>

        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed) return;
            onConfirm(trimmed);
          }}
        >
          <Textarea
            aria-label="Motivo para quitar el pedido"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Motivo (obligatorio)"
            className="min-h-[80px] text-[13px]"
          />
          {errorMessage && (
            <p role="alert" className="text-[12.5px] text-status-error-text">
              {errorMessage}
            </p>
          )}
          <Button type="submit" disabled={!trimmed || isPending} className="h-[52px] text-base">
            {isPending ? 'Quitando…' : 'Quitar pedido'}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
