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
  // Text, not number: an empty numeric input reports NaN/"" inconsistently
  // across browsers, and empty must persist as null, never 0.
  const [capacityInput, setCapacityInput] = useState('');

  const { data: allComunas = [] } = useChileComunas();
  const createMutation = useCreateDockZone(operatorId);
  const updateMutation = useUpdateDockZone(operatorId);

  useEffect(() => {
    if (editingZone) {
      setName(editingZone.name);
      setCode(editingZone.code);
      setSelectedIds(editingZone.comunas.map(c => c.id));
      // <= 0 normalizes to empty, same as dock-capacity.ts treats it as
      // "not configured". Without this, opening the edit dialog on a zone a
      // DBA set to 0/-1 pre-populates that value verbatim; combined with the
      // field's min={1} that blocks *every* field's submission via native
      // rangeUnderflow, not just capacity.
      setCapacityInput(
        editingZone.capacity == null || editingZone.capacity <= 0
          ? ''
          : String(editingZone.capacity)
      );
    } else {
      setName('');
      setCode('');
      setSelectedIds([]);
      setCapacityInput('');
    }
  }, [editingZone]);

  const toggleComuna = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = capacityInput.trim();
    const capacity = trimmed === '' ? null : Number(trimmed);
    if (editingZone) {
      updateMutation.mutate({ id: editingZone.id, name, code, comunaIds: selectedIds, capacity }, { onSuccess });
    } else {
      createMutation.mutate({ name, code, comunaIds: selectedIds, capacity }, { onSuccess });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const mutationError = createMutation.isError
    ? createMutation.error
    : updateMutation.isError
      ? updateMutation.error
      : null;
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
      <div>
        <label htmlFor="zone-capacity" className="block text-sm font-medium mb-1">
          Capacidad (paquetes)
        </label>
        <Input
          id="zone-capacity"
          type="number"
          min={1}
          max={2147483647}
          inputMode="numeric"
          value={capacityInput}
          onChange={e => setCapacityInput(e.target.value)}
          placeholder="Opcional"
        />
      </div>
      {mutationError && (
        <p role="alert" className="text-sm text-status-error-text">
          No se pudo guardar: {mutationError instanceof Error ? mutationError.message : 'intenta de nuevo.'}
        </p>
      )}
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
