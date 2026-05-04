'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { PrintLabels, type PrintZone } from './PrintLabels';
import { Skeleton } from '@/components/ui/skeleton';

export default function DockLabelsPrintPage() {
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
