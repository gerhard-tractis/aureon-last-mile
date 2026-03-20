'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { BatchConfirmation } from '@/components/distribution/BatchConfirmation';
import { useDockBatch, useCloseDockBatch } from '@/hooks/distribution/useDockBatches';
import { useOperatorId } from '@/hooks/useOperatorId';
import { Skeleton } from '@/components/ui/skeleton';

export default function BatchConfirmPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { data: batch } = useDockBatch(batchId, operatorId);
  const closeBatch = useCloseDockBatch();
  const [lastScan, setLastScan] = useState<{ success: boolean; message: string } | null>(null);

  if (!operatorId || !batch) return <Skeleton className="h-96 w-full" />;

  const zone = batch.dock_zones as { name: string; code: string } | null;

  const handleAndénScan = (scannedCode: string) => {
    if (scannedCode.trim().toUpperCase() === zone?.code?.toUpperCase()) {
      closeBatch.mutate(
        { id: batchId, operator_id: operatorId },
        { onSuccess: () => router.push('/app/distribution') }
      );
    } else {
      setLastScan({ success: false, message: `Código incorrecto — se esperaba ${zone?.code}` });
    }
  };

  return (
    <div className="p-6">
      <BatchConfirmation
        zoneName={zone?.name ?? ''}
        zoneCode={zone?.code ?? ''}
        packageCount={batch.package_count}
        onConfirm={handleAndénScan}
        lastScan={lastScan}
      />
    </div>
  );
}
