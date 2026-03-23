'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useQRHandoff } from '@/hooks/reception/useQRHandoff';
import { QRHandoff } from '@/components/reception/QRHandoff';
import { createSPAClient } from '@/lib/supabase/client';
import { Loader2, Truck, AlertCircle } from 'lucide-react';
import { PickupStepBreadcrumb } from '@/components/pickup/PickupStepBreadcrumb';

export default function HandoffPage() {
  const params = useParams();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId as string);
  const { operatorId } = useOperatorId();

  const [packageCount, setPackageCount] = useState<number>(0);

  const {
    manifest,
    isLoading,
    isHandoffComplete,
    isSubmitting,
    qrPayload,
    error,
    initiateHandoff,
  } = useQRHandoff(loadId, operatorId);

  // Fetch package count for display
  useEffect(() => {
    if (!manifest?.id || !operatorId) return;

    const supabase = createSPAClient();
    supabase
      .from('packages')
      .select('id')
      .eq('manifest_id', manifest.id)
      .eq('status', 'verificado')
      .is('deleted_at', null)
      .then(({ data }) => {
        setPackageCount(data?.length ?? 0);
      });
  }, [manifest?.id, operatorId]);

  // Show QR code after handoff
  if (isHandoffComplete && qrPayload) {
    return (
      <QRHandoff
        qrPayload={qrPayload}
        retailerName={manifest?.retailer_name ?? null}
        packageCount={packageCount}
        onDismiss={() => router.push('/app/pickup')}
      />
    );
  }

  // Loading state
  if (isLoading || !manifest) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <PickupStepBreadcrumb current="handoff" />

      {/* Gold header */}
      <div className="bg-accent text-accent-foreground p-4 -mx-4 rounded-none">
        <p className="text-xs opacity-80">{loadId}</p>
        <p className="font-semibold text-base mt-0.5">Handoff</p>
      </div>

      {/* Manifest Summary Card */}
      <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="bg-accent-muted rounded-full p-2">
            <Truck className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="font-semibold text-text">
              {manifest.retailer_name ?? 'Sin retailer'}
            </p>
            <p className="font-mono text-sm text-text-secondary">
              {packageCount} paquetes verificados
            </p>
          </div>
        </div>

        {manifest.reception_status && (
          <div className="bg-status-warning-bg border border-status-warning-border rounded-lg p-3">
            <p className="text-sm text-text">
              Esta carga ya tiene estado de recepción: {manifest.reception_status}
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-status-error-bg border border-status-error-border rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-status-error mt-0.5 shrink-0" />
          <p className="text-sm text-text">{error}</p>
        </div>
      )}

      {/* Handoff Button */}
      <button
        onClick={initiateHandoff}
        disabled={isSubmitting}
        className="w-full py-4 px-6 bg-accent hover:opacity-90 disabled:opacity-50 text-accent-foreground font-semibold rounded-lg transition-opacity flex items-center justify-center gap-2 min-h-[48px]"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Generando QR...
          </>
        ) : (
          'Entregar en bodega'
        )}
      </button>

      {/* Back */}
      <button
        onClick={() => router.back()}
        className="w-full py-3 text-text-secondary text-sm hover:text-text transition-colors"
      >
        Volver
      </button>
    </div>
  );
}
