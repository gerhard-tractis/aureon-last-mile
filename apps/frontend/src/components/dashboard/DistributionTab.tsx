'use client';
import { useDistributionKPIs } from '@/hooks/distribution/useDistributionKPIs';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';

interface DistributionTabProps {
  operatorId: string;
}

export function DistributionTab({ operatorId }: DistributionTabProps) {
  const { data: kpis, isLoading } = useDistributionKPIs(operatorId);

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Pendientes de sectorizar</div>
          <div className="text-2xl font-bold">{kpis?.pending ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">En consolidación</div>
          <div className="text-2xl font-bold">{kpis?.consolidation ?? '—'}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Próximos a despachar</div>
          <div className="text-2xl font-bold">{kpis?.dueSoon ?? '—'}</div>
        </Card>
      </div>
      <div className="text-right">
        <Link href="/app/distribution" className="text-sm text-primary-600 hover:underline">
          Ver distribución completa →
        </Link>
      </div>
    </div>
  );
}
