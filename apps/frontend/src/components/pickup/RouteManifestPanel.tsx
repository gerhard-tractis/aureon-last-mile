'use client';

import { RouteManifestList, type RouteManifestRow } from './RouteManifestList';
import { matchesRouteManifestQuery, hasActiveRouteSearchQuery } from '@/lib/pickup/routeManifestSearch';

/**
 * spec-95 fase 2 (mock 5c) — extraído de `route/active/page.tsx` para
 * mantenerlo bajo 300 líneas tras sumar el pie de dos filas (mismo patrón
 * de split por tamaño que la fase 1 ya documentó para RouteManifestCard).
 *
 * NO es un movimiento sin cambio de comportamiento: el campo de búsqueda y
 * el aviso "sin resultados" son nuevos en esta fase — `a89cada` (fase 1)
 * no tenía ningún camino de filtrado. "Buscar" en el mock es un ícono sin
 * contraparte de comportamiento en ningún spec anterior — el mock sólo lo
 * dibuja. Se cablea con el mismo patrón ya establecido en esta misma app
 * para el mismo problema (PickupMobileActiveRoute.tsx,
 * PickupMobileStartRoute.tsx): un campo inline que filtra por
 * código/cliente/punto de recogida.
 *
 * H1, corrección de review — `manifests` que llega aquí SIEMPRE es la lista
 * completa de la ruta, nunca pre-filtrada: filtrar antes de agrupar rompía
 * el chip de grupo y "N puntos · M paquetes" (`RouteManifestList` los
 * calcula sobre lo que recibe). Un grupo con una carga cerrada que matchea
 * la búsqueda y otra abierta que no, filtrado ANTES de agrupar, se pintaba
 * `COMPLETADA` — mentira, porque la carga abierta seguía ahí, sólo oculta.
 * La búsqueda aquí sólo decide QUÉ FILAS se pintan dentro de cada grupo
 * (`visibleManifestIds`, ver RouteManifestList.tsx) — el estado agregado
 * del grupo se sigue derivando de su membresía real.
 */
interface RouteManifestPanelProps {
  panelId: string;
  manifests: RouteManifestRow[];
  searchOpen: boolean;
  /** id del `<input type="search">` cuando está montado — sólo un idref
   *  real cuando `searchOpen` es true, mismo patrón que `manifestListPanelId`
   *  en RouteFooterTopRow.tsx (L4, review). */
  searchInputId: string;
  query: string;
  onQueryChange: (query: string) => void;
  onManifestClick: (externalLoadId: string) => void;
  onRemove?: (manifestId: string) => void;
  isRemoving?: boolean;
  downloadedIds?: Set<string>;
  onDownload?: (manifestId: string, externalLoadId: string) => void;
  downloadingIds?: Set<string>;
}

export function RouteManifestPanel({
  panelId,
  manifests,
  searchOpen,
  searchInputId,
  query,
  onQueryChange,
  onManifestClick,
  onRemove,
  isRemoving,
  downloadedIds,
  onDownload,
  downloadingIds,
}: RouteManifestPanelProps) {
  const searching = hasActiveRouteSearchQuery(query);
  // H1 — nunca se filtra `manifests` antes de agrupar; sólo se calcula QUÉ
  // ids son visibles, y ese set se pasa tal cual a RouteManifestList para
  // que decida fila por fila sin tocar el cálculo de grupo.
  const visibleManifestIds = searching
    ? new Set(
        manifests.filter((m) => matchesRouteManifestQuery(m, query)).map((m) => m.id),
      )
    : undefined;
  // Distinto de "Sin manifiestos en la ruta" (RouteManifestList.tsx): ese
  // texto es válido cuando la ruta genuinamente no tiene cargas, y sería
  // una mentira si lo que pasó es que la búsqueda no encontró nada entre
  // cargas que sí existen.
  const noSearchResults = searching && (visibleManifestIds?.size ?? 0) === 0;

  return (
    <div id={panelId}>
      <h2 className="text-sm font-semibold text-text mb-2">Manifiestos en la ruta</h2>
      {searchOpen && (
        <input
          id={searchInputId}
          type="search"
          aria-label="Buscar carga"
          autoFocus
          // N6 de PickupMobileActiveRoute.tsx (review round 3), H3 aquí — el
          // campo monta arriba mientras su disparador ("Buscar") vive en la
          // barra fija de abajo; en una ruta larga el panel abre fuera de
          // pantalla. `autoFocus` mueve el foco de teclado pero no el
          // viewport en toda plataforma, así que se hace explícito.
          ref={(el) => el?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar por código, cliente o punto de retiro…"
          className="mb-2 min-h-[44px] w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-text placeholder:text-text-muted"
        />
      )}
      {noSearchResults ? (
        <p className="text-sm text-text-secondary" role="status">
          Sin resultados para la búsqueda.
        </p>
      ) : (
        <RouteManifestList
          manifests={manifests}
          visibleManifestIds={visibleManifestIds}
          onManifestClick={onManifestClick}
          onRemove={onRemove}
          isRemoving={isRemoving}
          downloadedIds={downloadedIds}
          onDownload={onDownload}
          downloadingIds={downloadingIds}
        />
      )}
    </div>
  );
}
