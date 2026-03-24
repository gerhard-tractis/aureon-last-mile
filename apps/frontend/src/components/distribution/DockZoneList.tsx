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

  return (
    <div className="space-y-3">
      {onAdd && (
        <div className="flex justify-end">
          <Button onClick={onAdd}>Agregar andén</Button>
        </div>
      )}
      {zones.map((zone) => (
        <Card key={zone.id} className={zone.is_consolidation ? 'border-blue-200 bg-blue-50/30' : ''}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{zone.name}</span>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{zone.code}</code>
                  {zone.is_consolidation && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Hub</span>
                  )}
                  {!zone.is_active && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inactivo</span>
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
