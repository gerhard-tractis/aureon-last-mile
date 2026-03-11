import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import {
  validateScan,
  ScanValidationResult,
} from '@/lib/pickup/scan-validator';
import { playFeedback } from '@/lib/pickup/audio';

export interface ScanRecord {
  id: string;
  barcode_scanned: string;
  scan_result: 'verified' | 'not_found' | 'duplicate';
  scanned_at: string;
  package_id: string | null;
}

interface ScanInput {
  barcode: string;
  manifestId: string;
  operatorId: string;
  externalLoadId: string;
  userId: string;
}

export function usePickupScans(
  manifestId: string | null,
  operatorId: string | null
) {
  return useQuery({
    queryKey: ['pickup', 'scans', manifestId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('pickup_scans')
        .select('id, barcode_scanned, scan_result, scanned_at, package_id')
        .eq('manifest_id', manifestId!)
        .is('deleted_at', null)
        .order('scanned_at', { ascending: false });
      if (error) throw error;
      return data as ScanRecord[];
    },
    enabled: !!manifestId && !!operatorId,
    staleTime: 10_000,
  });
}

export function useScanMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ScanInput): Promise<ScanValidationResult> => {
      const result = await validateScan(
        input.barcode,
        input.manifestId,
        input.operatorId,
        input.externalLoadId
      );

      // Record the scan
      const supabase = createSPAClient();
      await supabase.from('pickup_scans').insert({
        operator_id: input.operatorId,
        manifest_id: input.manifestId,
        package_id: result.packageId,
        barcode_scanned: input.barcode,
        scan_result: result.scanResult,
        scanned_by_user_id: input.userId,
        scanned_at: new Date().toISOString(),
      });

      // Play feedback
      playFeedback(result.scanResult);

      return result;
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: ['pickup', 'scans', input.manifestId],
      });
    },
  });
}
