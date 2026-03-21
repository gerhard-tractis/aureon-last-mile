'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BatchScanner } from '@/components/distribution/BatchScanner';
import { BatchDetailList } from '@/components/distribution/BatchDetailList';
import { useDockBatch } from '@/hooks/distribution/useDockBatches';
import { useDockScans, useDockScanMutation } from '@/hooks/distribution/useDockScans';
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
  const [lastResult, setLastResult] = useState<DockScanValidationResult | null>(null);

  const scanMutation = useDockScanMutation(
    operatorId ?? '',
    batchId,
    batch?.dock_zone_id ?? '',
    user?.id ?? ''
  );

  if (!operatorId || !batch) return <Skeleton className="h-96 w-full" />;

  const zone = batch.dock_zones as { name: string; code: string } | null;
  const acceptedCount = (scans ?? []).filter(s => s.scan_result === 'accepted').length;

  const handleScan = async (barcode: string) => {
    const result = await scanMutation.mutateAsync(barcode);
    setLastResult(result);
  };

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
      <BatchScanner onScan={handleScan} lastResult={lastResult} disabled={scanMutation.isPending} />
      <BatchDetailList scans={scans ?? []} totalExpected={batch.package_count} />
    </div>
  );
}
