'use client';

import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/EmptyState';
import { isManifestComplete } from '@/lib/pickup/manifestProgress';
import { groupManifestsByRetailer } from '@/lib/pickup/routeManifestGrouping';
import { ManifestCard } from './RouteManifestCard';

/** Mirrors `manifest_status_enum` (packages/database/supabase/migrations/
 *  20260310100000_create_pickup_verification_tables.sql:33). */
export type ManifestStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface RouteManifestRow {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  /** Free-text pickup address (manifests.pickup_location). Null when not
   *  captured at intake — never fabricate a value when absent. */
  pickup_location: string | null;
  total_orders: number | null;
  /** Null when intake (OCR or manual) never recorded a package count — an
   *  unknown denominator, not zero. Callers must not read null as "complete". */
  total_packages: number | null;
  /** Count of verified pickup_scans for this manifest. */
  verified_count: number;
  /** spec-54 3h (mobile) — real lifecycle state from `manifests.status`,
   *  used to sort cards and choose a status badge. Optional because callers
   *  that predate this field (this list's own rows here) still work without
   *  it; added for the mobile card view, which needs a genuine status
   *  rather than deriving one from verified_count. */
  status?: ManifestStatus;
  /** spec-54 3h redesign — `manifests.completed_at`, for the compact
   *  completed row's "cerrada HH:MM". Optional/undefined for callers that
   *  never fetch it (this list does not need it); null when the DB column
   *  itself is null (not yet completed). */
  completed_at?: string | null;
  /** spec-54 3h redesign — count of `discrepancy_notes` rows for this
   *  manifest, for the compact completed row's "N notas". This is a note
   *  count, not a full discrepancy count: `discrepancy_notes` is written
   *  only when a driver manually types a note about a missing package, and
   *  it excludes `not_found`/unexpected scans (a different figure, tracked
   *  in `pickup_scans` via `useDiscrepancies`). Optional/undefined for
   *  callers that never fetch it (this list does not need it) — render
   *  `undefined` as unknown, never as a fabricated 0. */
  discrepancy_count?: number;
  /** spec-80 fase 2b — `manifests.signature_operator`. Optional/undefined
   *  for callers that never fetch it (unknown — never read as "needs
   *  rescue"); `null` only when the caller DID fetch it and the column is
   *  genuinely empty. That distinction is load-bearing: a manifest whose
   *  `status` was flipped to `'completed'` by
   *  `trg_route_receptions_status_sync` (spec-80 fase 1's H1 rescue) WITHOUT
   *  ever going through the Firma screen has `signature_operator: null` —
   *  that is the signal `needsSignatureRescue` (pickupMobileHelpers.ts)
   *  uses to surface it on mobile. Reading `undefined` the same way would
   *  wrongly flag every manifest a caller never asked about. */
  signature_operator?: string | null;
}

/** spec-95 fase 1 (mock 5c) — el estado que pinta el chip de cabecera de
 *  cada grupo de cliente. */
export type GroupStatus = 'completada' | 'en_ruta' | 'pendiente';

/**
 * La regla única de chip por grupo. Definida en un solo sitio y testeada
 * como unidad (ver RouteManifestList.test.tsx) — nada de esto se repite ni
 * se decide de nuevo en el render.
 *
 * Regla A, «por progreso» — decisión del usuario/diseñador, 2026-09-11. El
 * mock de `5c` resultó inconsistente (Ripley llevaba `EN RUTA` con su única
 * carga marcada `DESCARGAR`, pero bajo esa misma lectura Paris también
 * debería haber llevado `EN RUTA`; el diseñador confirmó el error). La regla
 * elegida no mira descarga en absoluto — es ortogonal al progreso de
 * escaneo y se sigue resolviendo aparte, por manifiesto, con el chip
 * `DESCARGAR` de spec-82 fase 2, que esta función no toca. Se prefirió esta
 * regla sobre un chip `SIGUIENTE` a nivel de grupo porque hubiera
 * duplicado la pastilla `SIGUIENTE` que ya lleva la tarjeta destacada del
 * manifiesto siguiente — el operario ya ve la próxima parada ahí.
 *
 * - `completada` — todas las cargas del grupo están cerradas
 *   (`isManifestComplete`).
 * - `en_ruta` — alguna carga tiene escaneo empezado (`verified_count > 0`)
 *   Y esa misma carga no está cerrada.
 * - `pendiente` — el resto, incluido el grupo vacío (caso de frontera) y el
 *   caso en que la única carga con escaneos ya cerró y ninguna otra tiene
 *   escaneos.
 */
