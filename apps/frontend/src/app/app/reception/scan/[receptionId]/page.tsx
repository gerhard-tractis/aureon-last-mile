'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/pickup/ProgressBar';
import { ReceptionScanner } from '@/components/reception/ReceptionScanner';
import {
  ReceptionDetailList,
  ReceptionPackageItem,
} from '@/components/reception/ReceptionDetailList';
import {
  useReceptionScans,
  useReceptionScanMutation,
} from '@/hooks/reception/useReceptionScans';
import { useOperatorId } from '@/hooks/useOperatorId';
import { createSPAClient } from '@/lib/supabase/client';
import { ReceptionScanValidationResult } from '@/lib/reception/reception-scan-validator';
import { ArrowLeft, CheckCircle, XCircle, Clock } from 'lucide-react';

interface ReceptionMeta {
  manifestId: string;
  expectedCount: number;
  receivedCount: number;
  externalLoadId: string;
}

interface ManifestPackage {
  id: string;
  label: string;
  order_id: string;
  status: string;
  orders?: { order_number: string } | null;
}

export default function ReceptionScanPage() {
  const params = useParams();
  const router = useRouter();
  const receptionId = params.receptionId as string;
  const { operatorId } = useOperatorId();

  const [meta, setMeta] = useState<ReceptionMeta | null>(null);
  const [manifestPackages, setManifestPackages] = useState<ManifestPackage[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] = useState<ReceptionScanValidationResult | null>(null);
  const [startTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState('00:00');

  // Load reception metadata
  useEffect(() => {
    if (!operatorId) return;
    const supabase = createSPAClient();

    supabase
      .from('hub_receptions')
      .select('id, manifest_id, expected_count, received_count')
      .eq('id', receptionId)
      .eq('operator_id', operatorId)
      .is('deleted_at', null)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setMeta({
          manifestId: data.manifest_id,
          expectedCount: data.expected_count,
          receivedCount: data.received_count,
          externalLoadId: '',
        });

        // Load manifest's external_load_id
        supabase
          .from('manifests')
          .select('external_load_id')
          .eq('id', data.manifest_id)
          .single()
          .then(({ data: manifest }) => {
            if (manifest) {
              setMeta((prev) =>
                prev ? { ...prev, externalLoadId: manifest.external_load_id } : null
              );
            }
          });

        // Load packages for this manifest (verificado status only for scanning)
        loadManifestPackages(data.manifest_id, operatorId);
      });

    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, [operatorId, receptionId]);

  async function loadManifestPackages(manifestId: string, opId: string) {
    const supabase = createSPAClient();
    // Get orders for this manifest's load
    const { data: manifest } = await supabase
      .from('manifests')
      .select('external_load_id')
      .eq('id', manifestId)
      .single();

    if (!manifest) return;

    const { data: orders } = await supabase
      .from('orders')
      .select('id, order_number')
      .eq('operator_id', opId)
      .eq('external_load_id', manifest.external_load_id)
      .is('deleted_at', null);

    if (!orders || orders.length === 0) return;

    const orderIds = orders.map((o) => o.id);
    const orderMap = new Map(orders.map((o) => [o.id, o.order_number]));

    const { data: packages } = await supabase
      .from('packages')
      .select('id, label, order_id, status')
      .eq('operator_id', opId)
      .in('order_id', orderIds)
      .is('deleted_at', null);

    if (packages) {
      setManifestPackages(
        packages.map((p) => ({
          ...p,
          orders: { order_number: orderMap.get(p.order_id) ?? '' },
        }))
      );
    }
  }

  // Timer
  useEffect(() => {
    const interval = setInterval(() => {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      const mins = String(Math.floor(diff / 60)).padStart(2, '0');
      const secs = String(diff % 60).padStart(2, '0');
      setElapsed(`${mins}:${secs}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const { data: scans = [] } = useReceptionScans(receptionId, operatorId);
  const scanMutation = useReceptionScanMutation();

  const receivedCount = useMemo(
    () => scans.filter((s) => s.scan_result === 'received').length,
    [scans]
  );
  const notFoundCount = useMemo(
    () => scans.filter((s) => s.scan_result === 'not_found').length,
    [scans]
  );

  const receivedBarcodes = useMemo(
    () => new Set(scans.filter((s) => s.scan_result === 'received').map((s) => s.barcode)),
    [scans]
  );

  // Build detail list items — only show verificado packages
  const packageItems: ReceptionPackageItem[] = useMemo(() => {
    return manifestPackages
      .filter((p) => p.status === 'verificado' || receivedBarcodes.has(p.label))
      .map((p) => ({
        id: p.id,
        label: p.label,
        orderNumber: p.orders?.order_number ?? '',
        received: receivedBarcodes.has(p.label),
      }));
  }, [manifestPackages, receivedBarcodes]);

  // Auto-navigate when all expected packages scanned
  useEffect(() => {
    if (meta && receivedCount > 0 && receivedCount >= meta.expectedCount) {
      router.push(`/app/reception/complete/${receptionId}`);
    }
  }, [receivedCount, meta, receptionId, router]);

  const handleScan = useCallback(
    (barcode: string) => {
      if (!meta || !operatorId || !userId) return;
      scanMutation.mutate(
        {
          barcode,
          receptionId,
          manifestId: meta.manifestId,
          operatorId,
          userId,
        },
        {
          onSuccess: (result) => {
            setLastScanResult(result);
            // Clear feedback after 3 seconds
            setTimeout(() => setLastScanResult(null), 3000);
          },
        }
      );
    },
    [meta, operatorId, userId, receptionId, scanMutation]
  );

  return (
    <div className="space-y-4 p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/app/reception')}
          className="p-1 hover:bg-gray-100 rounded"
          aria-label="Volver a recepción"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold text-gray-900 flex-1">
          Recepción: {meta?.externalLoadId ?? '...'}
        </h1>
        <div className="flex items-center gap-1 text-sm text-gray-500">
          <Clock className="h-4 w-4" />
          {elapsed}
        </div>
      </div>

      {/* Progress */}
      <ProgressBar
        scanned={receivedCount}
        total={meta?.expectedCount ?? 0}
      />

      {/* Scanner */}
      <ReceptionScanner
        onScan={handleScan}
        disabled={scanMutation.isPending}
        lastScanResult={lastScanResult}
      />

      {/* Counters */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-2xl font-bold">{receivedCount}</p>
              <p className="text-xs text-gray-500">Recibidos</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-500" />
            <div>
              <p className="text-2xl font-bold">{notFoundCount}</p>
              <p className="text-xs text-gray-500">No encontrados</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Package detail list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Paquetes</CardTitle>
        </CardHeader>
        <CardContent>
          <ReceptionDetailList packages={packageItems} />
        </CardContent>
      </Card>

      {/* Manual complete button */}
      <Button
        onClick={() => router.push(`/app/reception/complete/${receptionId}`)}
        className="w-full bg-primary-600 hover:bg-primary-700 text-white"
        size="lg"
      >
        Finalizar Recepción
      </Button>
    </div>
  );
}
