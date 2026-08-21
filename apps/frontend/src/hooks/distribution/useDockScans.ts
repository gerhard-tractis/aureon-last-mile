import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { validateDockScan } from '@/lib/distribution/dock-scan-validator';
import { recordDockVerification } from '@/lib/distribution/record-dock-verification';
import { playFeedback } from '@/lib/pickup/audio';

export interface DockScanRecord {
  id: string;
  barcode: string;
  scan_result: 'accepted' | 'rejected' | 'wrong_zone' | 'unmapped';
  scanned_at: string;
  package_id: string | null;
}

export function useDockScans(batchId: string | null, operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'scans', batchId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dock_scans')
        .select('id, barcode, scan_result, scanned_at, package_id')
        .eq('batch_id', batchId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .order('scanned_at', { ascending: false });
      if (error) throw error;
      return data as DockScanRecord[];
    },
    enabled: !!batchId && !!operatorId,
    staleTime: 10_000,
  });
}

export interface DockScanMutationInput {
  barcode: string;
  /** When set, marks the scan as a redirect away from the batch's zone (spec-39). */
  redirectReason?: 'manual_consolidation';
}

export function useDockScanMutation(
  operatorId: string,
  batchId: string,
  targetZoneId: string,
  userId: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | DockScanMutationInput) => {
      const normalized: DockScanMutationInput =
        typeof input === 'string' ? { barcode: input } : input;
      const { barcode, redirectReason } = normalized;

      const validationResult = await validateDockScan({
        barcode,
        batchId,
        targetZoneId,
        operatorId,
        mode: 'batch',
      });

      const supabase = createSPAClient();
      const { error } = await supabase.from('dock_scans').insert({
        operator_id: operatorId,
        batch_id: batchId,
        package_id: validationResult.packageId,
        barcode,
        scan_result: validationResult.scanResult,
        scanned_by: userId,
        scanned_at: new Date().toISOString(),
        ...(redirectReason ? { redirect_reason: redirectReason } : {}),
      });
      if (error) throw error;

      // An accepted scan is eyes-on the package, so it verifies it too — the
      // pending list reads its green state from dock_verifications, and without
      // this a scanned CTN looks identical to one nobody has touched.
      //
      // Never at the cost of the scan: dock_scans is the record that matters,
      // so a failed verification costs the crew a chip, not the scan.
      if (validationResult.scanResult === 'accepted' && validationResult.packageId) {
        try {
          await recordDockVerification({
            operatorId,
            packageId: validationResult.packageId,
            userId,
            source: 'scan',
          });
        } catch (verificationError) {
          console.error('dock verification failed after scan', verificationError);
        }
      }

      playFeedback(validationResult.scanResult === 'accepted' ? 'verified' : 'not_found');
      return validationResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'scans', batchId] });
      queryClient.invalidateQueries({ queryKey: ['distribution', 'batch', batchId] });
      // Repaint the pending list on this device without waiting for realtime.
      queryClient.invalidateQueries({
        queryKey: ['distribution', 'dock-verifications', operatorId],
      });
    },
  });
}
