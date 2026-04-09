'use client';

import { useParams, useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useQRHandoff } from '@/hooks/reception/useQRHandoff';
import { QRHandoff } from '@/components/reception/QRHandoff';
import { Loader2, Truck, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PickupStepBreadcrumb } from '@/components/pickup/PickupStepBreadcrumb';

export default function HandoffPage() {
  const params = useParams();
  const router = useRouter();
  const loadId = decodeURIComponent(params.loadId as string);
  const { operatorId } = useOperatorId();

  const {
    manifest,
    verifiedPackageCount,
    isCountLoading,
    isLoading,
    isHandoffComplete,
    isSubmitting,
    qrPayload,
    error,
    initiateHandoff,
  } = useQRHandoff(loadId, operatorId);

  // The "Confirmar Pickup" button must be locked out in four cases:
  //   1. The handoff request is currently in flight (`isSubmitting`).
  //   2. The pickup_scans count hasn't loaded yet — pressing during this
  //      brief window would commit a 0-package handoff before the real
  //      count arrives (`isCountLoading`).
  //   3. The manifest legitimately has zero verified packages — there is
  //      nothing to hand off, the receiving hub would be told to expect a
  //      meaningless empty load.
  //   4. The manifest has already been handed off once
  //      (`reception_status` is non-null) — pressing again would create a
  //      second hub_receptions row competing with the first.
  const isHandoffDisabled =
    isSubmitting ||
    isCountLoading ||
    verifiedPackageCount === 0 ||
    !!manifest?.reception_status;

  // Show QR code after handoff
  if (isHandoffComplete && qrPayload) {
    return (
      <QRHandoff
        qrPayload={qrPayload}
        retailerName={manifest?.retailer_name ?? null}
        packageCount={verifiedPackageCount}
        onDismiss={() => router.push('/app/pickup')}
      />
    );
  }

  // Loading state
  if (isLoading || !manifest) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <PickupStepBreadcrumb current="handoff" />

      {/* Gold header */}
      <div className="bg-accent text-accent-foreground dark:bg-accent-muted dark:text-accent p-4 -mx-4 rounded-none">
        <p className="text-xs opacity-80">{loadId}</p>
        <p className="font-semibold text-base mt-0.5">Entrega en bodega</p>
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
              {verifiedPackageCount} paquetes verificados
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
      <Button
        onClick={initiateHandoff}
        disabled={isHandoffDisabled}
        className="w-full"
        size="lg"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Generando QR...
          </>
        ) : (
          'Confirmar Pickup'
        )}
      </Button>

      {/* Back */}
      <Button
        variant="ghost"
        onClick={() => router.back()}
        className="w-full"
      >
        Volver
      </Button>
    </div>
  );
}
