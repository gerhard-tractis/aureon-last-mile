import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import {
  validateReceptionScan,
  type ReceptionScanValidationResult,
} from '@/lib/reception/reception-scan-validator';
import { playFeedback } from '@/lib/pickup/audio';

interface ReceptionScanInput {
  barcode: string;
  routeId: string;
  routeReceptionId: string;
  operatorId: string;
  userId: string;
}

function toFeedbackType(scanResult: string): 'verified' | 'not_found' | 'duplicate' {
  if (scanResult === 'received') return 'verified';
  if (scanResult === 'duplicate') return 'duplicate';
  return 'not_found';
}

/**
 * Inserts a `reception_scans` row against a `route_receptions.id`. The DB
 * trigger increments `received_count` and promotes the reception from
 * `pending` → `in_progress` on first received scan. After the insert we
 * invalidate the snapshot query so the page re-renders with the latest
 * counts and the package's checkmark.
 *
 * The validator is called with `manifestId=''` because for consolidated
 * reception we accept any package belonging to ANY manifest on this route
 * — the validator already scopes to operator and does not narrow by
 * manifest.
 */
export function useReceptionScan() {
  const queryClient = useQueryClient();

  return useMutation<ReceptionScanValidationResult, Error, ReceptionScanInput>({
    mutationFn: async (input) => {
      const result = await validateReceptionScan({
        barcode: input.barcode,
        receptionId: input.routeReceptionId,
        manifestId: '',
        operatorId: input.operatorId,
      });

      const supabase = createSPAClient();
      const { error: insertError } = await supabase.from('reception_scans').insert({
        reception_id: input.routeReceptionId,
        operator_id: input.operatorId,
        package_id: result.packageId,
        barcode: input.barcode,
        scan_result: result.scanResult,
        scanned_by: input.userId,
        scanned_at: new Date().toISOString(),
      });
      if (insertError) throw insertError;

      playFeedback(toFeedbackType(result.scanResult));
      return result;
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: ['reception', 'route-snapshot', input.routeId],
      });
    },
  });
}
