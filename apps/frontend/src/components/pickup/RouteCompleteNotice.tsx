import { CheckCircle2 } from 'lucide-react';

/**
 * spec-54 phase 4.6 fix — the "next manifest" card previously fell back to
 * `routeManifests[0]` once every manifest was fully verified, so a finished
 * route still showed "Siguiente manifiesto … 2/2" with a "Verificar" CTA:
 * advertising work that no longer exists. This is the explicit
 * route-complete state instead — no fabricated next step.
 */
export function RouteCompleteNotice() {
  return (
    <div
      data-testid="route-complete-notice"
      className="flex items-center gap-3 rounded-lg border border-status-success-border bg-status-success-bg p-4"
    >
      <CheckCircle2 className="h-6 w-6 shrink-0 text-status-success-text" aria-hidden="true" />
      <p className="text-sm font-medium text-status-success-text">
        Todo verificado. Cierra la ruta cuando estés listo.
      </p>
    </div>
  );
}
