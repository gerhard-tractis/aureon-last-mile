import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { validateDockScan } from '@/lib/distribution/dock-scan-validator';
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

export function useDockScanMutation(
  operatorId: string,
  batchId: string,
  targetZoneId: string,
  userId: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (barcode: string) => {
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
      });
      if (error) throw error;

      playFeedback(validationResult.scanResult === 'accepted' ? 'verified' : 'not_found');
      return validationResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distribution', 'scans', batchId] });
      queryClient.invalidateQueries({ queryKey: ['distribution', 'batch', batchId] });
    },
  });
}
