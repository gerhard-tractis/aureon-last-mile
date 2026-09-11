'use client';

import { RouteManifestList, type RouteManifestRow } from './RouteManifestList';

/**
 * spec-95 fase 2 (mock 5c) — extraído de `route/active/page.tsx` para
 * mantenerlo bajo 300 líneas tras sumar el pie de dos filas (mismo patrón
 * de split por tamaño que la fase 1 ya documentó para RouteManifestCard).
 * Sin cambio de comportamiento: es el mismo bloque que vivía inline
 * (encabezado "Manifiestos en la ruta" + campo de búsqueda + la lista o el
 * aviso de "sin resultados"), movido tal cual.
 *
 * "Buscar" en el mock es un ícono sin contraparte de comportamiento en
 * ningún spec anterior — el mock sólo lo dibuja. Se cablea con el mismo
 * patrón ya establecido en esta misma app para el mismo problema
 * (PickupMobileActiveRoute.tsx, PickupMobileStartRoute.tsx): un campo
 * inline que filtra por código/cliente/punto de recogida.
 */
function matchesRouteManifestQuery(m: RouteManifestRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    m.external_load_id.toLowerCase().includes(q) ||
    (m.retailer_name ?? '').toLowerCase().includes(q) ||
    (m.pickup_location ?? '').toLowerCase().includes(q)
  );
}

interface RouteManifestPanelProps {
  panelId: string;
  manifests: RouteManifestRow[];
  searchOpen: boolean;
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
  query,
  onQueryChange,
  onManifestClick,
  onRemove,
  isRemoving,
  downloadedIds,
  onDownload,
  downloadingIds,
}: RouteManifestPanelProps) {
  const searching = query.trim().length > 0;
  const filteredManifests = searching
    ? manifests.filter((m) => matchesRouteManifestQuery(m, query))
    : manifests;
  // Distinto de "Sin manifiestos en la ruta" (RouteManifestList.tsx): ese
  // texto es válido cuando la ruta genuinamente no tiene cargas, y sería
  // una mentira si lo que pasó es que la búsqueda no encontró nada entre
  // cargas que sí existen.
  const noSearchResults = searching && filteredManifests.length === 0;

  return (
    <div id={panelId}>
      <h2 className="text-sm font-semibold text-text mb-2">Manifiestos en la ruta</h2>
      {searchOpen && (
        <input
          type="search"
          aria-label="Buscar carga"
          autoFocus
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
          manifests={filteredManifests}
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
