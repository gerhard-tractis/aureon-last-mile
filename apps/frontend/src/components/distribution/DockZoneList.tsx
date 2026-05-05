'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useDeleteDockZone, useUpdateDockZone } from '@/hooks/distribution/useDockZones';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import { DockLabel } from '@/components/distribution/DockLabel';

interface PrintZone {
  id: string;
  code: string;
  name: string;
}

interface DockZoneListProps {
  zones: DockZoneRecord[];
  operatorId: string;
  onEdit: (zone: DockZoneRecord) => void;
  onAdd?: () => void;
}

export function DockZoneList({ zones, operatorId, onEdit, onAdd }: DockZoneListProps) {
  const deleteMutation = useDeleteDockZone(operatorId);
  const updateMutation = useUpdateDockZone(operatorId);
  const [previewZones, setPreviewZones] = useState<PrintZone[]>([]);

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

  const printableZones: PrintZone[] = zones
    .filter((z) => z.is_active && !z.is_consolidation)
    .map(({ id, code, name }) => ({ id, code, name }));

  const openPrintWindow = () => {
    const ids = previewZones.map((z) => z.id).join(',');
    if (!ids) return;
    setPreviewZones([]);
    // Render the print page inside a hidden iframe — PrintLabels auto-fires
    // window.print() on mount, so the system print dialog opens without
    // navigating the user away from Configuración de Andenes.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-9999px;top:-9999px;';
    iframe.src = `/app/distribution/settings/labels/print?zoneIds=${ids}`;
    iframe.addEventListener('load', () => {
      iframe.contentWindow?.addEventListener('afterprint', () => iframe.remove());
    });
    document.body.appendChild(iframe);
  };

  return (
    <>
      <div className="space-y-3">
        {(onAdd || printableZones.length > 0) && (
          <div className="flex justify-end gap-2">
            {printableZones.length > 0 && (
              <Button
                variant="outline"
                aria-label="Imprimir todos los andenes"
                onClick={() => setPreviewZones(printableZones)}
              >
                Imprimir todos
              </Button>
            )}
            {onAdd && <Button onClick={onAdd}>Agregar andén</Button>}
          </div>
        )}
        {zones.map((zone) => (
          <Card key={zone.id} className={zone.is_consolidation ? 'border-status-info-border bg-status-info-bg' : ''}>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
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
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Imprimir ${zone.code}`}
                    onClick={() => setPreviewZones([{ id: zone.id, code: zone.code, name: zone.name }])}
                  >
                    Imprimir
                  </Button>
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

      <Dialog open={previewZones.length > 0} onOpenChange={(open) => { if (!open) setPreviewZones([]); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {previewZones.length === 1
                ? `${previewZones[0].code} · ${previewZones[0].name}`
                : `${previewZones.length} andenes seleccionados`}
            </DialogTitle>
          </DialogHeader>

          {previewZones.length === 1 ? (
            <div className="rounded border overflow-y-auto max-h-[60vh]">
              <DockLabel code={previewZones[0].code} name={previewZones[0].name} compact />
            </div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto py-1">
              {previewZones.map((z) => (
                <div key={z.id} className="flex items-center gap-3 text-sm px-1">
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs">{z.code}</code>
                  <span>{z.name}</span>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button onClick={openPrintWindow}>Imprimir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
