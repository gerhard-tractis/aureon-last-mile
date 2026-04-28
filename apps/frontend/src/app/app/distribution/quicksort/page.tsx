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
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Modo Rápido</h1>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-6">
        <QuickSortScanner operatorId={operatorId} userId={user.id} zones={zones} />
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
