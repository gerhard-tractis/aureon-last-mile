import { Card, CardContent } from '@/components/ui/card';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { Layers } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';

interface DockZoneGridProps {
  zones: DockZoneRecord[];
  sectorizedCounts?: Record<string, number>;
}

export function DockZoneGrid({ zones, sectorizedCounts }: DockZoneGridProps) {
  if (zones.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="Sin andenes activos"
        description="Todos los andenes están inactivos. Activa al menos uno para ver la grilla de distribución."
        action={{ label: 'Configurar andenes', href: '/app/distribution/settings' }}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {zones.map((zone) => {
        const count = sectorizedCounts?.[zone.id] ?? 0;
        return (
          <Card key={zone.id} className={zone.is_active ? '' : 'opacity-50'}>
            <CardContent className="p-4 space-y-1">
              <div className="font-semibold text-sm">{zone.name}</div>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{zone.code}</code>
              <div className="text-2xl font-bold tabular-nums">{count}</div>
              <div className="text-xs text-muted-foreground">
                {count === 1 ? 'paquete' : 'paquetes'}
              </div>
              <div className="text-xs text-muted-foreground">
                {zone.comunas.length} {zone.comunas.length === 1 ? 'comuna' : 'comunas'}
              </div>
              {!zone.is_active && (
                <div className="text-xs text-text-muted">Inactivo</div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
