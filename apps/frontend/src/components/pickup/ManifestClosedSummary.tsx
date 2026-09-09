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
  /** null when the pending-sync figures have not resolved yet — same as
   *  "no queue" for rendering purposes, the row does not flash in and out. */
  pendingSync: { records: number; photos: number } | null;
  routeExternalId: string | null;
  pendingRouteCount: number;
  nextManifestLabel: string | null;
  onBackToRoute: () => void;
  onViewSummary: () => void;
}

/**
 * spec-80 fase 5 — `5i`, "Móvil · carga cerrada, cierre del proceso (vuelve
 * a 5c)". Validated against `docs/design/Recogida.dc.html`.
 *
 * Two blocks are conditional, not literal-always like the summary card:
 * - "Guardado en el teléfono" only when something is actually queued
 *   (`pendingSync` has a non-zero total) — the mock draws it non-empty, but
 *   a clean online close has nothing waiting for signal, and showing an
 *   empty warning would be a false alarm.
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
  pendingSync,
  routeExternalId,
  pendingRouteCount,
  nextManifestLabel,
  onBackToRoute,
  onViewSummary,
}: ManifestClosedSummaryProps) {
  const pendingSyncTotal = pendingSync ? pendingSync.records + pendingSync.photos : 0;
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
        <SummaryRow label="Verificados" value={verifiedCount} valueClassName="text-status-success-text" />
        <SummaryRow label="Faltantes" value={missingCount} valueClassName="text-status-error-text" />
        <SummaryRow
          label="Ajenos a la carga"
          value={unexpectedCount}
          valueClassName="text-status-warning-text"
        />
        <SummaryRow
          label="Respaldo"
          value={`${photosCount} fotos · ${signaturesCount} firmas`}
          last
        />
      </div>

      {pendingSyncTotal > 0 && (
        <div className="flex items-center gap-3 rounded-xl bg-status-warning-bg border border-status-warning-border p-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-sm font-semibold text-status-warning-text">
              Guardado en el teléfono
            </span>
            <span className="text-sm text-status-warning-text">
              {pendingSync!.records} registros y {pendingSync!.photos} fotos esperan señal para
              subir
            </span>
          </div>
        </div>
      )}

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
        <Button type="button" variant="outline" className="w-full" onClick={onViewSummary}>
          Ver resumen de la carga
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  valueClassName,
  last,
}: {
  label: string;
  value: number | string;
  valueClassName?: string;
  last?: boolean;
}) {
  return (
    <div
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
