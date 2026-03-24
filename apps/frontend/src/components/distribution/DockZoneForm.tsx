'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from '@/components/ui/command';
import { useCreateDockZone, useUpdateDockZone } from '@/hooks/distribution/useDockZones';
import { useChileComunas } from '@/hooks/distribution/useChileComunas';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

interface DockZoneFormProps {
  operatorId: string;
  editingZone?: DockZoneRecord | null;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function DockZoneForm({ operatorId, onSuccess, onCancel, editingZone }: DockZoneFormProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const { data: allComunas = [] } = useChileComunas();
  const createMutation = useCreateDockZone(operatorId);
  const updateMutation = useUpdateDockZone(operatorId);

  useEffect(() => {
    if (editingZone) {
      setName(editingZone.name);
      setCode(editingZone.code);
      setSelectedIds(editingZone.comunas.map(c => c.id));
    } else {
      setName('');
      setCode('');
      setSelectedIds([]);
    }
  }, [editingZone]);

  const toggleComuna = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingZone) {
      updateMutation.mutate({ id: editingZone.id, name, code, comunaIds: selectedIds }, { onSuccess });
    } else {
      createMutation.mutate({ name, code, comunaIds: selectedIds }, { onSuccess });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const selectedComunas = allComunas.filter(c => selectedIds.includes(c.id));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="zone-name" className="block text-sm font-medium mb-1">Nombre</label>
        <Input
          id="zone-name"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Andén 1"
          required
        />
      </div>
      <div>
        <label htmlFor="zone-code" className="block text-sm font-medium mb-1">Código</label>
        <Input
          id="zone-code"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="DOCK-001"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Comunas</label>
        {selectedComunas.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {selectedComunas.map(c => (
              <Badge key={c.id} variant="secondary" className="gap-1">
                {c.nombre}
                <button
                  type="button"
                  className="ml-1 text-xs hover:text-destructive"
                  onClick={() => toggleComuna(c.id)}
                  aria-label={`Quitar ${c.nombre}`}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}
        <Command className="border rounded-md">
          <CommandInput placeholder="Buscar comuna..." />
          <CommandList className="max-h-40">
            <CommandEmpty>No se encontró.</CommandEmpty>
            <CommandGroup>
              {allComunas.map(c => (
                <CommandItem
                  key={c.id}
                  value={c.nombre}
                  onSelect={() => toggleComuna(c.id)}
                  className={selectedIds.includes(c.id) ? 'bg-accent' : ''}
                >
                  {c.nombre}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Guardando...' : 'Guardar'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
