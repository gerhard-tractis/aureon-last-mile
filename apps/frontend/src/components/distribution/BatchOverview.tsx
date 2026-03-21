'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Package } from 'lucide-react';
import type { ZoneGroup } from '@/hooks/distribution/usePendingSectorization';

interface BatchOverviewProps {
  groups: ZoneGroup[];
  onStartBatch: (zoneId: string) => void;
}

export function BatchOverview({ groups, onStartBatch }: BatchOverviewProps) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <Package className="h-12 w-12 mb-4 opacity-40" />
        <p className="text-lg font-medium">No hay paquetes pendientes de sectorización</p>
        <p className="text-sm mt-1">Todos los paquetes en bodega ya han sido asignados a un andén.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map(({ zone, packages }) => {
        const count = packages.length;
        return (
          <Card key={zone.id} className="flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{zone.name}</CardTitle>
              <p className="text-sm font-mono text-muted-foreground">{zone.code}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 flex-1">
              <p className="text-sm text-muted-foreground">
                {count} {count === 1 ? 'paquete' : 'paquetes'} por sectorizar
              </p>
              <div className="mt-auto">
                <Button
                  className="w-full"
                  onClick={() => onStartBatch(zone.id)}
                >
                  Iniciar lote
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
