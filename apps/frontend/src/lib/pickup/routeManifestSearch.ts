import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';

/**
 * spec-95 fase 2 (mock 5c), corrección M1/M3 de review — extraído de
 * `RouteManifestPanel.tsx` para que `route/active/page.tsx` pueda aplicar
 * el MISMO predicado al filtrar "Luego" (`UpcomingManifestList`), que hasta
 * la corrección no se filtraba en absoluto: buscar "Acme" dejaba el panel
 * mostrando sólo Acme mientras "Luego", justo encima, seguía listando Beta
 * sin tocar. Mismo patrón que `PickupMobileActiveRoute.tsx` — la tarjeta
 * destacada (hero) es la única exenta del filtro, con su propia razón
 * (es la acción primaria de la pantalla, independiente de qué se busque).
 *
 * `query.trim()` en ambos lados (el gate `hasQuery` de abajo y aquí adentro)
 * es intencional y no redundante: un gate sin `trim()` cuenta una query de
 * sólo espacios como "búsqueda activa" y, si el predicado de adentro SÍ
 * recorta antes de comparar, una entrada como `"Acme "` (espacio final —
 * plausible viniendo de un lector que no recorta) fallaría contra
 * `"acme"` y mostraría "sin resultados" con Acme realmente en la ruta.
 */
export function matchesRouteManifestQuery(m: RouteManifestRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    m.external_load_id.toLowerCase().includes(q) ||
    (m.retailer_name ?? '').toLowerCase().includes(q) ||
    (m.pickup_location ?? '').toLowerCase().includes(q)
  );
}

export function hasActiveRouteSearchQuery(query: string): boolean {
  return query.trim().length > 0;
}
