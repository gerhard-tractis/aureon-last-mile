'use client';

import Link from 'next/link';
import { useEnRutaSnapshot } from '@/hooks/dispatch/useEnRutaSnapshot';
import { EnRutaMetricsRow } from './EnRutaMetricsRow';
import { EnRutaTable } from './EnRutaTable';
import { RouteSkeleton } from './RouteSkeleton';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

/**
 * Artboard `1d` — "En ruta". Decision 5: what's already in DispatchTrack,
 * ordered by what's going wrong, with "Completadas hoy" as a filtered
 * section of the same table rather than a second tab.
 *
 * Deliberately absent, and why (spec-75 phase 5 — verify-before-build):
 * - **"cierre estimado del día 19:40"** — an ETA projection from the
 *   OR-Tools optimiser, which has no frontend wiring (`RoutePlanCanvas`
 *   already documents this for `1a`).
 * - **"DT SINCRONIZADO · 12 s"** — no table in this schema records when
 *   `dispatchtrack-route-poll` last ran; the function updates `routes`/
 *   `dispatches` rows in place and logs to stdout only, leaving nothing a
 *   client can read back as a sync timestamp.
 * Both would otherwise have to come from an invented value or a proxy
 * (e.g. `routes.updated_at`, already shown to drift for reasons unrelated
 * to a sync — see spec-76's added lesson) — neither renders.
 */
export function DispatchEnRutaTab({ operatorId }: { operatorId: string }) {
  const today = todayISOInTimezone();
  const { data, isLoading } = useEnRutaSnapshot(operatorId, today);

  if (isLoading || !data) {
    return <RouteSkeleton rowClass="h-16" />;
  }

  const { enRuta, completadasHoy, metrics, fallidasSinReingreso } = data;
  const totalParadas = enRuta.reduce((sum, r) => sum + r.paradasTotal, 0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-heading text-lg font-semibold text-text">Rutas en ruta</h2>
        <p className="text-sm text-text-secondary">
          {enRuta.length} {pluralize(enRuta.length, 'ruta', 'rutas')} · {totalParadas} paradas
        </p>
      </div>

      <EnRutaMetricsRow metrics={metrics} />

      <EnRutaTable enRuta={enRuta} completadas={completadasHoy} />

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-text-secondary">
        <span>
          {enRuta.length} en ruta · {completadasHoy.length} completadas
          {fallidasSinReingreso > 0 && ` · ${fallidasSinReingreso} fallidas sin reingreso registrado`}
        </span>
        {fallidasSinReingreso > 0 && (
          <Link href="/app/orders?vista=reingresos" className="font-medium text-accent hover:underline">
            Ver reingresos pendientes
          </Link>
        )}
      </div>
    </div>
  );
}
