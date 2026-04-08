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
  /**
   * Count of unique packages verified for this manifest, derived from
   * `pickup_scans` rows where `scan_result = 'verified'`. Deduplicated by
   * `package_id` so a re-scanned package is counted once. This is the single
   * source of truth used both for the on-screen counter and for the
   * `expected_count` field on the hub_receptions row created at handoff.
   * Refreshed at handoff time to avoid sending a stale snapshot to the hub.
   */
  verifiedPackageCount: number;
  /**
   * `true` until the initial pickup_scans fetch resolves. Distinguishes
   * "still loading" from "loaded as zero", which the handoff button needs to
   * avoid committing a phantom 0-package handoff during the brief load race.
   */
  isCountLoading: boolean;
  isLoading: boolean;
  isHandoffComplete: boolean;
  isSubmitting: boolean;
  qrPayload: string | null;
  error: string | null;
  initiateHandoff: () => Promise<void>;
}

/**
 * Count unique verified packages for a manifest from pickup_scans, deduped
 * by package_id. Shared by the page-load useEffect and the initiateHandoff
 * refetch so both code paths use the exact same query and dedup logic.
 *
 * Returns null if the query errored (caller decides how to surface the error).
 */
async function fetchVerifiedPackageCount(
  supabase: ReturnType<typeof createSPAClient>,
  operatorId: string,
  manifestId: string
): Promise<{ count: number | null; error: string | null }> {
  const { data, error: scansError } = await supabase
    .from('pickup_scans')
    .select('package_id')
    .eq('operator_id', operatorId)
    .eq('manifest_id', manifestId)
    .eq('scan_result', 'verified')
    .is('deleted_at', null);

  if (scansError) {
    return { count: null, error: scansError.message };
  }

  const uniqueIds = new Set(
    (data ?? [])
      .map((row: { package_id: string | null }) => row.package_id)
      .filter((id): id is string => id !== null)
  );
  return { count: uniqueIds.size, error: null };
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
  const [verifiedPackageCount, setVerifiedPackageCount] = useState<number>(0);
  const [isCountLoading, setIsCountLoading] = useState<boolean>(true);
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
          const loadedManifest = data as ManifestForHandoff;
          setManifest(loadedManifest);
          // If the manifest was already handed off (reception_status set),
          // short-circuit straight to the QR view. This happens when the
          // operator opens the manifest from the En tránsito tab — they need
          // to see the QR they handed off, not the form they can no longer
          // submit (button is disabled by the re-handoff guard).
          if (loadedManifest.reception_status) {
            setQrPayload(loadedManifest.id);
            setIsHandoffComplete(true);
          }
        }
        setIsLoading(false);
      });
  }, [externalLoadId, operatorId]);

  // Once the manifest is known, count verified packages from pickup_scans.
  // The `packages` table has no `manifest_id` column — packages are linked
  // to manifests only through `pickup_scans(manifest_id, package_id)`. Use
  // that table as the single source of truth and dedupe by package_id so a
  // double-scan of the same label still counts once.
  useEffect(() => {
    if (!manifest?.id || !operatorId) return;

    setIsCountLoading(true);
    const supabase = createSPAClient();
    fetchVerifiedPackageCount(supabase, operatorId, manifest.id).then(
      ({ count, error: countError }) => {
        if (countError) {
          setError(countError);
        } else if (count !== null) {
          setVerifiedPackageCount(count);
        }
        setIsCountLoading(false);
      }
    );
  }, [manifest?.id, operatorId]);

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

      // Refetch the count right before insert. The page-load snapshot in
      // verifiedPackageCount could be stale if more packages were scanned
      // between opening the handoff page and pressing the button (e.g. on
      // another device, or after a navigate-back-and-rescan flow). Use the
      // fresh value for hub_receptions.expected_count and update the local
      // state so the QR view shows the operator the same number that was
      // actually committed.
      const { count: freshCount, error: countError } =
        await fetchVerifiedPackageCount(supabase, operatorId, manifest.id);
      if (countError) throw new Error(countError);
      const expectedCount = freshCount ?? 0;
      setVerifiedPackageCount(expectedCount);

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
    verifiedPackageCount,
    isCountLoading,
    isLoading,
    isHandoffComplete,
    isSubmitting,
    qrPayload,
    error,
    initiateHandoff,
  };
}
