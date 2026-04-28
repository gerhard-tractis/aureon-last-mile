import { createSPAClient } from '@/lib/supabase/client';

export interface UpdateBatchDockZoneInput {
  batchId: string;
  zoneId: string;
  operatorId: string;
}

/**
 * Switches a dock_batch's dock_zone_id. Used by Quicksort consolidación redirect (spec-39):
 * the trigger that advances package status reads `dock_batches.dock_zone_id`, so we change
 * the batch's zone to consolidación before recording the scan.
 */
export async function updateBatchDockZone(input: UpdateBatchDockZoneInput) {
  const supabase = createSPAClient();
  const { error } = await supabase
    .from('dock_batches')
    .update({ dock_zone_id: input.zoneId })
    .eq('id', input.batchId)
    .eq('operator_id', input.operatorId);
  return { error };
}
