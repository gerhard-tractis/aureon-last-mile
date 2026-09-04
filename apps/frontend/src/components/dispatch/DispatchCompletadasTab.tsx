'use client';

import { useEnRutaSnapshot } from '@/hooks/dispatch/useEnRutaSnapshot';
import { EnRutaTable } from './EnRutaTable';
import { RouteSkeleton } from './RouteSkeleton';
import { todayISOInTimezone } from '@/lib/utils/dateFormat';

/**
 * "Completadas" tab. Coordinator correction on phase 5: the canvas draws
 * this as its own tab on `1a`/`1b`/`1d` alike — decision 5 only rules out a
 * second *component tree* for it, not the tab. This component and
 * `DispatchEnRutaTab` both render the same `EnRutaTable`, just with a
 * different (enRuta, completadas) slice — "una tabla con un filtro, no dos
 * tablas" — instead of the removed `DispatchCompletedRoutesTab`'s own grid
 * of `RouteListTile`s.
 *
 * Shares `useEnRutaSnapshot`'s query cache with `DispatchEnRutaTab` (same
 * `operatorId`/`date` key) — switching tabs does not refetch.
 */
export function DispatchCompletadasTab({ operatorId }: { operatorId: string }) {
  const today = todayISOInTimezone();
  const { data, isLoading } = useEnRutaSnapshot(operatorId, today);

  if (isLoading || !data) {
    return <RouteSkeleton rowClass="h-16" />;
  }

  return (
    <EnRutaTable
      enRuta={[]}
      completadas={data.completadas}
      emptyTitle="Sin rutas completadas hoy"
      emptyDescription="Las rutas que terminen o se cancelen hoy aparecerán aquí."
    />
  );
}