export function groupManifestStatus(manifests: RouteManifestRow[]): GroupStatus {
  if (manifests.length === 0) return 'pendiente';
  if (manifests.every((m) => isManifestComplete(m))) return 'completada';

  const someStartedAndOpen = manifests.some(
    (m) => m.verified_count > 0 && !isManifestComplete(m),
  );
  return someStartedAndOpen ? 'en_ruta' : 'pendiente';
}

const GROUP_STATUS_LABEL: Record<GroupStatus, string> = {
  completada: 'COMPLETADA',
  en_ruta: 'EN RUTA',
  pendiente: 'PENDIENTE',
};

const GROUP_STATUS_CLASSNAME: Record<GroupStatus, string> = {
  completada: 'border-status-success-border bg-status-success-bg text-status-success-text',
  en_ruta: 'border-accent bg-accent-muted text-accent-emphasis',
  pendiente: 'border-border-strong bg-surface text-text-secondary',
};

interface RouteManifestListProps {
  manifests: RouteManifestRow[];
  onManifestClick: (externalLoadId: string) => void;
  /**
   * spec-64 Task 3 — removes a carga from the open route. Optional and
   * additive: when omitted, no remove control renders at all, so every
   * existing caller is unaffected. Only offered per-row when
   * `verified_count === 0` — one verified scan means the carga is
   * physically on the truck and the server (`remove_manifest_from_route`)
   * refuses the removal, so offering the button then would be a lie.
   */
  onRemove?: (manifestId: string) => void;
  /**
   * spec-64 review fix 1(a) — true while a removal mutation is in flight.
   * Disables the remove trigger so a driver's double-tap (the row and its
   * X stay mounted until the invalidated `route-manifests` query refetches)
   * cannot fire a second `mutate` for the same manifest and surface the
   * server's guard-6 refusal. Optional and additive, same as `onRemove` —
   * existing callers that omit it get an always-enabled trigger.
   */
  isRemoving?: boolean;
  /**
   * spec-82 fase 2 (mock 5c) — `external_load_id` de las cargas ya
   * descargadas al dispositivo para trabajar sin red. Tres estados, no dos:
   * `undefined` significa "todavía no lo sé" (la lectura local de
   * `manifest_cache` no resolvió) y NO pinta el chip `DESCARGAR` — pintarlo
   * afirmaría "no descargada" sobre una carga que sí podría estarlo. Un
   * `Set` (aunque esté vacío) significa que la respuesta ya se conoce.
   * Optativo y aditivo, mismo patrón que `onRemove`: sin `onDownload` no se
   * ofrece el chip aunque `downloadedIds` esté resuelto.
   *
   * spec-95 fase 1, decisión del usuario/diseñador 2026-09-11 — esta prop
   * ya NO participa en `groupManifestStatus` (el chip de grupo). La regla A
   * elegida allí es ortogonal a la descarga local: sigue resolviéndose
   * únicamente aquí, por manifiesto.
   */
  downloadedIds?: Set<string>;
  /**
   * Colisión con `COMPLETADA` (misma nota que fase 1): cuando ambos
   * predicados aplicarían a la vez por un dato inconsistente, gana
   * `COMPLETADA` — es el estado autoritativo del servidor, `DESCARGAR` es
   * sólo una comodidad local. Ver "Colisión con COMPLETADA" en el spec.
   */
  onDownload?: (manifestId: string, externalLoadId: string) => void;
  /**
   * `manifest.id` de cada descarga en curso — deshabilita SÓLO esas filas,
   * no toda la lista (mismo patrón por-fila que `isRemoving`, que sí es
   * global porque sólo puede haber una remoción en curso a la vez; aquí dos
   * descargas distintas pueden solaparse).
   *
   * Menor, revisión de fase 2 (ronda 4) — antes era un `string | null`
   * derivado de `useMutation().isPending`/`variables`, que sólo puede
   * describir UNA descarga en curso: lanzar una segunda mientras la primera
   * seguía volando pisaba ese id y reactivaba el chip equivocado. Un `Set`
   * sostiene tantas descargas concurrentes como filas existan.
   */
  downloadingIds?: Set<string>;
  /**
   * spec-95 fase 2, corrección H1 de review — `manifest.id` de las filas
   * que deben pintarse (típicamente el resultado de un filtro de búsqueda
   * hecho por el caller). Deliberadamente NO filtra qué entra a
   * `groupManifestsByRetailer`/`groupManifestStatus`: el chip de grupo y
   * "N puntos · M paquetes" se calculan SIEMPRE sobre `manifests` completo,
   * nunca sobre el subconjunto visible — el bug que esto corrige era
   * exactamente pasar ya-filtrado aquí adentro, con lo que un grupo con una
   * carga cerrada (buscada) y otra abierta (oculta por el filtro) se pintaba
   * `COMPLETADA` en vez de `PENDIENTE`. Mismo principio que
   * `fullGroupsByClient` en PickupMobileStartRoute.tsx: el estado agregado
   * de un grupo se deriva de su membresía real, no de lo que el filtro deja
   * ver. `undefined` (el default) es "no estoy filtrando" — pinta todas las
   * filas de cada grupo, comportamiento idéntico al de antes de esta fase.
   * Un grupo cuyas filas quedan todas ocultas por el filtro no se pinta en
   * absoluto (ni cabecera ni filas) — el caller decide aparte qué mostrar
   * cuando NINGÚN grupo tiene coincidencias (ver RouteManifestPanel.tsx).
   */
  visibleManifestIds?: Set<string>;
}

