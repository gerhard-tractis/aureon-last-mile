import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface RedirectBatchScanInput {
  scanId: string;
  packageId: string;
  consolidationZoneId: string;
  /** Current batch.package_count — used to compute the decremented value. */
  previousPackageCount: number;
}

/**
 * Modo Lote consolidación redirect (spec-39).
 *
 * The batch's dock_zone_id is fixed (one zone per batch in Lote mode), so to
 * "redirect" the most recent accepted package we:
 *  1. mark the dock_scans row with redirect_reason = 'manual_consolidation'
 *  2. move the package to status='retenido' on the consolidation zone
 *  3. decrement dock_batches.package_count to reflect the redirect
 */
export function useRedirectBatchScanToConsolidation(
  operatorId: string,
  batchId: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RedirectBatchScanInput) => {
      const supabase = createSPAClient();

      const { error: scanError } = await supabase
        .from('dock_scans')
        .update({ redirect_reason: 'manual_consolidation' })
        .eq('id', input.scanId)
        .eq('operator_id', operatorId);
      if (scanError) throw scanError;

      const { error: pkgError } = await supabase
        .from('packages')
        .update({
          status: 'retenido',
          dock_zone_id: input.consolidationZoneId,
          status_updated_at: new Date().toISOString(),
        })
        .eq('id', input.packageId)
        .eq('operator_id', operatorId);
      if (pkgError) throw pkgError;

      const nextCount = Math.max(0, input.previousPackageCount - 1);
      const { error: batchError } = await supabase
        .from('dock_batches')
        .update({ package_count: nextCount })
        .eq('id', batchId)
        .eq('operator_id', operatorId);
      if (batchError) throw batchError;

      return input;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'scans', batchId] });
      queryClient.invalidateQueries({ queryKey: ['distribution', 'batch', batchId] });
      queryClient.invalidateQueries({
        queryKey: ['distribution', 'consolidation', operatorId],
      });
      queryClient.invalidateQueries({
        queryKey: ['distribution', 'pending-sectorization', operatorId],
      });
    },
  });
}
