'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';
import {
  useDockZoneAdjacencyPairs,
  useAddDockZoneAdjacencyPair,
  useRemoveDockZoneAdjacencyPair,
} from '@/hooks/distribution/useDockZoneAdjacency';
import { canManageDockZoneAdjacency } from '@/lib/permissions';

/**
 * spec-73 Phase 3 — flat-table adjacency management. NO map, NO drag-and-drop
 * (spec's explicit Non-Goal) — two andén pickers and a list, same shape as
 * DockZoneList/DockZoneForm one level up.
 *
 * `canManageDockZoneAdjacency` gates the add/remove controls here — defence
 * in depth only. The authority is the RPC's own role check (migration
 * 20260905000001); a user without the role who somehow reaches this screen
 * sees the list read-only rather than a form that would error on submit.
 */
interface DockZoneAdjacencyListProps {
  operatorId: string;
  zones: DockZoneRecord[];
  role: string | null;
}

export function DockZoneAdjacencyList({ operatorId, zones, role }: DockZoneAdjacencyListProps) {
  const canManage = canManageDockZoneAdjacency(role);
  const { data: pairs, isLoading } = useDockZoneAdjacencyPairs(operatorId);
  const addMutation = useAddDockZoneAdjacencyPair(operatorId);
  const removeMutation = useRemoveDockZoneAdjacencyPair(operatorId);

  const [zoneAId, setZoneAId] = useState('');
  const [zoneBId, setZoneBId] = useState('');

  const canSubmit = !!zoneAId && !!zoneBId && zoneAId !== zoneBId;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    addMutation.mutate(
      { dockZoneId: zoneAId, adjacentZoneId: zoneBId },
      { onSuccess: () => { setZoneAId(''); setZoneBId(''); } },
    );
  };

  const handleRemove = (pair: { zoneAId: string; zoneBId: string }) => {
    removeMutation.mutate({ dockZoneId: pair.zoneAId, adjacentZoneId: pair.zoneBId });
  };

  const zonesForB = zones.filter((z) => z.id !== zoneAId);

  return (
    <div className="space-y-4">
      {canManage && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleAdd} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1" htmlFor="adjacency-zone-a">
                  Andén
                </label>
                <Select value={zoneAId} onValueChange={setZoneAId}>
                  <SelectTrigger id="adjacency-zone-a" aria-label="Andén">
                    <SelectValue placeholder="Selecciona un andén" />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.code} · {z.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium mb-1" htmlFor="adjacency-zone-b">
                  Es adyacente a
                </label>
                <Select value={zoneBId} onValueChange={setZoneBId} disabled={!zoneAId}>
                  <SelectTrigger id="adjacency-zone-b" aria-label="Es adyacente a">
                    <SelectValue placeholder="Selecciona un andén" />
                  </SelectTrigger>
                  <SelectContent>
                    {zonesForB.map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.code} · {z.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={!canSubmit || addMutation.isPending}>
                {addMutation.isPending ? 'Agregando...' : 'Agregar adyacencia'}
              </Button>
            </form>
            {addMutation.isError && (
              <p role="alert" className="text-sm text-status-error-text mt-2">
                No se pudo agregar: {addMutation.error instanceof Error ? addMutation.error.message : 'intenta de nuevo.'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : !pairs || pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No hay adyacencias configuradas.
        </p>
      ) : (
        <div className="space-y-2">
          {pairs.map((pair) => (
            <Card key={pair.id}>
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="text-sm">
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs">{pair.zoneACode}</code>
                  <span className="mx-2 text-muted-foreground">↔</span>
                  <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs">{pair.zoneBCode}</code>
                  <span className="ml-2 text-muted-foreground">
                    {pair.zoneAName} / {pair.zoneBName}
                  </span>
                </div>
                {canManage && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleRemove(pair)}
                    disabled={removeMutation.isPending}
                  >
                    Quitar
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
