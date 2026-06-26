'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { createSPAClient } from '@/lib/supabase/client';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useRouteReceptionSnapshot } from '@/hooks/reception/useRouteReceptionSnapshot';
import { useReceptionScan } from '@/hooks/reception/useReceptionScan';
import { useCompleteRouteReception } from '@/hooks/reception/useCompleteRouteReception';
import { ReceptionScanner } from '@/components/reception/ReceptionScanner';
import { RouteReceptionHeader } from '@/components/reception/RouteReceptionHeader';
import { ConsolidatedScanList } from '@/components/reception/ConsolidatedScanList';
import { FinalizeReceptionButton } from '@/components/reception/FinalizeReceptionButton';
import type { ReceptionScanValidationResult } from '@/lib/reception/reception-scan-validator';

export default function RouteReceptionPage() {
  const params = useParams();
  const router = useRouter();
  const routeId = params.routeId as string;
  const { operatorId } = useOperatorId();

  const [userId, setUserId] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] =
    useState<ReceptionScanValidationResult | null>(null);

  useEffect(() => {
    const supabase = createSPAClient();
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  const { data: snapshot, isLoading, error } = useRouteReceptionSnapshot(routeId);
  const scanMutation = useReceptionScan();
  const completeMutation = useCompleteRouteReception();

  const handleScan = useCallback(
    (barcode: string) => {
      if (!snapshot || !operatorId || !userId) return;
      scanMutation.mutate(
        {
          barcode,
          routeId,
          routeReceptionId: snapshot.route_reception.id,
          operatorId,
          userId,
        },
        {
          onSuccess: (result) => {
            setLastScanResult(result);
            setTimeout(() => setLastScanResult(null), 3000);
          },
        },
      );
    },
    [snapshot, operatorId, userId, routeId, scanMutation],
  );

  const handleFinalize = useCallback(
    (notes: string | null) => {
      completeMutation.mutate(
        { routeId, discrepancyNotes: notes },
        {
          onSuccess: () => {
            toast.success('Recepción completada');
            router.push('/app/reception');
          },
          onError: (e) => {
            toast.error(e.message ?? 'Error al finalizar recepción');
          },
        },
      );
    },
    [routeId, completeMutation, router],
  );

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <Button variant="ghost" onClick={() => router.push('/app/reception')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <p className="text-status-error">
          {error?.message ?? 'No se pudo cargar la ruta'}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/app/reception')}
          aria-label="Volver a recepción"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        {completeMutation.isPending && (
          <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
        )}
      </div>

      <RouteReceptionHeader
        code={snapshot.route.code}
        driverName={snapshot.route.driver_name}
        vehicleLabel={snapshot.route.vehicle_label}
        manifestCount={snapshot.manifests.length}
        expectedCount={snapshot.route_reception.expected_count}
        receivedCount={snapshot.route_reception.received_count}
      />

      <ReceptionScanner
        onScan={handleScan}
        disabled={scanMutation.isPending}
        lastScanResult={lastScanResult}
      />

      <ConsolidatedScanList
        manifests={snapshot.manifests}
        expectedPackages={snapshot.expected_packages}
        scans={snapshot.scans}
      />

      <FinalizeReceptionButton
        receivedCount={snapshot.route_reception.received_count}
        expectedCount={snapshot.route_reception.expected_count}
        isPending={completeMutation.isPending}
        onFinalize={handleFinalize}
      />
    </div>
  );
}
