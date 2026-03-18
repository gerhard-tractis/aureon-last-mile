import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import {
  validateReceptionScan,
  ReceptionScanValidationResult,
} from '@/lib/reception/reception-scan-validator';
import { playFeedback } from '@/lib/pickup/audio';

export interface ReceptionScanRecord {
  id: string;
  barcode: string;
  scan_result: 'received' | 'not_found' | 'duplicate';
  scanned_at: string;
  package_id: string | null;
}

interface ReceptionScanInput {
  barcode: string;
  receptionId: string;
  manifestId: string;
  operatorId: string;
  userId: string;
}

/** Map reception scan results to audio feedback types */
function toFeedbackType(scanResult: string): 'verified' | 'not_found' | 'duplicate' {
  if (scanResult === 'received') return 'verified';
  if (scanResult === 'duplicate') return 'duplicate';
  return 'not_found';
}

export function useReceptionScans(
  receptionId: string | null,
  operatorId: string | null
) {
  return useQuery({
    queryKey: ['reception', 'scans', receptionId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('reception_scans')
        .select('id, barcode, scan_result, scanned_at, package_id')
        .eq('reception_id', receptionId!)
        .is('deleted_at', null)
        .order('scanned_at', { ascending: false });
      if (error) throw error;
      return data as ReceptionScanRecord[];
    },
    enabled: !!receptionId && !!operatorId,
    staleTime: 10_000,
  });
}

export function useReceptionScanMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ReceptionScanInput): Promise<ReceptionScanValidationResult> => {
      const result = await validateReceptionScan({
        barcode: input.barcode,
        receptionId: input.receptionId,
        manifestId: input.manifestId,
        operatorId: input.operatorId,
      });

      const supabase = createSPAClient();

      // Insert the scan record
      const { error: insertError } = await supabase.from('reception_scans').insert({
        reception_id: input.receptionId,
        operator_id: input.operatorId,
        package_id: result.packageId,
        barcode: input.barcode,
        scan_result: result.scanResult,
        scanned_by: input.userId,
        scanned_at: new Date().toISOString(),
      });
      if (insertError) throw insertError;

      // On first successful scan, advance reception to in_progress
      if (result.scanResult === 'received') {
        await advanceReceptionStatus(input.receptionId, input.manifestId, input.operatorId);
      }

      // Play multi-sensory feedback
      playFeedback(toFeedbackType(result.scanResult));

      return result;
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: ['reception', 'scans', input.receptionId],
      });
      queryClient.invalidateQueries({
        queryKey: ['reception', 'detail', input.receptionId],
      });
    },
  });
}

async function advanceReceptionStatus(
  receptionId: string,
  manifestId: string,
  operatorId: string
) {
  const supabase = createSPAClient();

  // Check current reception status
  const { data: reception } = await supabase
    .from('hub_receptions')
    .select('id, status, received_count')
    .eq('id', receptionId)
    .eq('operator_id', operatorId)
    .is('deleted_at', null)
    .single();

  if (!reception) return;

  // Update received_count
  const newCount = (reception.received_count ?? 0) + 1;
  const updates: Record<string, unknown> = {
    received_count: newCount,
    updated_at: new Date().toISOString(),
  };

  // Set to in_progress on first scan
  if (reception.status === 'pending') {
    updates.status = 'in_progress';
    updates.started_at = new Date().toISOString();
  }

  await supabase
    .from('hub_receptions')
    .update(updates)
    .eq('id', receptionId)
    .eq('operator_id', operatorId);

  // Also update manifest reception_status if still awaiting
  if (reception.status === 'pending') {
    await supabase
      .from('manifests')
      .update({
        reception_status: 'reception_in_progress',
        updated_at: new Date().toISOString(),
      })
      .eq('id', manifestId)
      .eq('operator_id', operatorId);
  }
}
