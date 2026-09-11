'use client';

import { Package, ShoppingCart, X } from 'lucide-react';
import { isManifestComplete, progressLabel } from '@/lib/pickup/manifestProgress';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { RouteManifestRow } from './RouteManifestList';

/**
 * Extraído de `RouteManifestList.tsx` en spec-95 fase 1, sólo por tamaño
 * (regla de 300 líneas — mismo motivo documentado en
 * `RouteManifestList.download.test.tsx`): la agrupación por cliente que esa
 * fase añade empujó el fichero por encima del límite. Una sola tarjeta de
 * manifiesto, sin cambios de comportamiento respecto a lo que ya existía
 * dentro de `RouteManifestList`.
 */
export interface ManifestCardProps {
  manifest: RouteManifestRow;
  onManifestClick: (externalLoadId: string) => void;
  onRemove?: (manifestId: string) => void;
  isRemoving: boolean;
  downloadedIds?: Set<string>;
  onDownload?: (manifestId: string, externalLoadId: string) => void;
  downloadingIds?: Set<string>;
}

export function ManifestCard({
  manifest: m,
  onManifestClick,
  onRemove,
  isRemoving,
  downloadedIds,
  onDownload,
  downloadingIds,
}: ManifestCardProps) {
  const complete = isManifestComplete(m);
  const canRemove = !!onRemove && m.verified_count === 0;
  // spec-82 fase 2 — colisión con COMPLETADA (anotada en fase 1):
  // gana COMPLETADA. `downloadedIds === undefined` es "todavía no lo
  // sé" y nunca pinta DESCARGAR — ver el docstring de la prop.
  const showDownload =
    !complete && !!onDownload && !!downloadedIds && !downloadedIds.has(m.external_load_id);
  // Menor, revisión de fase 2 — `downloadedIds` puede seguir siendo
  // `undefined` ("todavía no lo sé"); `!!downloadedIds` primero
  // asegura que esto nunca sea `true` en ese caso.
  const isDownloaded = !!downloadedIds && downloadedIds.has(m.external_load_id);
  return (
    <div
      // hover:border-accent-light, not hover:border-accent/50: this
      // file's colour tokens are bare `var(--color-…)` values with no
      // <alpha-value> channel, so a Tailwind opacity modifier here
      // emits no CSS at all (same root cause as the map placeholder's
      // border fix). accent-light is a real, already-defined token.
      className="relative rounded-lg border border-border bg-surface transition-colors hover:border-accent-light"
    >
      <button
        type="button"
        onClick={() => onManifestClick(m.external_load_id)}
        className="w-full text-left p-4 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex items-center justify-between gap-3 pr-11">
          <div className="min-w-0">
            {/* spec-95 fase 1 — la cabecera de grupo ya muestra
                `retailer_name`; repetirlo aquí por manifiesto era
                redundante y, agrupado, ambiguo para cualquier query por
                texto. El punto de recogida es la identidad propia de esta
                fila (mock 5c). Nunca fabricar un punto: cuando
                `pickup_location` es null (no capturado al ingreso), cae a
                un texto explícito de "sin registrar", nunca al nombre del
                retailer ni al id de carga — ambos ya se muestran en algún
                otro lugar de esta misma fila/cabecera y duplicarlos aquí
                volvería a introducir el mismo texto ambiguo que esto
                reemplaza. */}
            <h3 className="font-semibold text-text truncate">
              {m.pickup_location ?? 'Punto de recogida sin registrar'}
            </h3>
            <p className="font-mono text-xs text-text-secondary mt-0.5">
              {m.external_load_id}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm text-text-secondary shrink-0">
            <div className="flex items-center gap-1">
              <ShoppingCart className="h-4 w-4" />
              <span className="font-mono">{m.total_orders ?? 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <Package className="h-4 w-4" />
              <span className="font-mono">{progressLabel(m)}</span>
            </div>
            {/* spec-82 fase 1 (mock 5c) — same chip PickupMobileCompactRow
                already shows for its `completed` variant on the 3h
                screen, reused verbatim for visual consistency. */}
            {complete && (
              <span className="flex-none rounded border border-status-success-border bg-status-success-bg px-1.5 py-1 font-mono text-[10.5px] font-semibold text-status-success-text">
                COMPLETADA
              </span>
            )}
            {/* Menor, revisión de fase 2 — antes, la ausencia del
                chip significaba a la vez "descargada", "completada" y
                "todavía no lo sé": tres estados reales colapsados en
                un mismo vacío visual. Este estado afirmativo saca
                "descargada" de esa ambigüedad; COMPLETADA sigue
                ganando la colisión (mismo orden que showDownload). */}
            {!complete && isDownloaded && (
              <span className="flex-none rounded border border-border bg-surface-raised px-1.5 py-1 font-mono text-[10.5px] font-semibold text-text-secondary">
                DESCARGADA
              </span>
            )}
          </div>
        </div>
      </button>
      {showDownload && (
        // Sibling del <button> principal, no anidado dentro — un
        // <button> dentro de otro <button> es HTML inválido, y el
        // chip necesita su propio manejador de click que NO dispare
        // onManifestClick. Bajo el contenido en vez de superpuesto
        // arriba a la derecha (donde vive el control de "quitar")
        // porque ambos pueden estar visibles a la vez en la misma
        // fila (una carga recién agregada, sin escanear y sin
        // descargar) y no deben competir por el mismo espacio.
        <div className="px-4 pb-3 flex justify-end">
          <button
            type="button"
            aria-label={`Descargar ${m.external_load_id}`}
            disabled={downloadingIds?.has(m.id) ?? false}
            onClick={() => onDownload!(m.id, m.external_load_id)}
            className="flex-none rounded-md border border-status-warning-border bg-status-warning-bg px-2.5 py-2 font-mono text-[11px] font-semibold text-status-warning-text disabled:opacity-50 disabled:pointer-events-none"
          >
            DESCARGAR
          </button>
        </div>
      )}
      {canRemove && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              aria-label={`Quitar ${m.external_load_id} de la ruta en curso`}
              disabled={isRemoving}
              className="absolute right-1 top-1 grid h-11 w-11 place-items-center rounded text-text-secondary hover:bg-status-error-bg hover:text-status-error-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:pointer-events-none"
            >
              <X className="h-4 w-4" />
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Quitar esta carga de la ruta?</AlertDialogTitle>
              <AlertDialogDescription>
                {m.external_load_id} vuelve a la lista de cargas pendientes y puede
                agregarse de nuevo a esta u otra ruta.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => onRemove(m.id)}>
                Quitar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
