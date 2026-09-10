'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ScannerInput } from '@/components/pickup/ScannerInput';
import { ScanHistoryList } from '@/components/pickup/ScanHistoryList';
import { ScanResultPopup } from '@/components/pickup/ScanResultPopup';
import { ScanResultCard } from '@/components/pickup/ScanResultCard';
import { usePickupScans, useScanMutation } from '@/hooks/pickup/usePickupScans';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { retryBlockedManifest } from '@/hooks/useOfflineQueue';
import { createSPAClient } from '@/lib/supabase/client';
import { XCircle, Clock, ArrowLeft, Printer } from 'lucide-react';
import { useManifestOrders } from '@/hooks/pickup/useManifestOrders';
import { useLatestScanResult } from '@/hooks/pickup/useLatestScanResult';
import { ManifestDetailList } from '@/components/pickup/ManifestDetailList';
import { PickupFlowHeader } from '@/components/pickup/PickupFlowHeader';
import { PickupStepBreadcrumb } from '@/components/pickup/PickupStepBreadcrumb';
import { toast } from 'sonner';
import { useModuleEnabled } from '@/hooks/modules/useEnabledModules';
import { ModuleKey } from '@/lib/modules/registry';
import { useOfflineScanSource } from '@/hooks/pickup/useOfflineScanSource';
import { ManifestNotDownloadedNotice } from '@/components/pickup/ManifestNotDownloadedNotice';

/** DD/MM HH:MM, a mano — ver el comentario donde se usa: Intl/toLocaleString
 * varía el padding de día/mes entre entornos de ICU, y esto sólo necesita
 * ser legible, no localizado. */
