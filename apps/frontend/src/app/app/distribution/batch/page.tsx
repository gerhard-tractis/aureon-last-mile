'use client';

import { useRouter } from 'next/navigation';
import { BatchOverview } from '@/components/distribution/BatchOverview';
import { usePendingSectorization } from '@/hooks/distribution/usePendingSectorization';
import { useCreateDockBatch } from '@/hooks/distribution/useDockBatches';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useGlobal } from '@/lib/context/GlobalContext';
import { Skeleton } from '@/components/ui/skeleton';

export default function BatchPage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const { user } = useGlobal();
  const { data: groups, isLoading } = usePendingSectorization(operatorId);
  const createBatch = useCreateDockBatch();

  if (!operatorId || !user?.id || isLoading) return <Skeleton className="h-96 w-full" />;

  const handleStartBatch = async (zoneId: string) => {
    const batch = await createBatch.mutateAsync({
      operator_id: operatorId,
      dock_zone_id: zoneId,
      created_by: user.id,
    });
    router.push(`/app/distribution/batch/${batch.id}`);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-6">Sectorización por Lote</h1>
      <BatchOverview groups={groups ?? []} onStartBatch={handleStartBatch} />
    </div>
  );
}
