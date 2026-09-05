'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useSealRoute } from '@/hooks/dispatch/mobile/useSealRoute';
import { missingOrders, closeButtonLabel, paginateMissing, buildForceSealNote } from '@/lib/dispatch/mobile/route-close';
import { FORCE_SEAL_REASON_CODES, type ForceSealReasonCode } from '@/lib/dispatch/force-seal-reasons';
import { FORCE_SEAL_REASON_LABELS, requiresNote } from '@/lib/dispatch/mobile/force-seal-reason-copy';
import type { RoutePackage } from '@/lib/dispatch/types';

const VISIBLE_ROWS = 4;

/**
 * spec-77 Fase 1 (UI) — `2i`, shown from `DispatchRouteScanSession` only
 * when the crew taps "Cerrar ruta" with something still short (item 3): a
 * route with nothing missing seals directly, no sheet. Decision 1: the
 * destructive action is the SECONDARY button and names the exact figure
 * (decision 1/item 5); decision 2: all three consequences, not a summary;
 * decision 3: the missing list is paginated; decision 4: a note per row is
 * optional and its absence never blocks the close.
 */
export interface DispatchRouteCloseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routeId: string;
  routeCode: string;
  loadPositionLabel: string | null;
  packagesLoaded: number;
  packages: RoutePackage[];
  onSealed: (outcome: { sealedStops?: number; ordersClosed?: number }) => void;
}

export function DispatchRouteCloseSheet({
  open,
  onOpenChange,
  routeId,
  routeCode,
  loadPositionLabel,
  packagesLoaded,
  packages,
  onSealed,
}: DispatchRouteCloseSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        {open && (
          <Body
            routeId={routeId}
            routeCode={routeCode}
            loadPositionLabel={loadPositionLabel}
            packagesLoaded={packagesLoaded}
            packages={packages}
            onSealed={onSealed}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

interface BodyProps {
  routeId: string;
  routeCode: string;
  loadPositionLabel: string | null;
  packagesLoaded: number;
  packages: RoutePackage[];
  onSealed: (outcome: { sealedStops?: number; ordersClosed?: number }) => void;
  onClose: () => void;
}

function Body({ routeId, routeCode, loadPositionLabel, packagesLoaded, packages, onSealed, onClose }: BodyProps) {
  const { seal, isSealing } = useSealRoute();
  const missing = missingOrders(packages);
  const totalMissingBoxes = missing.reduce((sum, m) => sum + m.missingCount, 0);
  const { visible, remaining } = paginateMissing(missing, VISIBLE_ROWS);
  const [showAll, setShowAll] = useState(false);
  const rows = showAll ? missing : visible;

  const [reasonCode, setReasonCode] = useState<ForceSealReasonCode | null>(null);
  const [reasonNote, setReasonNote] = useState('');
  const [rowNotes, setRowNotes] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const noteOk = !reasonCode || !requiresNote(reasonCode) || reasonNote.trim().length > 0;
  const canClose = reasonCode !== null && noteOk && !isSealing;

  const handleRowNote = (orderId: string, value: string) => {
    setRowNotes((prev) => {
      const next = new Map(prev);
      if (value) next.set(orderId, value);
      else next.delete(orderId);
      return next;
    });
  };

  const handleClose = async () => {
    if (!reasonCode) return;
    setError(null);
    const note = buildForceSealNote(reasonCode, reasonNote, rowNotes, missing);
    const outcome = await seal(routeId, { force: true, reason_code: reasonCode, note });
    if (!outcome.ok) {
      setError(outcome.message ?? 'No se pudo cerrar la ruta');
      return;
    }
    onSealed({ sealedStops: outcome.sealedStops, ordersClosed: outcome.ordersClosed });
    onClose();
  };

  const dockLabel = loadPositionLabel ?? 'el andén';

  return (
    <div className="flex flex-col gap-4 pt-2">
      <SheetHeader className="text-left">
        <SheetTitle className="font-mono text-[15px]">{routeCode} · Cerrar con faltantes</SheetTitle>
        <SheetDescription>Esta ruta no se puede volver a abrir después de cerrarla.</SheetDescription>
      </SheetHeader>

      {/* decision 2 — las tres consecuencias, nunca un resumen. */}
      <ul className="flex flex-col gap-2 rounded-[10px] border border-status-warning-border bg-status-warning-bg p-3.5 text-[13px] text-status-warning-text">
        <li>
          Los {totalMissingBoxes} paquetes se quedan en el andén {dockLabel} y hay que meterlos en otra ruta.
        </li>
        <li>Los {packagesLoaded} cargados pasan a listo para despacho.</li>
        <li>La ruta no se puede volver a abrir.</li>
      </ul>

      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div
            key={row.orderId}
            data-testid="close-sheet-missing-row"
            className="flex flex-col gap-1.5 rounded-[10px] border border-border bg-surface p-3"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] text-accent">{row.orderNumber}</span>
              <span className="text-[11px] font-semibold text-status-warning-text">
                {row.missingCount} sin cargar
              </span>
            </div>
            {row.contactName && <span className="text-[12.5px] text-text-secondary">{row.contactName}</span>}
            <label htmlFor={`close-note-${row.orderId}`} className="sr-only">
              Nota para {row.orderNumber}
            </label>
            <input
              id={`close-note-${row.orderId}`}
              type="text"
              value={rowNotes.get(row.orderId) ?? ''}
              onChange={(e) => handleRowNote(row.orderId, e.target.value)}
              placeholder="Nota (opcional)"
              className="h-9 w-full rounded-md border border-border bg-background px-2.5 text-[12.5px] text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        ))}
        {!showAll && remaining > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="min-h-[40px] self-start text-[12.5px] font-medium text-accent underline decoration-dotted underline-offset-4"
          >
            Ver los {remaining} restantes
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">Motivo</span>
        <div role="radiogroup" aria-label="Motivo del cierre" className="flex flex-col gap-1.5">
          {FORCE_SEAL_REASON_CODES.map((code) => (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={reasonCode === code}
              aria-label={FORCE_SEAL_REASON_LABELS[code]}
              onClick={() => setReasonCode(code)}
              className={`flex min-h-[44px] w-full items-center rounded-[10px] border px-3 text-left text-[13px] font-medium active:opacity-90 ${
                reasonCode === code ? 'border-accent bg-accent-light text-accent' : 'border-border bg-surface text-text'
              }`}
            >
              {FORCE_SEAL_REASON_LABELS[code]}
            </button>
          ))}
        </div>
        {reasonCode && requiresNote(reasonCode) && (
          <div className="flex flex-col gap-1">
            <label htmlFor="close-reason-note" className="text-[11.5px] text-text-muted">
              Detalle del motivo
            </label>
            <textarea
              id="close-reason-note"
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder="Describe qué pasó"
              className="min-h-[64px] w-full rounded-[10px] border border-border bg-background p-2.5 text-[13px] text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
        )}
      </div>

      {error && <p className="text-[13px] text-status-error-text">{error}</p>}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[56px] w-full rounded-[10px] bg-accent text-[15px] font-semibold text-accent-foreground active:opacity-90"
        >
          Seguir escaneando
        </button>
        <button
          type="button"
          onClick={handleClose}
          disabled={!canClose}
          className="min-h-[48px] w-full rounded-[10px] border border-status-error-border text-[13.5px] font-semibold text-status-error-text disabled:cursor-not-allowed disabled:opacity-50 active:opacity-90"
        >
          {isSealing ? 'Cerrando…' : closeButtonLabel(totalMissingBoxes)}
        </button>
      </div>
    </div>
  );
}