/**
 * Shows every manifest currently linked to the active route, with its
 * verified/expected progress. Each row jumps into the per-manifest scan
 * flow so the driver can continue verification.
 */
export function RouteManifestList({
  manifests,
  onManifestClick,
  onRemove,
  isRemoving = false,
  downloadedIds,
  onDownload,
  downloadingIds,
  visibleManifestIds,
}: RouteManifestListProps) {
  if (manifests.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="Sin manifiestos en la ruta"
        description="Agrega manifiestos para empezar a verificar paquetes."
      />
    );
  }

  return (
    <div className="space-y-3" data-testid="route-manifest-list">
      {groupManifestsByRetailer(manifests).map((group) => {
        // Siempre sobre el grupo COMPLETO — ver el docstring de
        // `visibleManifestIds` arriba. `status`, `pointCount` y
        // `packageCount` nunca deben verse afectados por qué filas terminan
        // visibles.
        const status = groupManifestStatus(group.manifests);
        const visibleRows = visibleManifestIds
          ? group.manifests.filter((m) => visibleManifestIds.has(m.id))
          : group.manifests;
        if (visibleRows.length === 0) return null;
        return (
          <div
            key={group.retailerName}
            className="space-y-3"
            data-testid="route-manifest-group"
          >
            {/* spec-95 fase 1 (mock 5c) — cabecera de grupo: nombre, "N
                puntos · M paquetes" y el chip de la regla única. No hay
                slot de botón aquí: la ronda 2 del mock quita "Ver carga" y
                deja el chip como único contenido de esa esquina en los
                cuatro casos. */}
            <div className="flex items-center gap-3 rounded-[13px] border border-border bg-surface-raised px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                {/* Review finding 4 (a11y) — este es el encabezado real de
                    la jerarquía visual (cabecera de grupo, cliente); la fila
                    de cada manifiesto debajo usa <h4>. Antes era al revés:
                    la fila llevaba <h3> y esto era un <p> sin jerarquía,
                    invertido respecto a lo que se ve en pantalla. */}
                <h3 className="truncate text-[15px] font-semibold text-text">
                  {group.retailerName}
                </h3>
                <p className="truncate text-[13.5px] text-text-secondary">
                  {group.pointCount} {group.pointCount === 1 ? 'punto' : 'puntos'} ·{' '}
                  {group.packageCount} {group.packageCount === 1 ? 'paquete' : 'paquetes'}
                </p>
              </div>
              <span
                data-testid="route-manifest-group-status"
                className={cn(
                  'flex-none rounded-md border px-2 py-1.5 font-mono text-[12px] font-semibold',
                  GROUP_STATUS_CLASSNAME[status],
                )}
              >
                {GROUP_STATUS_LABEL[status]}
              </span>
            </div>

            {visibleRows.map((m) => (
              <ManifestCard
                key={m.id}
                manifest={m}
                onManifestClick={onManifestClick}
                onRemove={onRemove}
                isRemoving={isRemoving}
                downloadedIds={downloadedIds}
                onDownload={onDownload}
                downloadingIds={downloadingIds}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
