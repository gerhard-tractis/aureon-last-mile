import { useState, useEffect, useCallback } from 'react';
import { createSPAClient } from '@/lib/supabase/client';

export interface ManifestForHandoff {
  id: string;
  external_load_id: string;
  retailer_name: string | null;
  reception_status: string | null;
}

interface UseQRHandoffReturn {
  manifest: ManifestForHandoff | null;
  isLoading: boolean;
  isHandoffComplete: boolean;
  isSubmitting: boolean;
  qrPayload: string | null;
  error: string | null;
  initiateHandoff: () => Promise<void>;
}

/**
 * Hook for QR Handoff (Driver Side).
 *
 * Fetches manifest by externalLoadId, creates a hub_receptions record
 * with status='pending', sets manifests.reception_status='awaiting_reception',
 * and returns the manifest UUID for QR encoding.
 */
export function useQRHandoff(
  externalLoadId: string | null,
  operatorId: string | null
): UseQRHandoffReturn {
  const [manifest, setManifest] = useState<ManifestForHandoff | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isHandoffComplete, setIsHandoffComplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch manifest by externalLoadId
  useEffect(() => {
    if (!externalLoadId || !operatorId) return;

    setIsLoading(true);
    const supabase = createSPAClient();

    supabase
      .from('manifests')
      .select('id, external_load_id, retailer_name, reception_status')
      .eq('operator_id', operatorId)
      .eq('external_load_id', externalLoadId)
      .is('deleted_at', null)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError(fetchError.message);
        } else if (data) {
          setManifest(data as ManifestForHandoff);
        }
        setIsLoading(false);
      });
  }, [externalLoadId, operatorId]);

  const initiateHandoff = useCallback(async () => {
    if (!manifest || !operatorId) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const supabase = createSPAClient();

      // Get current user ID
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) throw new Error('No authenticated user');

      // Count verificado packages for expected_count
      const { data: packages, error: pkgError } = await supabase
        .from('packages')
        .select('id')
        .eq('manifest_id', manifest.id)
        .eq('status', 'verificado')
        .is('deleted_at', null);

      if (pkgError) throw pkgError;

      const expectedCount = packages?.length ?? 0;

      // Create hub_receptions record
      const { error: insertError } = await supabase
        .from('hub_receptions')
        .insert({
          manifest_id: manifest.id,
          operator_id: operatorId,
          delivered_by: userId,
          status: 'pending',
          expected_count: expectedCount,
          received_count: 0,
        });

      if (insertError) throw insertError;

      // Update manifest reception_status if not already set
      if (!manifest.reception_status) {
        const { error: updateError } = await supabase
          .from('manifests')
          .update({ reception_status: 'awaiting_reception' })
          .eq('id', manifest.id);

        if (updateError) throw updateError;
      }

      // Set QR payload to manifest UUID
      setQrPayload(manifest.id);
      setIsHandoffComplete(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al iniciar entrega';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [manifest, operatorId]);

  return {
    manifest,
    isLoading,
    isHandoffComplete,
    isSubmitting,
    qrPayload,
    error,
    initiateHandoff,
  };
}
