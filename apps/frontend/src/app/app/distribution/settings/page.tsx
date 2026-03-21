'use client';

import { useState, useEffect } from 'react';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useDockZones, useEnsureConsolidationZone } from '@/hooks/distribution/useDockZones';
import { DockZoneList } from '@/components/distribution/DockZoneList';
import { DockZoneForm } from '@/components/distribution/DockZoneForm';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { DockZoneRecord } from '@/hooks/distribution/useDockZones';

export default function DistributionSettingsPage() {
  const { operatorId } = useOperatorId();
  const { data: zones, isLoading } = useDockZones(operatorId);
  const ensureConsolidation = useEnsureConsolidationZone(operatorId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<DockZoneRecord | null>(null);

  useEffect(() => {
    if (operatorId) {
      ensureConsolidation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorId]);

  const handleEdit = (zone: DockZoneRecord) => {
    setEditingZone(zone);
    setDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingZone(null);
    setDialogOpen(true);
  };

  const handleSuccess = () => {
    setDialogOpen(false);
    setEditingZone(null);
  };

  if (isLoading) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Configuración de Andenes</h1>
      </div>

      <DockZoneList
        zones={zones ?? []}
        operatorId={operatorId ?? ''}
        onEdit={handleEdit}
        onAdd={handleAdd}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingZone ? 'Editar andén' : 'Nuevo andén'}</DialogTitle>
          </DialogHeader>
          <DockZoneForm
            operatorId={operatorId ?? ''}
            onSuccess={handleSuccess}
            onCancel={() => setDialogOpen(false)}
            editingZone={editingZone}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
