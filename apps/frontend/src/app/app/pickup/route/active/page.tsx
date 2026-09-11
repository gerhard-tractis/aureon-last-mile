'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { onlineManager } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';
import {
  useRouteManifests,
  useUnassignedManifests,
} from '@/hooks/pickup/useRouteManifests';
import { useAddManifestToRoute } from '@/hooks/pickup/useAddManifestToRoute';
import { useRemoveManifestFromRoute } from '@/hooks/pickup/useRemoveManifestFromRoute';
import { useClosePickupRoute } from '@/hooks/pickup/useClosePickupRoute';
import {
  useDownloadedManifestIds,
  useDownloadManifest,
} from '@/hooks/pickup/useManifestDownload';
import { useNextManifestPickupAddress } from '@/hooks/pickup/useNextManifestPickupAddress';
import { selectNextManifest } from '@/lib/pickup/nextManifestSelection';
import { matchesRouteManifestQuery, hasActiveRouteSearchQuery } from '@/lib/pickup/routeManifestSearch';
import { RouteProgressHeader } from '@/components/pickup/RouteProgressHeader';
import { RouteMapPlaceholder } from '@/components/pickup/RouteMapPlaceholder';
import { NextManifestCard } from '@/components/pickup/NextManifestCard';
import { RouteCompleteNotice } from '@/components/pickup/RouteCompleteNotice';
import { UpcomingManifestList } from '@/components/pickup/UpcomingManifestList';
import { RouteManifestPanel } from '@/components/pickup/RouteManifestPanel';
import { RouteFooterTopRow } from '@/components/pickup/RouteFooterTopRow';
import { AddManifestSheet } from '@/components/pickup/AddManifestSheet';
import { CloseRouteButton } from '@/components/pickup/CloseRouteButton';
import { CancelRouteButton } from '@/components/pickup/CancelRouteButton';
import { toast } from 'sonner';

const MANIFEST_LIST_PANEL_ID = 'route-manifest-list-panel';
const SEARCH_INPUT_ID = 'route-manifest-search-input';

