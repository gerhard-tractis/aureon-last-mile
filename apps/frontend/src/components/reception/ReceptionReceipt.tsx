'use client';

import { CheckCircle2, PackageCheck, AlertTriangle } from 'lucide-react';
import { finalizeRule } from '@/lib/reception/finalize-rule';
import type { RouteReceptionSnapshot } from '@/hooks/reception/useRouteReceptionSnapshot';
import type { IncomingRoute } from '@/hooks/reception/useIncomingRoutes';

/**
 * spec-62 Task 21 — the acta an operator sees after closing a reception
 * (mock 3p). The last screen of the flow: no fetching, no mutations. Task 22
 * wires `snapshot`/`nextYardRoute` from data and gives this a route.
 *
 * The four figures are the real `route_receptions` columns, not a recount:
 * an unexpected package increments `received_count` too, so
 * `expected - received` silently double-counts it away. `missing` comes
 * from `finalizeRule` for that reason — see `@/lib/reception/finalize-rule`
 * for the worked example (88 expected · 86 received · 1 unexpected = 3
 * missing, not 2).
 *
 * Section titles ("NOTA DE DISCREPANCIA", "QUÉ PASA AHORA", "QUEDA 1 RUTA EN
 * PATIO") are literal uppercase text, not a CSS `uppercase` transform — a
 * transform lets the DOM text stay mixed-case while rendering uppercase, so
 * a test asserting exact text silently stops asserting the moment someone
 * edits the copy. Keep all three the same way.
 */
export interface ReceptionReceiptProps {
  snapshot: RouteReceptionSnapshot;
  nextYardRoute: IncomingRoute | null;
  onBack: () => void;
  onOpenRoute: () => void;
}

export function ReceptionReceipt({
  snapshot,
  nextYardRoute,
  onBack,
  onOpenRoute,
}: ReceptionReceiptProps) {
  const { route, route_reception: reception, manifests } = snapshot;
  const { expected_count, received_count, unexpected_count, discrepancy_notes } = reception;
  const { matched, missing } = finalizeRule({
    expectedCount: expected_count,
    receivedCount: received_count,
    unexpectedCount: unexpected_count,
  });
  const reconciled = missing === 0 && unexpected_count === 0;

  const rows: { testId: string; label: string; value: number }[] = [
    { testId: 'acta-esperados', label: 'Esperados', value: expected_count },
    { testId: 'acta-recibidos', label: 'Recibidos', value: received_count },
    { testId: 'acta-faltantes', label: 'Faltantes', value: missing },
    { testId: 'acta-ajenos', label: 'Ajenos a la ruta', value: unexpected_count },
  ];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-col items-center gap-2 py-2">
        <div
          className="grid h-[74px] w-[74px] place-items-center rounded-full bg-status-success-bg text-status-success"
          aria-hidden="true"
        >
          <CheckCircle2 className="h-10 w-10" strokeWidth={2} />
        </div>
        <h1 className="font-heading text-[23px] font-semibold leading-tight text-text">
          Recepción cerrada
        </h1>
        <p className="text-sm text-text-secondary">
          {route.code}
          {route.driver_name ? ` · ${route.driver_name}` : ''}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border">
        {rows.map((row) => (
          <div
            key={row.testId}
            data-testid={row.testId}
            className="flex h-[52px] items-center justify-between border-b border-border px-4 last:border-b-0"
          >
            <span className="text-sm text-text-secondary">{row.label}</span>
            <span className="font-heading text-[18px] font-semibold text-text">{row.value}</span>
          </div>
        ))}
      </div>

      {discrepancy_notes && (
        // data-testid kept even though no unit test here asserts it yet —
        // Task 25's Playwright spec for the acta needs a stable selector.
        <div
          data-testid="acta-nota"
          className="rounded-lg border border-status-warning-border bg-status-warning-bg p-3"
        >
          <p className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-[.05em] text-status-warning-text">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            NOTA DE DISCREPANCIA
          </p>
          <p className="text-sm text-text">{discrepancy_notes}</p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface-raised p-3">
        <p className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-[.05em] text-text-secondary">
          <PackageCheck className="h-4 w-4" aria-hidden="true" />
          QUÉ PASA AHORA
        </p>
        <p className="text-sm text-text">
          {manifests.length} carga{manifests.length === 1 ? '' : 's'} cerrada{manifests.length === 1 ? '' : 's'}, {matched} paquete{matched === 1 ? '' : 's'} pasan a
          clasificación.
          {reconciled
            ? ' El conteo cuadró: no quedan diferencias abiertas.'
            : ' Las diferencias quedan registradas en la nota de discrepancia.'}
        </p>
      </div>

      {nextYardRoute && (
        // Same as acta-nota above: an unearned-looking testid reserved for
        // Task 25's e2e spec, not dead weight.
        <div
          data-testid="acta-siguiente-ruta"
          className="flex items-center justify-between rounded-lg border border-border bg-surface p-3"
        >
          <div>
            <p className="text-xs font-semibold tracking-[.05em] text-text-secondary">
              QUEDA 1 RUTA EN PATIO
            </p>
            <p className="text-sm font-medium text-text">{nextYardRoute.code}</p>
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="h-[60px] w-full rounded-[14px] bg-accent-light text-[15px] font-semibold text-accent-light-foreground transition-opacity hover:opacity-90"
        >
          Volver a recepción
        </button>
        <button
          type="button"
          onClick={onOpenRoute}
          className="h-[48px] w-full rounded-[14px] border border-border bg-surface text-[14px] font-medium text-text transition-colors active:bg-surface-raised"
        >
          Ver detalle de la ruta
        </button>
      </div>
    </div>
  );
}
