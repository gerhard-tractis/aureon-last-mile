'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCreateDockZone, useUpdateDockZone } from '@/hooks/distribution/useDockZones';
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
  const [comunasText, setComunasText] = useState('');

  const createMutation = useCreateDockZone(operatorId);
  const updateMutation = useUpdateDockZone(operatorId);

  useEffect(() => {
    if (editingZone) {
      setName(editingZone.name);
      setCode(editingZone.code);
      setComunasText(editingZone.comunas.join('\n'));
    } else {
      setName('');
      setCode('');
      setComunasText('');
    }
  }, [editingZone]);

  const parseComunas = (text: string): string[] =>
    text.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const comunas = parseComunas(comunasText);
    if (editingZone) {
      updateMutation.mutate({ id: editingZone.id, name, code, comunas }, { onSuccess });
    } else {
      createMutation.mutate({ name, code, comunas }, { onSuccess });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

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
        <label htmlFor="zone-comunas" className="block text-sm font-medium mb-1">Comunas (una por línea)</label>
        <Textarea
          id="zone-comunas"
          value={comunasText}
          onChange={e => setComunasText(e.target.value)}
          placeholder={'las condes\nvitacura\nprovidencia'}
          rows={5}
        />
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
