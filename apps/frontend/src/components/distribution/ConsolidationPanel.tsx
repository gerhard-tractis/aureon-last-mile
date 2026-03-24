import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { ConsolidationPackage } from '@/hooks/distribution/useConsolidation';

interface ConsolidationPanelProps {
  packages: ConsolidationPackage[];
  onRelease: (ids: string[]) => void;
}

function isUrgent(deliveryDate: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const date = new Date(deliveryDate + 'T00:00:00');
  return date <= tomorrow;
}

export function ConsolidationPanel({ packages, onRelease }: ConsolidationPanelProps) {
  if (packages.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          No hay paquetes en consolidación.
        </CardContent>
      </Card>
    );
  }

  const urgent = packages.filter((p) => isUrgent(p.delivery_date));
  const future = packages.filter((p) => !isUrgent(p.delivery_date));

  return (
    <div className="space-y-4">
      {urgent.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-status-warning">Urgentes (despacho hoy/mañana)</h3>
          {urgent.map((pkg) => (
            <PackageRow key={pkg.id} pkg={pkg} urgent onRelease={onRelease} />
          ))}
        </div>
      )}
      {future.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Próximos</h3>
          {future.map((pkg) => (
            <PackageRow key={pkg.id} pkg={pkg} urgent={false} onRelease={onRelease} />
          ))}
        </div>
      )}
    </div>
  );
}

interface PackageRowProps {
  pkg: ConsolidationPackage;
  urgent: boolean;
  onRelease: (ids: string[]) => void;
}

function PackageRow({ pkg, urgent, onRelease }: PackageRowProps) {
  return (
    <Card className={urgent ? 'border-status-warning-border bg-status-warning-bg' : ''}>
      <CardContent className="p-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-sm font-medium">{pkg.label}</span>
          <span className="text-xs text-muted-foreground">{pkg.delivery_date}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRelease([pkg.id])}
        >
          Liberar
        </Button>
      </CardContent>
    </Card>
  );
}
