'use client';
import { QuickSortScanner } from '@/components/distribution/QuickSortScanner';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { Skeleton } from '@/components/ui/skeleton';

export default function QuickSortPage() {
  const { operatorId } = useOperatorId();
  const { user } = useGlobal();
  const { data: zones } = useDockZones(operatorId);

  if (!operatorId || !zones || !user?.id) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Modo Rápido</h1>
      <QuickSortScanner
        operatorId={operatorId}
        userId={user.id}
        zones={zones}
      />
    </div>
  );
}
