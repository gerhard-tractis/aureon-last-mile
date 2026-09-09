import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { pendingLoadsLabel } from '@/lib/pickup/manifestCloseSummary';

export interface ManifestClosedSummaryProps {
  loadId: string;
  retailerName: string | null;
  verifiedCount: number;
  missingCount: number;
  unexpectedCount: number;
  photosCount: number;
  signaturesCount: number;
  routeExternalId: string | null;
  pendingRouteCount: number;
  nextManifestLabel: string | null;
  onBackToRoute: () => void;
}

/**
 * spec-80 fase 5 — `5i`, "Móvil · carga cerrada, cierre del proceso (vuelve
 * a 5c)". Validated against `docs/design/Recogida.dc.html`.
 *
 * Ronda 2 de review del PR #726 — two things this component does NOT do,
 * on purpose, after review:
 *
 * - No "Guardado en el teléfono" block. The spec (`:1062`) is explicit that
 *   this is spec-81's to build and should be omitted until then — a first
 *   version built it anyway. Worse than just disobeying the spec: the
 *   photo half would have been structurally always "0 fotos", because
 *   `enqueueManifestPhoto` (spec-81 fase 5) has no production caller yet
 *   (`ManifestPhotoStrip` still uploads straight to the bucket, per
 *   `useManifestDocuments.ts`) — a driver closing offline right after
 *   photographing the signed sheet would read "0 fotos esperan señal" on
 *   the exact screen that is supposed to reassure them the evidence is
 *   safe, when in truth it either already uploaded or was silently lost in
 *   the window `complete/[loadId]/page.tsx` itself documents. Removed
 *   rather than shipped half-true.
 * - "Ver resumen de la carga" is a non-interactive `<span>`, matching the
 *   mock (`Recogida.dc.html`, this exact element is a `<span>`, not a
 *   button). A first version wired it to a `Button` with an `onClick` that
 *   scrolled to a card already fully visible at the top of the screen —
 *   a control indistinguishable from a live one that does nothing when
 *   pressed, on the screen that closes a custody transfer. No destination
 *   for it exists anywhere in the codebase; inventing one was not this
 *   phase's call to make.
 *
 * The remaining conditional block:
 * - "Sigue en PR-…" only when the route this manifest belonged to still has
 *   another load pending — an operator who just closed the LAST load on
 *   their route has nothing to "sigue en". Route completion itself is
 *   `/app/pickup/route/active`'s own `RouteCompleteNotice`, not this
 *   screen's job to duplicate.
 */
export function ManifestClosedSummary({
  loadId,
  retailerName,
  verifiedCount,
  missingCount,
  unexpectedCount,
  photosCount,
  signaturesCount,
  routeExternalId,
  pendingRouteCount,
  nextManifestLabel,
  onBackToRoute,
}: ManifestClosedSummaryProps) {
  const showRouteBlock = routeExternalId != null && pendingRouteCount > 0;

  return (
    <div className="space-y-4 p-4 sm:p-6 max-w-2xl mx-auto" data-testid="manifest-closed-summary">
      <div className="flex flex-col items-center gap-4 pt-6 pb-2">
        <span className="grid h-[76px] w-[76px] place-items-center rounded-full border-2 border-status-success-border bg-status-success-bg">
          <CheckCircle2 className="h-9 w-9 text-status-success-text" aria-hidden="true" />
        </span>
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-xl font-semibold text-text">Carga cerrada</span>
          <span className="font-mono text-sm font-semibold text-text-secondary">
            {retailerName ? `${loadId} · ${retailerName}` : loadId}
          </span>
        </div>
      </div>

      <div className="flex flex-col rounded-2xl border border-border bg-surface overflow-hidden">
        <SummaryRow
          testId="summary-row-verified"
          label="Verificados"
          value={verifiedCount}
          valueClassName="text-status-success-text"
        />
        <SummaryRow
          testId="summary-row-missing"
          label="Faltantes"
          value={missingCount}
          valueClassName="text-status-error-text"
        />
        <SummaryRow
          testId="summary-row-unexpected"
          label="Ajenos a la carga"
          value={unexpectedCount}
          valueClassName="text-status-warning-text"
        />
        <SummaryRow
          testId="summary-row-backup"
          label="Respaldo"
          value={`${photosCount} fotos · ${signaturesCount} firmas`}
          last
        />
      </div>

      {showRouteBlock && (
        <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3">
          <span className="text-sm font-semibold text-text">Sigue en {routeExternalId}</span>
          <span className="text-[13.5px] text-text-secondary">
            {pendingLoadsLabel(pendingRouteCount)}
            {nextManifestLabel ? ` · ${nextManifestLabel} es la próxima` : ''}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-3 pt-2">
        <Button type="button" className="w-full" size="lg" onClick={onBackToRoute}>
          Volver a mis recogidas
        </Button>
        {/* Literal del mock: un `<span>` decorativo, no un control — ver el
            comentario de esta fase arriba. */}
        <span className="text-center font-semibold text-[15px] text-text-secondary border border-border rounded-[13px] min-h-[52px] flex items-center justify-center px-4">
          Ver resumen de la carga
        </span>
      </div>
    </div>
  );
}

function SummaryRow({
  testId,
  label,
  value,
  valueClassName,
  last,
}: {
  testId: string;
  label: string;
  value: number | string;
  valueClassName?: string;
  last?: boolean;
}) {
  return (
    <div
      data-testid={testId}
      className={`flex items-center gap-3 min-h-[52px] px-4 py-2.5 ${
        last ? '' : 'border-b border-border'
      }`}
    >
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      <span className={`ml-auto font-mono text-sm font-semibold text-text ${valueClassName ?? ''}`}>
        {value}
      </span>
    </div>
  );
}
