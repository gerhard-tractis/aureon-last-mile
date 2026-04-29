'use client';
import { QuickSortScanner } from '@/components/distribution/QuickSortScanner';
import { PendingDockList } from '@/components/distribution/PendingDockList';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useGlobal } from '@/lib/context/GlobalContext';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { usePendingSectorization } from '@/hooks/distribution/usePendingSectorization';
import {
  useDockVerifications,
  useDockVerificationMutation,
} from '@/hooks/distribution/useDockVerifications';
import { useManualDockAssignment } from '@/hooks/distribution/useManualDockAssignment';
import { Skeleton } from '@/components/ui/skeleton';

export default function QuickSortPage() {
  const { operatorId } = useOperatorId();
  const { user } = useGlobal();
  const { data: zones } = useDockZones(operatorId);
  const { data: pendingGroups } = usePendingSectorization(operatorId);
  const today = new Date().toISOString().split('T')[0];
  const { data: verifiedSet } = useDockVerifications(operatorId, today);
  const verifyMutation = useDockVerificationMutation(operatorId ?? '', user?.id ?? '');
  const manualAssign = useManualDockAssignment(operatorId ?? '', user?.id ?? '');

  if (!operatorId || !zones || !user?.id) return <Skeleton className="h-96 w-full" />;

  const consolidationZone = zones.find(z => z.is_consolidation && z.is_active);
  const activeZones = [
    ...zones.filter(z => z.is_active && !z.is_consolidation),
    ...(consolidationZone ? [consolidationZone] : []),
  ];

  const onTapVerify = (packageId: string) => {
    if (verifiedSet?.has(packageId)) return;
    verifyMutation.mutate({ packageId, source: 'tap' });
  };

  const onManualAssign = manualAssign.canUse
    ? (packageId: string, zoneId: string) => {
        const target = zones.find(z => z.id === zoneId);
        manualAssign.mutate({
          packageId,
          zoneId,
          barcode: packageId,
          isConsolidation: !!target?.is_consolidation,
        });
      }
    : undefined;

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 z-20 bg-background border-b border-border px-4 py-3">
        <div className="flex items-baseline justify-between mb-3">
          <h1 className="text-xl font-semibold">Modo Rápido</h1>
        </div>
        <div className="max-w-3xl">
          <QuickSortScanner operatorId={operatorId} userId={user.id} zones={zones} />
        </div>
      </header>
      <div className="flex-1 px-4 py-4">
        <PendingDockList
          groups={pendingGroups ?? []}
          verifiedPackageIds={verifiedSet ?? new Set()}
          onTapVerify={onTapVerify}
          onManualAssign={onManualAssign}
          activeZones={activeZones}
        />
      </div>
    </div>
  );
}
