'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BatchScanner } from '@/components/distribution/BatchScanner';
import { BatchDetailList } from '@/components/distribution/BatchDetailList';
import { PendingDockList } from '@/components/distribution/PendingDockList';
import { useDockBatch } from '@/hooks/distribution/useDockBatches';
import { useDockScans, useDockScanMutation } from '@/hooks/distribution/useDockScans';
import { useRedirectBatchScanToConsolidation } from '@/hooks/distribution/useRedirectBatchScan';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { usePendingSectorization } from '@/hooks/distribution/usePendingSectorization';
import {
  useDockVerifications,
  useDockVerificationMutation,
} from '@/hooks/distribution/useDockVerifications';
import { useManualDockAssignment } from '@/hooks/distribution/useManualDockAssignment';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useGlobal } from '@/lib/context/GlobalContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { DockScanValidationResult } from '@/lib/distribution/dock-scan-validator';

export default function BatchScanPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { user } = useGlobal();
  const { data: batch } = useDockBatch(batchId, operatorId);
  const { data: scans } = useDockScans(batchId, operatorId);
  const { data: zones } = useDockZones(operatorId);
  const { data: pendingGroups } = usePendingSectorization(operatorId);
  const today = new Date().toISOString().split('T')[0];
  const { data: verifiedSet } = useDockVerifications(operatorId, today);
  const verifyMutation = useDockVerificationMutation(operatorId ?? '', user?.id ?? '');
  const manualAssign = useManualDockAssignment(operatorId ?? '', user?.id ?? '');

  const [lastResult, setLastResult] = useState<DockScanValidationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const scanMutation = useDockScanMutation(
    operatorId ?? '',
    batchId,
    batch?.dock_zone_id ?? '',
    user?.id ?? ''
  );
  const redirectMutation = useRedirectBatchScanToConsolidation(operatorId ?? '', batchId);

  if (!operatorId || !batch) return <Skeleton className="h-96 w-full" />;

  const zone = batch.dock_zones as { name: string; code: string } | null;
  const acceptedScans = (scans ?? []).filter(s => s.scan_result === 'accepted');
  const acceptedCount = acceptedScans.length;
  const lastAcceptedScan = acceptedScans[0] ?? null;
  const batchZoneCode = zone?.code ?? '';
  const consolidationZone = (zones ?? []).find(z => z.is_consolidation && z.is_active);
  const groupsForThisZone = (pendingGroups ?? []).filter(
    g => g.zone.id === batch.dock_zone_id
  );

  const handleScan = async (barcode: string) => {
    setErrorMessage(null);
    const code = barcode.trim().toUpperCase();
    const matchedZone = (zones ?? []).find(
      z => z.is_active && z.code.toUpperCase() === code
    );

    if (matchedZone) {
      // Same-zone scan is a no-op (operator confirming the dock).
      if (matchedZone.id === batch.dock_zone_id) {
        return;
      }
      // Consolidación → redirect the most recent accepted package.
      if (matchedZone.is_consolidation) {
        if (!lastAcceptedScan?.package_id) {
          setErrorMessage('No hay paquete aceptado para redirigir.');
          return;
        }
        await redirectMutation.mutateAsync({
          scanId: lastAcceptedScan.id,
          packageId: lastAcceptedScan.package_id,
          consolidationZoneId: matchedZone.id,
          previousPackageCount: batch.package_count ?? 0,
        });
        return;
      }
      // Different anden — explicit reject.
      setErrorMessage(
        `Asignación fallida: andén incorrecto. Esperado ${batchZoneCode} o Consolidación.`
      );
      return;
    }

    const result = await scanMutation.mutateAsync({ barcode });
    setLastResult(result);
  };

  const onTapVerify = (packageId: string) => {
    if (verifiedSet?.has(packageId)) return;
    verifyMutation.mutate({ packageId, source: 'tap' });
  };

  const onManualAssign = manualAssign.canUse
    ? (packageId: string, zoneId: string) => {
        const target = (zones ?? []).find(z => z.id === zoneId);
        manualAssign.mutate({
          packageId,
          zoneId,
          barcode: packageId,
          isConsolidation: !!target?.is_consolidation,
        });
      }
    : undefined;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{zone?.name ?? 'Lote'}</h1>
          <p className="text-muted-foreground font-mono">{zone?.code}</p>
        </div>
        <Button
          onClick={() => router.push(`/app/distribution/batch/${batchId}/confirm`)}
          disabled={acceptedCount === 0}
        >
          Cerrar lote
        </Button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6">
        <div className="space-y-4">
          <BatchScanner
            onScan={handleScan}
            lastResult={lastResult}
            disabled={scanMutation.isPending || redirectMutation.isPending}
          />
          {errorMessage && (
            <div className="bg-status-error-bg border border-status-error-border rounded p-2 text-sm text-status-error">
              {errorMessage}
            </div>
          )}
          <BatchDetailList scans={scans ?? []} totalExpected={batch.package_count} />
        </div>
        <PendingDockList
          groups={groupsForThisZone}
          verifiedPackageIds={verifiedSet ?? new Set()}
          onTapVerify={onTapVerify}
          onManualAssign={onManualAssign}
          activeZones={[
            ...(zones ?? []).filter(z => z.is_active && !z.is_consolidation),
            ...(consolidationZone ? [consolidationZone] : []),
          ]}
        />
      </div>
    </div>
  );
}
