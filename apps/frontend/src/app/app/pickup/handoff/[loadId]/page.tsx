'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useQRHandoff } from '@/hooks/reception/useQRHandoff';
import { QRHandoff } from '@/components/reception/QRHandoff';
import { createSPAClient } from '@/lib/supabase/client';
import { Loader2, Truck, AlertCircle } from 'lucide-react';

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
    <div className="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-gray-900">
          Entrega en Bodega
        </h1>
        <p className="text-sm text-gray-500">
          Carga: {loadId}
        </p>
      </div>

      {/* Manifest Summary Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="bg-blue-50 rounded-full p-2">
            <Truck className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">
              {manifest.retailer_name ?? 'Sin retailer'}
            </p>
            <p className="text-sm text-gray-500">
              {packageCount} paquetes verificados
            </p>
          </div>
        </div>

        {manifest.reception_status && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-sm text-amber-800">
              Esta carga ya tiene estado de recepción: {manifest.reception_status}
            </p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Handoff Button */}
      <button
        onClick={initiateHandoff}
        disabled={isSubmitting}
        className="w-full py-4 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
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
        className="w-full py-3 text-gray-500 text-sm hover:text-gray-700 transition-colors"
      >
        Volver
      </button>
    </div>
  );
}
