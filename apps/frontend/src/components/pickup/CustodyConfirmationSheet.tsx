'use client';

import { AlertTriangle } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { backupPhotosLabel, custodyConfirmationCopy } from '@/lib/pickup/manifestCloseSummary';

export interface CustodyConfirmationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  verifiedCount: number;
  missingCount: number;
  operatorName: string;
  /** `null` cuando no hay firma del cliente — la fila "Firmas" muestra sólo
   *  al operario, igual que `signaturesCount` ya distingue 1 de 2 en `5i`. */
  clientName: string | null;
  /** Mismo contrato que `ManifestClosedSummary`/`backupPhotosLabel`: `null`
   *  es "no se sabe todavía" (query en pausa), nunca 0 por conveniencia —
   *  ver el comentario de `backupPhotosLabel` en `manifestCloseSummary.ts`. */
  serverPhotosCount: number | null;
  queuedPhotosCount: number;
  onConfirm: () => void;
  isSubmitting: boolean;
}

/**
 * spec-95 fase 7, mock `5f2` — "Móvil · confirmación irreversible de la
 * transferencia de custodia (entre 5f y 5i)". Reemplaza el `AlertDialog`
 * centrado que había (`page.tsx`, antes de esta fase) por una hoja inferior
 * con tirador, que es lo que el mock dibuja.
 *
 * `onConfirm` sólo llama a `useCloseManifest().handleComplete` — esta hoja
 * no conoce ni toca ninguna rama de esa función ni de la cola offline de
 * spec-81 fase 2. El cierre de la hoja al confirmar replica el
 * comportamiento que ya tenía `AlertDialogAction` de Radix (cierra al
 * pulsar, sin esperar a que la promesa resuelva) — no es nuevo.
 */
export function CustodyConfirmationSheet({
  open,
  onOpenChange,
  verifiedCount,
  missingCount,
  operatorName,
  clientName,
  serverPhotosCount,
  queuedPhotosCount,
  onConfirm,
  isSubmitting,
}: CustodyConfirmationSheetProps) {
  const signersLabel = clientName ? `${operatorName} · ${clientName}` : operatorName;

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex max-h-[90vh] flex-col gap-4 rounded-t-2xl">
        {/* Tirador decorativo del mock — no es un control, `aria-hidden`
            para que un lector de pantalla no lo anuncie como algo pulsable. */}
        <span
          data-testid="custody-sheet-grip"
          aria-hidden="true"
          className="mx-auto h-1 w-11 flex-none rounded-full bg-border"
        />

        <div className="flex items-center gap-3">
          <span className="grid h-[46px] w-[46px] flex-none place-items-center rounded-xl border border-status-warning-border bg-status-warning-bg">
            <AlertTriangle className="h-6 w-6 text-status-warning-text" aria-hidden="true" />
          </span>
          <SheetTitle className="text-[19px] font-semibold text-text">
            ¿Confirmar transferencia de custodia?
          </SheetTitle>
        </div>

        <SheetDescription className="text-[14.5px] text-text-secondary">
          {custodyConfirmationCopy(verifiedCount, missingCount)}
        </SheetDescription>

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
          <div data-testid="custody-sheet-signers" className="flex items-center gap-2.5">
            <span className="text-[13.5px] font-medium text-text-secondary">Firmas</span>
            <span className="ml-auto text-[13.5px] font-semibold text-text">{signersLabel}</span>
          </div>
          <div data-testid="custody-sheet-backup" className="flex items-center gap-2.5">
            <span className="text-[13.5px] font-medium text-text-secondary">Respaldo</span>
            <span className="ml-auto text-[13.5px] font-semibold text-text">
              {backupPhotosLabel(serverPhotosCount, queuedPhotosCount)}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="flex min-h-[58px] items-center justify-center rounded-2xl bg-accent-light text-[16px] font-semibold text-accent-light-foreground transition-opacity disabled:opacity-50"
          >
            Sí, cerrar la carga
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex min-h-[52px] items-center justify-center rounded-xl border border-border text-[15px] font-semibold text-text-secondary"
          >
            Volver a revisar
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
