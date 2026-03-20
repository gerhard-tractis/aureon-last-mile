import { Card, CardContent } from '@/components/ui/card';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

interface DockZoneGridProps {
  zones: DockZoneRecord[];
}

export function DockZoneGrid({ zones }: DockZoneGridProps) {
  if (zones.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No hay andenes configurados para mostrar.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {zones.map((zone) => (
        <Card key={zone.id} className={zone.is_active ? '' : 'opacity-50'}>
          <CardContent className="p-4 space-y-1">
            <div className="font-semibold text-sm">{zone.name}</div>
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{zone.code}</code>
            <div className="text-xs text-muted-foreground">
              {zone.comunas.length} {zone.comunas.length === 1 ? 'comuna' : 'comunas'}
            </div>
            {!zone.is_active && (
              <div className="text-xs text-gray-400">Inactivo</div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
