'use client';

import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useRoutePreview } from '@/hooks/reception/useRoutePreview';
import { RoutePreviewCard } from '@/components/reception/RoutePreviewCard';
import { ReceiveWithoutQRButton } from '@/components/reception/ReceiveWithoutQRButton';

/**
 * Read-only landing for a route the hub is watching but has not received.
 *
 * There is deliberately no `open_route_reception` call on mount. The rows that
 * lead here are trucks still out collecting, and one stray tap would stamp a
 * false arrival, freeze `expected_count` mid-trip and lock the driver out of
 * scanning the rest of the route. Opening requires the QR — or the explicit,
 * confirmed "Recibir sin QR" below. The trip must never end by accident.
 */
export default function RoutePreviewPage() {
  const params = useParams();
  const router = useRouter();
  const routeId = params.routeId as string;
  const { operatorId } = useOperatorId();

  const { data: route, isLoading, error } = useRoutePreview(routeId, operatorId);

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-4">
        <Skeleton className="h-10 w-24 rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !route) {
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
      <Button
        variant="ghost"
        size="icon"
        onClick={() => router.push('/app/reception')}
        aria-label="Volver a recepción"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <RoutePreviewCard route={route}>
        <ReceiveWithoutQRButton
          routeId={route.id}
          code={route.code}
          plate={route.vehicle_plate}
        />
      </RoutePreviewCard>

      <p className="text-xs text-text-muted text-center">
        Usa &quot;Recibir sin QR&quot; solo si el código de la ruta está dañado o
        no se puede escanear.
      </p>
    </div>
  );
}
