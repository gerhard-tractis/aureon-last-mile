'use client';
import { Card } from '@/components/ui/card';
import Link from 'next/link';

interface DistributionTabProps {
  operatorId: string;
}

export function DistributionTab({ operatorId: _operatorId }: DistributionTabProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Pendientes de sectorizar</div>
          <div className="text-2xl font-bold">—</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">En consolidación</div>
          <div className="text-2xl font-bold">—</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Próximos a despachar</div>
          <div className="text-2xl font-bold">—</div>
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
