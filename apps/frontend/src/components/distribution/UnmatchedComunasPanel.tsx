'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Command, CommandInput, CommandList,
  CommandGroup, CommandItem, CommandEmpty,
} from '@/components/ui/command';
import { useUnmatchedComunas, useMapComunaAlias } from '@/hooks/distribution/useUnmatchedComunas';
import { useChileComunas } from '@/hooks/distribution/useChileComunas';

interface UnmatchedComunasPanelProps {
  operatorId: string;
}

export function UnmatchedComunasPanel({ operatorId }: UnmatchedComunasPanelProps) {
  const { data: unmatched = [], isLoading } = useUnmatchedComunas(operatorId);
  const { data: allComunas = [] } = useChileComunas();
  const mapAlias = useMapComunaAlias(operatorId);

  const [dialogOpen, setDialogOpen]             = useState(false);
  const [selectedRaw, setSelectedRaw]           = useState<string | null>(null);
  const [selectedComunaId, setSelectedComunaId] = useState<string | null>(null);

  if (isLoading || unmatched.length === 0) return null;

  const handleMapear = (raw: string) => {
    setSelectedRaw(raw);
    setSelectedComunaId(null);
    setDialogOpen(true);
  };

  const handleConfirm = () => {
    if (!selectedRaw || !selectedComunaId) return;
    mapAlias.mutate(
      { alias: selectedRaw, comunaId: selectedComunaId },
      { onSuccess: () => setDialogOpen(false) }
    );
  };

  return (
    <div className="mt-8">
      <h2 className="text-base font-semibold mb-1">Comunas sin mapear</h2>
      <p className="text-sm text-muted-foreground mb-3">
        Estos valores no se reconocieron como comunas chilenas. Mapéalas para que la sectorización automática funcione correctamente.
      </p>
      <div className="border rounded-md divide-y">
        {unmatched.map(row => (
          <div key={row.comuna_raw} className="flex items-center justify-between px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm">{row.comuna_raw}</span>
              <Badge variant="secondary">{row.order_count} órdenes</Badge>
            </div>
            <Button size="sm" variant="outline" onClick={() => handleMapear(row.comuna_raw)}>
              Mapear
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mapear &ldquo;{selectedRaw}&rdquo;</DialogTitle>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Buscar..." />
            <CommandList className="max-h-60">
              <CommandEmpty>No encontrado.</CommandEmpty>
              <CommandGroup>
                {allComunas.map(c => (
                  <CommandItem
                    key={c.id}
                    value={c.nombre}
                    onSelect={() => setSelectedComunaId(c.id)}
                    className={selectedComunaId === c.id ? 'bg-accent' : ''}
                  >
                    {c.nombre}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
          <DialogFooter>
            <Button
              onClick={handleConfirm}
              disabled={!selectedComunaId || mapAlias.isPending}
            >
              {mapAlias.isPending ? 'Guardando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
