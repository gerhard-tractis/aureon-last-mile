'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useDeleteDockZone, useUpdateDockZone } from '@/hooks/distribution/useDockZones';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

interface DockZoneListProps {
  zones: DockZoneRecord[];
  operatorId: string;
  onEdit: (zone: DockZoneRecord) => void;
  onAdd?: () => void;
}

export function DockZoneList({ zones, operatorId, onEdit, onAdd }: DockZoneListProps) {
  const deleteMutation = useDeleteDockZone(operatorId);
  const updateMutation = useUpdateDockZone(operatorId);

  if (zones.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground mb-4">
          No hay andenes configurados. Agrega tu primer andén.
        </p>
        {onAdd && (
          <Button onClick={onAdd}>Agregar andén</Button>
        )}
      </div>
    );
  }

  const toggleActive = (zone: DockZoneRecord) => {
    updateMutation.mutate({ id: zone.id, is_active: !zone.is_active });
  };

  const printableZoneIds = zones
    .filter((z) => z.is_active && !z.is_consolidation)
    .map((z) => z.id);
  const printAllHref = printableZoneIds.length > 0
    ? `/app/distribution/settings/labels/print?zoneIds=${printableZoneIds.join(',')}`
    : null;

  return (
    <div className="space-y-3">
      {(onAdd || printAllHref) && (
        <div className="flex justify-end gap-2">
          {printAllHref && (
            <a
              href={printAllHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Imprimir todos los andenes"
            >
              <Button variant="outline">Imprimir todos</Button>
            </a>
          )}
          {onAdd && <Button onClick={onAdd}>Agregar andén</Button>}
        </div>
      )}
      {zones.map((zone) => (
        <Card key={zone.id} className={zone.is_consolidation ? 'border-status-info-border bg-status-info-bg' : ''}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{zone.name}</span>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{zone.code}</code>
                  {zone.is_consolidation && (
                    <span className="text-xs bg-status-info-bg text-status-info px-1.5 py-0.5 rounded">Hub</span>
                  )}
                  {!zone.is_active && (
                    <span className="text-xs bg-surface-raised text-text-muted px-1.5 py-0.5 rounded">Inactivo</span>
                  )}
                </div>
                {zone.comunas.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {zone.comunas.map((c) => (
                      <span key={c.id} className="text-xs bg-muted px-2 py-0.5 rounded-full">{c.nombre}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={`/app/distribution/settings/labels/print?zoneIds=${zone.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Imprimir ${zone.code}`}
                >
                  <Button variant="outline" size="sm">
                    Imprimir
                  </Button>
                </a>
                {!zone.is_consolidation && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleActive(zone)}
                    >
                      {zone.is_active ? 'Desactivar' : 'Activar'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEdit(zone)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate(zone.id)}
                    >
                      Eliminar
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
