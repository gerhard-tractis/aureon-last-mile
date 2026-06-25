'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useActivePickupRoute } from '@/hooks/pickup/useActivePickupRoute';
import {
  useRouteManifests,
  useUnassignedManifests,
} from '@/hooks/pickup/useRouteManifests';
import { useAddManifestToRoute } from '@/hooks/pickup/useAddManifestToRoute';
import { useClosePickupRoute } from '@/hooks/pickup/useClosePickupRoute';
import { RouteManifestList } from '@/components/pickup/RouteManifestList';
import { AddManifestSheet } from '@/components/pickup/AddManifestSheet';
import { CloseRouteButton } from '@/components/pickup/CloseRouteButton';
import { toast } from 'sonner';

export default function ActiveRoutePage() {
  const router = useRouter();
  const { operatorId } = useOperatorId();
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: route, isLoading: routeLoading } = useActivePickupRoute(operatorId);
  const { data: routeManifests = [], isLoading: rmLoading } = useRouteManifests(
    route?.id ?? null,
    operatorId,
  );
  const { data: unassigned = [], isLoading: unLoading } =
    useUnassignedManifests(operatorId);
  const addMut = useAddManifestToRoute(operatorId);
  const closeMut = useClosePickupRoute(operatorId);

  if (routeLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!route) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4 text-center">
        <p className="text-text">No tienes una ruta activa.</p>
        <Button onClick={() => router.push('/app/pickup')}>Volver</Button>
      </div>
    );
  }

  const totalVerified = routeManifests.reduce((s, m) => s + m.verified_count, 0);

  const handleAdd = (manifestId: string) => {
    addMut.mutate(
      { routeId: route.id, manifestId },
      {
        onSuccess: () => {
          toast.success('Manifiesto agregado');
          setSheetOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleClose = () => {
    closeMut.mutate(
      { routeId: route.id },
      {
        onSuccess: () => {
          router.push(`/app/pickup/route/${route.id}/qr`);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4 pb-24">
      <header className="rounded-lg border border-border bg-surface p-4">
        <p className="font-mono text-sm font-semibold text-text">{route.code}</p>
        <p className="text-xs text-text-secondary mt-1">
          Iniciada {new Date(route.started_at).toLocaleString()}
          {route.vehicle_label ? ` · ${route.vehicle_label}` : ''}
        </p>
        <p className="text-xs text-text-secondary mt-1">
          {routeManifests.length} manifiestos · {totalVerified} paquetes verificados
        </p>
      </header>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-text">Manifiestos en la ruta</h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSheetOpen(true)}
            className="gap-1"
            data-testid="open-add-manifest"
          >
            <Plus className="h-4 w-4" /> Agregar manifiesto
          </Button>
        </div>
        {rmLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
          </div>
        ) : (
          <RouteManifestList
            manifests={routeManifests}
            onManifestClick={(loadId) =>
              router.push(`/app/pickup/scan/${encodeURIComponent(loadId)}`)
            }
          />
        )}
      </div>

      <AddManifestSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        manifests={unassigned}
        isLoading={unLoading}
        isAdding={addMut.isPending}
        onPick={handleAdd}
      />

      <div className="fixed bottom-0 inset-x-0 bg-background border-t border-border p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <CloseRouteButton
            totalVerified={totalVerified}
            isSubmitting={closeMut.isPending}
            onClose={handleClose}
          />
        </div>
      </div>
    </div>
  );
}
