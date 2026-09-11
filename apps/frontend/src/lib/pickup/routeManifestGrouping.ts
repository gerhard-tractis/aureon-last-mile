import { sumExpected } from '@/lib/pickup/manifestProgress';
import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';

/**
 * spec-95 fase 1 (mock 5c) — agrupación por cliente de la ruta ACTIVA
 * (`RouteManifestList`/`5c`). Extraída de `RouteManifestList.tsx` en la
 * revisión de fase 1 (2026-09-11), sólo por tamaño (regla de 300 líneas) —
 * mismo patrón de capas que `pickupStartRouteGrouping.ts`, que hace lo
 * mismo para la pantalla `3j` (pre-ruta) sobre un tipo distinto
 * (`ManifestRow`, agregados siempre no-nulos de `get_pending_manifests`).
 * Esta agrupación trabaja sobre `RouteManifestRow`, cuyos totales SÍ pueden
 * ser `null` (OCR/manual intake) — de ahí `sumExpected` en vez de sumar a
 * mano.
 */

// Mismas cadenas que `pickupStartRouteGrouping.ts` usa para los mismos dos
// conceptos (`NO_CLIENT`/`NO_POINT`) en `3j` — el conductor ve ambas
// pantallas en el mismo flujo.
export const NO_CLIENT = 'Sin cliente';
export const NO_POINT = 'Sin punto de recogida';

export interface ManifestGroup {
  retailerName: string;
  pointCount: number;
  /** `number` cuando se conoce el total del grupo; `'—'` (nunca un número
   *  fabricado) cuando algún manifiesto tiene `total_packages: null`. */
  packageCount: number | string;
  manifests: RouteManifestRow[];
}

/**
 * Agrupa por `retailer_name`, en el orden de PRIMERA aparición de cada
 * retailer, sin reordenar los manifiestos dentro de cada grupo — igual que
 * necesita `page.tsx` para calcular "la próxima carga" sobre el orden de
 * `useRouteManifests` (created_at ascendente).
 *
 * `retailer_name: ''` se trata igual que `null` (ambos → `NO_CLIENT`,
 * mismo grupo): un `??` sólo captura `null`/`undefined`, y la columna es
 * TEXT sin constraint contra `''`. Revisión de fase 1 (2026-09-11) — antes
 * `'' ?? 'Retailer desconocido'` dejaba pasar la cadena vacía (cabecera sin
 * nombre) y abría un segundo grupo, separado de los `null`, para cargas
 * igualmente anónimas.
 *
 * `pointCount` cuenta `pickup_location` distintos (un `null` cuenta como un
 * único punto "desconocido", nunca se descarta).
 *
 * `packageCount` usa `sumExpected` (manifestProgress.ts) — mismo helper que
 * `RouteProgressHeader.tsx`/`PickupMobileActiveRoute.tsx` ya usan para este
 * problema. Revisión de fase 1 (2026-09-11): un `total_packages: null` es
 * desconocido, no cero; `?? 0` presentaba una suma PARCIAL como si fuera el
 * total del grupo (dos cargas, una con total conocido y otra sin intake,
 * pintaban "42 paquetes" en la cabecera mientras esa fila mostraba "0/—" al
 * lado).
 */
export function groupManifestsByRetailer(manifests: RouteManifestRow[]): ManifestGroup[] {
  const groups: ManifestGroup[] = [];
  const byName = new Map<string, ManifestGroup>();
  for (const m of manifests) {
    const retailerName = m.retailer_name || NO_CLIENT;
    let group = byName.get(retailerName);
    if (!group) {
      group = { retailerName, pointCount: 0, packageCount: 0, manifests: [] };
      byName.set(retailerName, group);
      groups.push(group);
    }
    group.manifests.push(m);
  }
  for (const group of groups) {
    const points = new Set(group.manifests.map((m) => m.pickup_location ?? '__unknown__'));
    group.pointCount = points.size;
    const { knownExpectedSum, hasUnknownExpected } = sumExpected(group.manifests);
    group.packageCount = hasUnknownExpected ? '—' : knownExpectedSum;
  }
  return groups;
}
