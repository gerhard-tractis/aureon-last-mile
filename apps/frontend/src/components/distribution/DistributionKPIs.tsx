import { Card } from '@/components/ui/card';

interface DistributionKPIsProps {
  pending: number;
  consolidation: number;
  dueSoon: number;
}

export function DistributionKPIs({ pending, consolidation, dueSoon }: DistributionKPIsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <Card className="p-4">
        <div className="text-sm text-muted-foreground">Pendientes de sectorizar</div>
        <div className="text-2xl font-bold mt-1">{pending}</div>
      </Card>

      <Card className="p-4">
        <div className="text-sm text-muted-foreground">En consolidación</div>
        <div className="text-2xl font-bold mt-1">{consolidation}</div>
      </Card>

      <Card
        className={dueSoon > 0 ? 'p-4 border-status-warning-border bg-status-warning-bg' : 'p-4'}
        data-urgent={dueSoon > 0 ? 'true' : undefined}
      >
        <div className="text-sm text-muted-foreground">Próximos a despachar</div>
        <div
          className={dueSoon > 0 ? 'text-2xl font-bold mt-1 text-status-warning' : 'text-2xl font-bold mt-1'}
        >
          {dueSoon}
        </div>
      </Card>
    </div>
  );
}
