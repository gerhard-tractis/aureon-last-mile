import { Truck } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { EnRutaLastEvent } from './EnRutaLastEvent';
import type { EnRutaRoute } from '@/lib/dispatch/en-ruta';

const HEADERS = ['RUTA', 'CONDUCTOR · CAMIÓN', 'COMUNAS', 'PARADAS', 'FALLIDAS', 'ÚLTIMO EVENTO'];

function RouteRow({ route }: { route: EnRutaRoute }) {
  const driverTruck = [route.driverName ?? 'Sin conductor', route.truckIdentifier]
    .filter(Boolean)
    .join(' · ');

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2.5 font-mono text-sm font-semibold text-accent">
        {route.externalRouteId ?? route.id.slice(0, 8).toUpperCase()}
      </td>
      <td className="px-4 py-2.5 text-sm text-text">{driverTruck}</td>
      <td className="px-4 py-2.5 text-sm text-text-secondary">
        {route.comunas.length ? route.comunas.join(', ') : '—'}
      </td>
      <td className="px-4 py-2.5 font-mono text-sm text-text">
        {route.paradasCompletadas}/{route.paradasTotal}
      </td>
      <td className={`px-4 py-2.5 font-mono text-sm ${route.fallidas > 0 ? 'font-semibold text-status-error-text' : 'text-text-secondary'}`}>
        {route.fallidas}
      </td>
      <td className="px-4 py-2.5 text-sm">
        <EnRutaLastEvent lastEventAt={route.lastEventAt} />
      </td>
    </tr>
  );
}

/**
 * Artboard `1d`'s table. Decision 5: "Completadas hoy" is a filtered
 * section at the foot of this same table, not a second tab with its own
 * tree — one `<table>`, one header row, a divider, then the completed rows.
 *
 * Ordering is the caller's responsibility (`sortEnRutaRoutes` in
 * `lib/dispatch/en-ruta.ts`) — this component renders rows in the order
 * it's given, so the incidence-first ordering stays testable independently
 * of markup.
 */
export function EnRutaTable({ enRuta, completadas }: { enRuta: EnRutaRoute[]; completadas: EnRutaRoute[] }) {
  if (!enRuta.length && !completadas.length) {
    return (
      <EmptyState icon={Truck} title="Sin rutas en camino" description="Las rutas despachadas aparecerán aquí." />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border">
            {HEADERS.map((h) => (
              <th key={h} className="px-4 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-text-secondary">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {enRuta.map((route) => (
            <RouteRow key={route.id} route={route} />
          ))}
          {completadas.length > 0 && (
            <tr className="border-b border-t-2 border-border bg-surface-raised">
              <td colSpan={HEADERS.length} className="px-4 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-text-secondary">
                <span>COMPLETADAS HOY</span> <span className="text-text">{completadas.length}</span>
              </td>
            </tr>
          )}
          {completadas.map((route) => (
            <RouteRow key={route.id} route={route} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
