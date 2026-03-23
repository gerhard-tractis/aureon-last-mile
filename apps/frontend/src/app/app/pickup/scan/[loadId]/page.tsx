'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ScannerInput } from '@/components/pickup/ScannerInput';
import { ScanHistoryList } from '@/components/pickup/ScanHistoryList';
import { ScanResultPopup } from '@/components/pickup/ScanResultPopup';
import { usePickupScans, useScanMutation } from '@/hooks/pickup/usePickupScans';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { XCircle, Clock, ArrowLeft } from 'lucide-react';
import { useManifestOrders } from '@/hooks/pickup/useManifestOrders';
import { ManifestDetailList } from '@/components/pickup/ManifestDetailList';
import { PickupFlowHeader } from '@/components/pickup/PickupFlowHeader';
import { PickupStepBreadcrumb } from '@/components/pickup/PickupStepBreadcrumb';

export default function ScanningPage() {
  const params = useParams();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId as string);
  const { operatorId } = useOperatorId();

  const [manifestId, setManifestId] = useState<string | null>(null);
  const [totalPackages, setTotalPackages] = useState(0);
  const [showNotFoundPopup, setShowNotFoundPopup] = useState(false);
  const [startTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState('00:00');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();
    supabase
      .from('manifests')
      .select('id, total_packages')
      .eq('operator_id', operatorId)
      .eq('external_load_id', loadId)
      .is('deleted_at', null)
      .single()
      .then(({ data }) => {
        if (data) {
          setManifestId(data.id);
          setTotalPackages(data.total_packages ?? 0);
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

  const handleScan = useCallback(
    (barcode: string) => {
      if (!manifestId || !operatorId || !userId) return;
      scanMutation.mutate(
        { barcode, manifestId, operatorId, externalLoadId: loadId, userId },
        {
          onSuccess: (result) => {
            if (result.scanResult === 'not_found') {
              setShowNotFoundPopup(true);
            }
          },
        }
      );
    },
    [manifestId, operatorId, userId, loadId, scanMutation]
  );

  const handleManualVerify = useCallback(
    (packageLabel: string) => {
      if (!manifestId || !operatorId || !userId) return;
      scanMutation.mutate(
        { barcode: packageLabel, manifestId, operatorId, externalLoadId: loadId, userId }
      );
    },
    [manifestId, operatorId, userId, loadId, scanMutation]
  );

  return (
    <div className="space-y-4 p-4 max-w-2xl mx-auto">
      <ScanResultPopup
        visible={showNotFoundPopup}
        onDismiss={() => setShowNotFoundPopup(false)}
      />

      <PickupStepBreadcrumb current="scan" />
      <PickupFlowHeader loadId={loadId} scanned={verifiedCount} total={totalPackages} />

      {/* Back + timer row */}
      <div className="flex items-center justify-between -mt-2">
        <button
          onClick={() => router.push('/app/pickup')}
          className="p-1 rounded-md hover:bg-surface-raised transition-colors"
          aria-label="Back to manifests"
        >
          <ArrowLeft className="h-5 w-5 text-text-secondary" />
        </button>
        <div className="flex items-center gap-1 text-sm text-text-secondary">
          <Clock className="h-4 w-4" />
          {elapsed}
        </div>
      </div>

      <ScannerInput onScan={handleScan} disabled={scanMutation.isPending} />

      {/* Not-found counter */}
      {notFoundCount > 0 && (
        <div className="flex items-center gap-2 p-2 bg-status-error-bg border border-status-error-border rounded-lg">
          <XCircle className="h-4 w-4 text-status-error" />
          <span className="text-sm text-text">{notFoundCount} not in manifest</span>
        </div>
      )}

      <div className="bg-surface border border-border rounded-lg">
        <div className="px-3 pt-3 pb-1">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">Recent Scans</p>
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

      <Button
        onClick={() =>
          router.push(
            `/app/pickup/review/${encodeURIComponent(loadId)}`
          )
        }
        className="w-full"
        size="lg"
      >
        Complete Pickup
      </Button>
    </div>
  );
}