function formatDownloadedAt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ScanningPage() {
  const params = useParams();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId as string);
  const { operatorId } = useOperatorId();

  const [manifestId, setManifestId] = useState<string | null>(null);
  const [totalPackages, setTotalPackages] = useState(0);
  const [pickupRouteId, setPickupRouteId] = useState<string | null>(null);
  const [retailerName, setRetailerName] = useState<string | null>(null);
  const [pickupPoint, setPickupPoint] = useState<string | null>(null);
  const [showNotFoundPopup, setShowNotFoundPopup] = useState(false);
  const [startTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState('00:00');
  const [userId, setUserId] = useState<string | null>(null);

  // spec-54 mock 1h — real device queue state for the "COLA N" badge.
  // spec-81 fase 1: `useSyncQueue` now also counts `db.pickup_queue`, the
  // Recogida offline queue that lives in this same IndexedDB database (see
  // PickupFlowHeader's `queuedCount` doc comment). No writer populates
  // `db.pickup_queue` from this screen yet — that's spec-81 fase 2 — so
  // `queuedCount` is still 0 in practice, but the count is correct
  // infrastructure rather than a hard-coded value waiting on a rewrite.
  const sync = useSyncQueue(operatorId);

  // spec-82 fase 2 — "DESCARGAR" (mock 5c/5d). Inerte mientras hay señal
  // (ver el docstring del hook): el flujo online de abajo no cambia en
  // absoluto. Sin red, decide entre tres estados — "todavía no lo sé",
  // "nunca se descargó" (bloquea) y "aquí está el snapshot" — nunca sólo
  // dos, para no pintar "no descargada" sobre una carga que sí lo está.
  const offline = useOfflineScanSource(operatorId, loadId, sync.status === 'offline');

  // spec-53 — second entry point. Labels are normally printed from the pickup
  // list before departure, but the crew also needs them here: this is the
  // screen they are on when they discover a label is missing or unreadable.
  const labelsEnabled = useModuleEnabled(operatorId, ModuleKey.PACKAGE_LABELS);

  useEffect(() => {
    if (!operatorId) return;
    // spec-82 fase 2 — sin red no hay nada que este fetch pueda traer;
    // `offline.snapshot` (si existe) alimenta las mismas variables más
    // abajo. Evita una llamada de red condenada a quedar pendiente/fallar.
    if (sync.status === 'offline') return;
    const supabase = createSPAClient();
    supabase
      .from('manifests')
      .select('id, total_packages, pickup_route_id, retailer_name, pickup_location')
      .eq('operator_id', operatorId)
      .eq('external_load_id', loadId)
      .is('deleted_at', null)
      .single()
      .then(({ data }) => {
        if (data) {
          setManifestId(data.id);
          setTotalPackages(data.total_packages ?? 0);
          setPickupRouteId(
            (data as { pickup_route_id: string | null }).pickup_route_id ?? null
          );
          setRetailerName((data as { retailer_name: string | null }).retailer_name ?? null);
          setPickupPoint(
            (data as { pickup_location: string | null }).pickup_location ?? null
          );
        }
      });
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, [operatorId, loadId, sync.status]);

  useEffect(() => {
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const mins = String(Math.floor(diff / 60)).padStart(2, '0');
      const secs = String(diff % 60).padStart(2, '0');
      setElapsed(`${mins}:${secs}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  // spec-82 fase 2 — sin red, el snapshot local reemplaza por completo lo
  // que el fetch de red (arriba) y `useManifestOrders` (abajo) no pueden
  // traer. Con red, `offline.snapshot` es siempre `null` (ver el hook) y
  // estas líneas no cambian nada del comportamiento existente.
  const effectiveManifestId = offline.snapshot ? offline.snapshot.manifestId : manifestId;
  const effectiveTotalPackages = offline.snapshot
    ? (offline.snapshot.totalPackages ?? 0)
    : totalPackages;
  const effectivePickupRouteId = offline.snapshot
    ? offline.snapshot.pickupRouteId
    : pickupRouteId;
  const effectiveRetailerName = offline.snapshot ? offline.snapshot.retailerName : retailerName;
  const effectivePickupPoint = offline.snapshot ? offline.snapshot.pickupLocation : pickupPoint;

  const { data: scans = [] } = usePickupScans(effectiveManifestId, operatorId);
  const scanMutation = useScanMutation();

  const {
    data: orders = [],
    isLoading: ordersLoading,
    isError: ordersError,
    refetch: refetchOrders,
  } = useManifestOrders(sync.status === 'offline' ? null : loadId, operatorId);

  const effectiveOrders = offline.snapshot ? offline.snapshot.orders : orders;

  const verifiedCount = useMemo(
    () => {
      const verifiedPkgIds = new Set(
        scans
          .filter((s) => s.scan_result === 'verified' && s.package_id)
          .map((s) => s.package_id!)
      );
      return verifiedPkgIds.size;
    },
    [scans]
  );
  const notFoundCount = useMemo(
    () => scans.filter((s) => s.scan_result === 'not_found').length,
    [scans]
  );

  // spec-54 mock 1h — the "Bloque de resultado" card. Reflects the latest
  // scan attempt of ANY outcome (verified/not_found/duplicate), not just
  // the latest success — see useLatestScanResult's own comment for why.
  const latestScanResult = useLatestScanResult(scans, effectiveOrders);

  // Scan failures (most commonly: offline, since useScanMutation writes
  // straight to Supabase with no local queue) must surface to the operator
  // — silently swallowing them would mean a scan the driver believes
  // registered actually vanished.
  const handleScanError = useCallback(() => {
    toast.error('El escaneo no se registró. Verifica tu conexión e inténtalo de nuevo.');
  }, []);

  const handleScan = useCallback(
    (barcode: string) => {
      if (!effectiveManifestId || !operatorId || !userId) return;
      // spec-47 guard: a manifest must be linked to an in_progress pickup route
      // before any scan is allowed. If not, the driver is sent back to the
      // pickup landing where they can start (or join) a route.
      if (!effectivePickupRouteId) {
        toast.error('Inicia una ruta de retiro primero', {
          action: { label: 'Ir', onClick: () => router.push('/app/pickup') },
        });
        return;
      }
      scanMutation.mutate(
        { barcode, manifestId: effectiveManifestId, operatorId, externalLoadId: loadId, userId },
        {
          onSuccess: (result) => {
            if (result.scanResult === 'not_found') {
              setShowNotFoundPopup(true);
            }
          },
          onError: handleScanError,
        }
      );
    },
    [
      effectiveManifestId,
      operatorId,
      userId,
      loadId,
      scanMutation,
      effectivePickupRouteId,
      router,
      handleScanError,
    ]
  );

  const handleManualVerify = useCallback(
    (packageLabel: string) => {
      if (!effectiveManifestId || !operatorId || !userId) return;
      if (!effectivePickupRouteId) {
        toast.error('Inicia una ruta de retiro primero', {
          action: { label: 'Ir', onClick: () => router.push('/app/pickup') },
        });
        return;
      }
      scanMutation.mutate(
        {
          barcode: packageLabel,
          manifestId: effectiveManifestId,
          operatorId,
          externalLoadId: loadId,
          userId,
        },
        { onError: handleScanError }
      );
    },
    [
      effectiveManifestId,
      operatorId,
      userId,
      loadId,
      scanMutation,
      effectivePickupRouteId,
      router,
      handleScanError,
    ]
  );

  // M-3, ronda 5 de review del PR #679 (mayor) — `blockedCount` incluye
  // bloqueos cross-user que este botón no puede resolver (sólo revive
  // `dead`, vía `retryBlockedManifest`/`retryDead`). Sin este feedback, el
  // operario tocaba "REQUIERE AYUDA" sobre un bloqueo cross-user y no veía
  // ningún cambio — ni éxito ni error, la misma pantalla de siempre.
  const handleRetryBlocked = useCallback(() => {
    if (!effectiveManifestId || !operatorId) return;
    void retryBlockedManifest(operatorId, effectiveManifestId).then((revived) => {
      if (revived === 0) {
        toast.info('Nada que reintentar todavía. Puede que otro operario lo esté procesando.');
      }
    });
  }, [effectiveManifestId, operatorId]);

  // spec-82 fase 2 — early returns DESPUÉS de todos los hooks (regla de
  // hooks de React), igual que hace `route/active/page.tsx` con
  // `routeLoading`/`routeError`/`!route`. Con red (`offline.unknown` y
  // `offline.blocked` siempre `false` — ver el hook) esto nunca se
  // ejecuta y el flujo de abajo es exactamente el de siempre.
  if (offline.unknown) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Clock className="h-8 w-8 animate-pulse text-text-muted" aria-hidden />
      </div>
    );
  }
  // M1, revisión de fase 2 — un fallo de lectura de IndexedDB (modo
  // privado, upgrade bloqueado por otra pestaña, cuota agotada) no es
  // "todavía cargando": antes de esto quedaba indistinguible de `unknown`
  // para siempre y esta pantalla se congelaba en el spinner de arriba, sin
  // texto, sin botón, sin salida.
  if (offline.error) {
    return (
      <div className="p-6 max-w-md mx-auto space-y-4 text-center">
        <p className="text-text">No pudimos leer los datos guardados en este dispositivo.</p>
        <Button onClick={offline.retry}>Reintentar</Button>
      </div>
    );
  }
  if (offline.blocked) {
    return (
      <ManifestNotDownloadedNotice
        externalLoadId={loadId}
        onBack={() => router.push('/app/pickup')}
      />
    );
  }

  return (
    <>
      <div className="space-y-4 p-4 sm:p-6 pb-28 max-w-2xl mx-auto">
        <ScanResultPopup
          visible={showNotFoundPopup}
          onDismiss={() => setShowNotFoundPopup(false)}
        />

        <PickupStepBreadcrumb current="scan" />

        {/* Back + timer row. Kept as a sibling of PickupFlowHeader (not
            nested inside it) so it renders even when the header is mocked
            out in tests — the back button and label-printing entry point
            are both real, test-covered behaviour that must survive the
            restyle untouched. */}
        <div className="flex items-center justify-between -mt-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/app/pickup')}
            aria-label="Volver a manifiestos"
          >
            <ArrowLeft className="h-5 w-5 text-text-secondary" />
          </Button>
          <div className="flex items-center gap-3">
            {labelsEnabled && manifestId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  window.open(
                    `/app/pickup/manifests/${manifestId}/labels/print`,
                    '_blank',
                    'noopener',
                  )
                }
                data-testid="print-labels-scan"
              >
                <Printer className="h-4 w-4 mr-1.5" />
                Imprimir etiquetas
              </Button>
            )}
            <div className="flex items-center gap-1 text-sm text-text-secondary">
              <Clock className="h-4 w-4" />
              {elapsed}
            </div>
          </div>
        </div>

        <PickupFlowHeader
          loadId={loadId}
          retailerName={effectiveRetailerName}
          pickupPoint={effectivePickupPoint}
          scanned={verifiedCount}
          total={effectiveTotalPackages}
          queuedCount={sync.queuedCount}
          blockedCount={sync.blockedCount}
          // Decisión del usuario, 2026-09-08 (ronda 4 de review del PR #679,
          // B-1) — "el operario puede reintentar desde la app". Sólo se
          // ofrece una vez que el manifiesto cargó: sin `manifestId` no hay
          // a qué carga aplicar el reintento.
          onRetryBlocked={effectiveManifestId && operatorId ? handleRetryBlocked : undefined}
        />

        {/* spec-82 fase 2, revisión B1 — descargar sólo habilita VER el
            manifiesto sin red, nunca escanear: `useScanMutation` sigue
            yendo directo a Supabase, sin cola offline en esta pantalla
            (eso es spec-81). Sin este aviso, la pantalla se veía "perfecta"
            sin red y el operario escaneaba contra una mutación pausada en
            memoria que TanStack Query nunca ejecuta ni informa — sin toast,
            sin beep, y el trabajo desaparece si cierra la pestaña antes de
            recuperar señal. */}
        {sync.status === 'offline' && (
          <div className="space-y-2">
            <p className="text-sm text-status-warning-text bg-status-warning-bg border border-status-warning-border rounded-lg px-3 py-2">
              Sin conexión: no se puede escanear ahora. Vuelve a tener señal
              para registrar bultos.
            </p>
            {/* spec-82 fase 2, revisión B2 — `usePickupScans` es una query
                de red (por defecto pausada sin señal): sin este aviso, un
                operario que verificó 18/25 con señal y reabre `5d` sin red
                ve "0/25" y ningún check verde, indistinguible de "nada
                verificado todavía". El progreso no se perdió — no se puede
                LEER sin red — y la pantalla tiene que decirlo. */}
            <p className="text-xs text-text-muted">
              No se puede confirmar cuántos bultos ya se verificaron mientras
              no haya red. Lo que ves abajo puede no reflejar el progreso real.
            </p>
            {/* Menor, revisión de fase 2 — `downloadedAt` se escribía y
                nunca se leía: una carga descargada ayer con bultos
                corregidos hoy se mostraba como si fuera actual, sin marca
                de tiempo ni aviso. Esto no resuelve la desactualización
                (sigue sin invalidación automática, ver el spec) pero al
                menos dice DE CUÁNDO son los datos. */}
            {/* Formateado a mano (no Intl/toLocaleString) — el padding de
                día/mes de Intl varía entre entornos/versiones de ICU
                (Node local vs. CI), y esto sólo necesita ser legible, no
                localizado. */}
            {offline.snapshot && (
              <p className="text-xs text-text-muted">
                Descargado el {formatDownloadedAt(offline.snapshot.downloadedAt)}
              </p>
            )}
          </div>
        )}

        <ScannerInput
          onScan={handleScan}
          disabled={scanMutation.isPending || sync.status === 'offline'}
        />

        {/* Not-found counter */}
        {notFoundCount > 0 && (
          <div className="flex items-center gap-2 p-2 bg-status-error-bg border border-status-error-border rounded-lg">
            <XCircle className="h-4 w-4 text-status-error" />
            <span className="text-sm text-text">{notFoundCount} no encontrados en manifiesto</span>
          </div>
        )}

        <ScanResultCard {...latestScanResult} />

        <div className="bg-surface border border-border rounded-lg">
          <div className="px-3 pt-3 pb-1">
            <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Escaneos recientes</p>
          </div>
          <div className="p-3">
            <ScanHistoryList scans={scans} />
          </div>
        </div>

        <ManifestDetailList
          orders={effectiveOrders}
          scans={scans}
          onManualVerify={handleManualVerify}
          isLoading={ordersLoading}
          // M6, revisión de fase 2 — un fallo de red ANTERIOR (con señal)
          // deja `ordersError` pegado en la caché de React Query incluso
          // tras perder señal después. Con un snapshot local válido, ese
          // error viejo no puede seguir tapando órdenes que sí están
          // disponibles con un cartel rojo y un "Retry" que de todos modos
          // no puede hacer nada sin red.
          isError={offline.snapshot ? false : ordersError}
          onRetry={() => refetchOrders()}
        />
      </div>

      {/*
        spec-54 mock 1h fixed footer — 60px primary action, padding
        16px/20px/26px per the handoff. The mock also specifies two
        secondary 50%-width buttons here, both omitted deliberately:

        - "Ingresar código" would open a manual-entry field that is already
          on screen (ScannerInput doubles as the manual-entry surface for
          this flow) — adding a second entry point would duplicate it
          rather than unblock anything.
        - "Cerrar carga" has no backing mutation at the manifest level on
          this screen. The only close action that exists today is
          `useClosePickupRoute`, which closes the whole pickup route
          (potentially several manifests), not "this load" — using it here
          would silently do something bigger than the label promises. A
          per-manifest "finish this load" RPC would unblock adding it.
      */}
      <div className="fixed bottom-0 inset-x-0 bg-background border-t border-border pt-4 px-4 pb-[26px] sm:px-6">
        <div className="max-w-2xl mx-auto">
          <Button
            onClick={() =>
              router.push(
                `/app/pickup/review/${encodeURIComponent(loadId)}`
              )
            }
            className="w-full h-[60px] text-base"
            size="lg"
          >
            Continuar a revisión
          </Button>
        </div>
      </div>
    </>
  );
}
