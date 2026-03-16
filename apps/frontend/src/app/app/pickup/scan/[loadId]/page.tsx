'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScannerInput } from '@/components/pickup/ScannerInput';
import { ProgressBar } from '@/components/pickup/ProgressBar';
import { ScanHistoryList } from '@/components/pickup/ScanHistoryList';
import { ScanResultPopup } from '@/components/pickup/ScanResultPopup';
import { usePickupScans, useScanMutation } from '@/hooks/pickup/usePickupScans';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { CheckCircle, XCircle, Clock, ArrowLeft } from 'lucide-react';
import { useManifestOrders } from '@/hooks/pickup/useManifestOrders';
import { ManifestDetailList } from '@/components/pickup/ManifestDetailList';

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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push('/app/pickup')}
            className="p-1 rounded-md hover:bg-gray-100 transition-colors"
            aria-label="Back to manifests"
          >
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            Scanning: {loadId}
          </h1>
        </div>
        <div className="flex items-center gap-1 text-sm text-gray-500">
          <Clock className="h-4 w-4" />
          {elapsed}
        </div>
      </div>

      <ProgressBar scanned={verifiedCount} total={totalPackages} />
      <ScannerInput onScan={handleScan} disabled={scanMutation.isPending} />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-2xl font-bold">{verifiedCount}</p>
              <p className="text-xs text-gray-500">Verified</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-2xl font-bold">{notFoundCount}</p>
              <p className="text-xs text-gray-500">Not Found</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent Scans</CardTitle>
        </CardHeader>
        <CardContent>
          <ScanHistoryList scans={scans} />
        </CardContent>
      </Card>

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
        className="w-full bg-primary-600 hover:bg-primary-700 text-white"
        size="lg"
      >
        Complete Pickup
      </Button>
    </div>
  );
}
