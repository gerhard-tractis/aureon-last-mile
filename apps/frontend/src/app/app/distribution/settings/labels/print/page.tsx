'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { PrintLabels, type PrintZone } from './PrintLabels';
import { Skeleton } from '@/components/ui/skeleton';

function PrintPageInner() {
  const { operatorId } = useOperatorId();
  const { data: zones, isLoading } = useDockZones(operatorId);
  const params = useSearchParams();

  const filtered = useMemo<PrintZone[]>(() => {
    if (!zones) return [];
    const idList = (params.get('zoneIds') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (idList.length === 0) return [];
    const idSet = new Set(idList);
    return zones
      .filter((z) => idSet.has(z.id))
      .map(({ id, code, name }) => ({ id, code, name }));
  }, [zones, params]);

  if (isLoading) {
    return <Skeleton className="h-screen w-full" />;
  }

  return <PrintLabels zones={filtered} />;
}

export default function DockLabelsPrintPage() {
  return (
    <Suspense fallback={<Skeleton className="h-screen w-full" />}>
      <PrintPageInner />
    </Suspense>
  );
}