export default function ActiveRoutePage() {
  const router = useRouter();
  const { operatorId, userId } = useOperatorId();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const {
    data: route,
    isLoading: routeLoading,
    isError: routeError,
    refetch: refetchRoute,
  } = useActivePickupRoute(operatorId);
  const { data: routeManifests = [], isLoading: rmLoading } = useRouteManifests(
    route?.id ?? null,
    operatorId,
  );
  const { data: unassigned = [], isLoading: unLoading } =
    useUnassignedManifests(operatorId);
  const addMut = useAddManifestToRoute(operatorId);
  const removeMut = useRemoveManifestFromRoute(operatorId);
  const closeMut = useClosePickupRoute(operatorId);
  // spec-82 fase 2 (mock 5c) — "DESCARGAR". `downloadedIdsList` puede ser
  // `undefined` mientras la lectura local no resuelve; el `Set` que arma
  // `useMemo` conserva ese `undefined` tal cual (nunca `?? []`) para que
  // RouteManifestList siga sabiendo distinguir "no lo sé todavía" de "nada
  // descargado" — ver su docstring.
  const { data: downloadedIdsList } = useDownloadedManifestIds(operatorId);
  const downloadedIds = useMemo(
    () => (downloadedIdsList ? new Set(downloadedIdsList) : undefined),
    [downloadedIdsList],
  );
  const downloadMut = useDownloadManifest(operatorId);
  // B2, ronda 4 — la PÁGINA controla qué filas muestran DESCARGAR
  // deshabilitado, no `downloadMut.isPending`/`variables` (sólo describe
  // UNA descarga a la vez; ver el docstring de `downloadingIds` en
  // RouteManifestList).
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  // Computed here (before the early returns below), not further down where
  // the rest of the render logic lives — spec-95 fase 3's map panel needs
  // `nextManifest.external_load_id` to call a hook, and hooks cannot be
  // called after a conditional `return`. See selectNextManifest's docstring.
  const { nextIndex, nextManifest, routeComplete, upcoming } =
    selectNextManifest(routeManifests);

  // spec-95 fase 3 (mock 5c panel de mapa) — el panel cuelga de la carga
  // SIGUIENTE, no de toda la ruta; ver el docstring del hook para por qué
  // la dirección sale de pickup_points y no de manifests.pickup_location.
  const { data: nextManifestAddress } = useNextManifestPickupAddress(
    operatorId,
    nextManifest?.external_load_id ?? null,
  );

  if (routeLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  // spec-61: a FAILED lookup is not an empty one. The route now comes from a
  // single RPC, so one bad response -- a missing function, a stale PostgREST
  // schema cache, a dropped connection -- fails the whole thing, and after
  // React Query exhausts its retries `data` is undefined with `isLoading`
  // false. Falling through to the empty state below would tell a leader who
  // HAS an open route that they do not, which is the 3j double-open this task
  // exists to prevent. Offer the retry instead.
  if (routeError) {
    return (
      <div className="w-full p-6 max-w-2xl mx-auto space-y-4 text-center">
        <p className="text-text">No pudimos cargar tu ruta.</p>
        <div className="flex items-center justify-center gap-2">
          <Button onClick={() => refetchRoute()}>Reintentar</Button>
          <Button variant="outline" onClick={() => router.push('/app/pickup')}>
            Volver
          </Button>
        </div>
      </div>
    );
  }

  if (!route) {
    return (
      <div className="w-full p-6 max-w-2xl mx-auto space-y-4 text-center">
        <p className="text-text">No tienes una ruta activa.</p>
        <Button onClick={() => router.push('/app/pickup')}>Volver</Button>
      </div>
    );
  }

  const totalVerified = routeManifests.reduce((s, m) => s + m.verified_count, 0);

  const goToScan = (loadId: string) =>
    router.push(`/app/pickup/scan/${encodeURIComponent(loadId)}`);

  const handleAdd = (manifestId: string) => {
    addMut.mutate(
      { routeId: route.id, manifestId },
      {
        onSuccess: () => {
          toast.success('Manifiesto agregado');
          setSheetOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  // spec-64 Task 4 — the counterpart to handleAdd. Passed to
  // RouteManifestList UNCONDITIONALLY (not gated on route.driver_id === userId
  // like CancelRouteButton below): crew can add manifests through the
  // ungated AddManifestSheet, so gating removal to the driver would let a
  // crew member attach a carga and then be unable to detach the one they
  // just mis-attached. The RPC's own authorisation block is the real gate —
  // it deliberately admits crew too.
  const handleRemove = (manifestId: string) => {
    removeMut.mutate(
      { routeId: route.id, manifestId },
      {
        onSuccess: () => toast.success('Carga quitada de la ruta'),
        onError: (err) => toast.error(err.message),
      },
    );
  };

  // spec-82 fase 2 — "DESCARGAR". `manifestId` marca la fila en
  // `downloadingIds` (deshabilita SÓLO ese chip); `externalLoadId` es la
  // clave real de la mutación.
  //
  // M1 (decisión del usuario) — sin señal, `networkMode: 'online'` deja la
  // mutación pausada para siempre sin `onSuccess`/`onError`: se niega de
  // entrada en vez de colgarse invisible.
  //
  // B1, ronda 5 de review del PR #727 — `mutateAsync` + `.finally`, no
  // `mutate(id, { onSettled })`: los callbacks pasados a `mutate()` no
  // vuelven a correr si un SEGUNDO `mutate()` arranca antes de que el
  // primero resuelva (`MutationObserver` desengancha el observer previo en
  // cada llamada). La promesa de `mutateAsync` es por-invocación y siempre
  // se asienta. Ver `page.download.concurrent.test.tsx` para el mecanismo
  // completo y la prueba contra el `useMutation` real.
  const handleDownload = (manifestId: string, externalLoadId: string) => {
    if (!onlineManager.isOnline()) {
      toast.error('Sin conexión: no se puede descargar. Busca señal e inténtalo de nuevo.');
      return;
    }
    setDownloadingIds((prev) => new Set(prev).add(manifestId));
    downloadMut
      .mutateAsync(externalLoadId)
      // Nit, ronda 6 de review del PR #727 — `.then(onSuccess, onError)`
      // (dos argumentos), no `.then(onSuccess).catch(onError)`: con
      // `.catch` encadenado, una excepción LANZADA DENTRO de `onSuccess`
      // (p. ej. si `toast.success` fallara) caería en el mismo `onError` y
      // mostraría "No se pudo descargar" sobre una descarga que sí quedó
      // en IndexedDB. La forma de dos argumentos sólo invoca `onError`
      // cuando la promesa de `mutateAsync` RECHAZA — misma exclusividad
      // que tenía `mutate(id, { onSuccess, onError })`.
      .then(
        () => toast.success(`${externalLoadId} descargada para trabajar sin red`),
        // Menor, revisión de fase 2 — no repetir el mensaje crudo de
        // PostgREST (códigos, nombres de columna/constraint) al operario;
        // no le ayuda a decidir nada y expone detalles internos.
        () => toast.error(`No se pudo descargar ${externalLoadId}. Inténtalo de nuevo.`),
      )
      .finally(() => {
        setDownloadingIds((prev) => {
          const next = new Set(prev);
          next.delete(manifestId);
          return next;
        });
      })
      // Si el propio `toast.success`/`toast.error` de arriba lanzara, esa
      // rama de `.then` rechaza y `.finally` reenvía el rechazo — sin este
      // `.catch` final, quedaría como una promesa no manejada. El chip ya
      // se liberó (el `.finally` de arriba corre siempre); aquí no queda
      // nada más que hacer con ese error.
      .catch(() => {});
  };

  const handleClose = () => {
    closeMut.mutate(
      { routeId: route.id },
      {
        onSuccess: () => {
          router.push(`/app/pickup/route/${route.id}/qr`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  // spec-95 fase 2 — abrir la búsqueda también revela el panel (si no lo
  // estaba ya): sin esto, tocar "Buscar" con la lista colapsada tecleaba
  // contra un panel invisible. Cerrarla NO la vuelve a colapsar — el
  // conductor pudo haber encontrado lo que buscaba y quiere seguir viendo
  // la lista completa.
  const handleToggleSearch = () => {
    setSearchOpen((open) => {
      const next = !open;
      if (next) {
        setShowAll(true);
      } else {
        setQuery('');
      }
      return next;
    });
  };

  const manifestListVisible = routeManifests.length === 0 || showAll;

  // M3, review — "Luego" usa el MISMO predicado que el panel (no uno
  // propio): sólo la tarjeta destacada arriba queda exenta, como en
  // PickupMobileActiveRoute.tsx.
  const visibleUpcoming = hasActiveRouteSearchQuery(query)
    ? upcoming.filter((m) => matchesRouteManifestQuery(m, query))
    : upcoming;

  // H2, review — el pie ya no son "dos botones de 40px": fila superior
  // 44px + Cerrar ruta 44px + Cancelar ruta 40px + padding ≈ 184-200px
  // (teléfono/`sm`). `pb-56` (224px) cubre ambos con margen — si no, la
  // última fila de manifiestos queda bajo la barra fija.
  return (
    <div className="w-full p-4 sm:p-6 max-w-2xl mx-auto space-y-4 pb-56" data-testid="active-route-page">
      <RouteProgressHeader route={route} manifests={routeManifests} isLoading={rmLoading} />

      {/* spec-95 fase 3 (mock 5c) — `nextManifestAddress` es `undefined`
          mientras la query está en curso; se normaliza a `null` aquí (no
          antes) para que RouteMapPlaceholder nunca reciba un dato a medio
          cargar como si fuera una dirección real. */}
      <RouteMapPlaceholder pickupLocation={nextManifestAddress ?? null} />

      {rmLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </div>
      ) : (
        <>
          {nextManifest && (
            <NextManifestCard manifest={nextManifest} index={nextIndex} onVerify={goToScan} />
          )}
          {routeComplete && <RouteCompleteNotice />}

          <UpcomingManifestList manifests={visibleUpcoming} />

          {manifestListVisible && (
            <RouteManifestPanel
              panelId={MANIFEST_LIST_PANEL_ID}
              searchInputId={SEARCH_INPUT_ID}
              manifests={routeManifests}
              searchOpen={searchOpen}
              query={query}
              onQueryChange={setQuery}
              onManifestClick={goToScan}
              // Only wired once operatorId has resolved: useRemoveManifestFromRoute
              // keys its cache invalidation off it, and a null operatorId
              // would invalidate queries that match nothing (a trait it
              // shares with useAddManifestToRoute / useCancelPickupRoute).
              onRemove={operatorId ? handleRemove : undefined}
              isRemoving={removeMut.isPending}
              downloadedIds={downloadedIds}
              onDownload={handleDownload}
              downloadingIds={downloadingIds}
            />
          )}
        </>
      )}

      <AddManifestSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        manifests={unassigned}
        isLoading={unLoading}
        isAdding={addMut.isPending}
        onPick={handleAdd}
      />

      <div className="fixed bottom-0 inset-x-0 bg-background border-t border-border p-4 sm:p-6">
        {/* space-y-3: "Cancelar ruta" es destructivo y va justo debajo del
            CTA de rutina "Cerrar ruta". Pegados, son dos objetivos de 40px
            a ancho completo separados por el ancho de un pulgar en un
            teléfono sostenido con una mano, con sólo el diálogo de
            confirmación entre un toque errado y desenganchar todos los
            manifiestos de la ruta. 3h ya los separa
            (`flex flex-col gap-4`); esta superficie no lo hacía. */}
        {/* M2, review — el orden (Cerrar ruta antes que Cancelar ruta) es
            el criterio de la fase; `data-testid` propio para comprobar
            POSICIÓN, no sólo presencia. */}
        <div className="max-w-2xl mx-auto space-y-3" data-testid="route-footer-stack">
          <RouteFooterTopRow
            manifestsCount={routeManifests.length}
            showAll={showAll}
            manifestListPanelId={manifestListVisible ? MANIFEST_LIST_PANEL_ID : undefined}
            onToggleShowAll={() => setShowAll((v) => !v)}
            searchOpen={searchOpen}
            searchInputId={searchOpen ? SEARCH_INPUT_ID : undefined}
            onToggleSearch={handleToggleSearch}
            onOpenAdd={() => setSheetOpen(true)}
          />

          <CloseRouteButton
            totalVerified={totalVerified}
            isSubmitting={closeMut.isPending}
            onClose={handleClose}
          />
          {/* spec-61 Task 5 — the exit for a route that should not have been
              opened. Task 7 stopped offering routed loads to anyone else, so
              without this the loads sit locked to an abandoned route until
              someone opens psql.

              Only the route's own LEADER sees it: `driver_id` is the leader,
              and a crew member cancelling the trip out from under everyone
              is not a thing this spec grants. `!!userId` first — comparing
              two undefineds would read as "this is my route".

              Defence in depth, not the only gate: cancel_pickup_route
              enforces the same rule server-side since migration
              20260821000001 (driver, or an elevated role). See
              useCancelPickupRoute.ts. */}
          {!!userId && route.driver_id === userId && (
            <CancelRouteButton
              routeId={route.id}
              operatorId={operatorId}
              onCancelled={() => router.push('/app/pickup')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
