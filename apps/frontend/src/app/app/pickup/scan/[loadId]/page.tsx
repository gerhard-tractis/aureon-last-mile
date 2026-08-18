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

  // spec-54 mock 1h — real device queue state for the "COLA N" badge. No
  // writer populates `db.scan_queue` from this screen today (see
  // PickupFlowHeader's `queuedCount` doc comment), so `queuedCount` is
  // always 0 in practice; wired to the real hook rather than hard-coded so
  // the badge starts working the day a writer exists.
  const sync = useSyncQueue();

  // spec-53 — second entry point. Labels are normally printed from the pickup
  // list before departure, but the crew also needs them here: this is the
  // screen they are on when they discover a label is missing or unreadable.
  const labelsEnabled = useModuleEnabled(operatorId, ModuleKey.PACKAGE_LABELS);

  useEffect(() => {
    if (!operatorId) return;
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
  }, [operatorId, loadId]);

  useEffect(() => {
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const mins = String(Math.floor(diff / 60)).padStart(2, '0');
      const secs = String(diff % 60).padStart(2, '0');
      setElapsed(`${mins}:${secs}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const { data: scans = [] } = usePickupScans(manifestId, operatorId);
  const scanMutation = useScanMutation();

  const {
    data: orders = [],
    isLoading: ordersLoading,
    isError: ordersError,
    refetch: refetchOrders,
  } = useManifestOrders(loadId, operatorId);

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
  const latestScanResult = useLatestScanResult(scans, orders);

  // Scan failures (most commonly: offline, since useScanMutation writes
  // straight to Supabase with no local queue) must surface to the operator
  // — silently swallowing them would mean a scan the driver believes
  // registered actually vanished.
  const handleScanError = useCallback(() => {
    toast.error('El escaneo no se registró. Verifica tu conexión e inténtalo de nuevo.');
  }, []);

  const handleScan = useCallback(
    (barcode: string) => {
      if (!manifestId || !operatorId || !userId) return;
      // spec-47 guard: a manifest must be linked to an in_progress pickup route
      // before any scan is allowed. If not, the driver is sent back to the
      // pickup landing where they can start (or join) a route.
      if (!pickupRouteId) {
        toast.error('Inicia una ruta de retiro primero', {
          action: { label: 'Ir', onClick: () => router.push('/app/pickup') },
        });
        return;
      }
      scanMutation.mutate(
        { barcode, manifestId, operatorId, externalLoadId: loadId, userId },
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
    [manifestId, operatorId, userId, loadId, scanMutation, pickupRouteId, router, handleScanError]
  );

  const handleManualVerify = useCallback(
    (packageLabel: string) => {
      if (!manifestId || !operatorId || !userId) return;
      if (!pickupRouteId) {
        toast.error('Inicia una ruta de retiro primero', {
          action: { label: 'Ir', onClick: () => router.push('/app/pickup') },
        });
        return;
      }
      scanMutation.mutate(
        { barcode: packageLabel, manifestId, operatorId, externalLoadId: loadId, userId },
        { onError: handleScanError }
      );
    },
    [manifestId, operatorId, userId, loadId, scanMutation, pickupRouteId, router, handleScanError]
  );

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
          retailerName={retailerName}
          pickupPoint={pickupPoint}
          scanned={verifiedCount}
          total={totalPackages}
          queuedCount={sync.queuedCount}
        />

        <ScannerInput onScan={handleScan} disabled={scanMutation.isPending} />

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
          orders={orders}
          scans={scans}
          onManualVerify={handleManualVerify}
          isLoading={ordersLoading}
          isError={ordersError}
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
