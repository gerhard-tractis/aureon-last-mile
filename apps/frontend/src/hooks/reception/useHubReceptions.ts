import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface HubReceptionDetail {
  id: string;
  manifest_id: string;
  expected_count: number;
  received_count: number;
  status: string;
  discrepancy_notes: string | null;
  manifests: {
    id: string;
    external_load_id: string;
    retailer_name: string | null;
  } | null;
}

interface CompleteReceptionInput {
  receptionId: string;
  manifestId: string;
  operatorId: string;
  discrepancyNotes: string | null;
}

/**
 * Fetch a single hub_reception by ID with manifest info.
 */
export function useHubReception(
  receptionId: string | null,
  operatorId: string | null
) {
  return useQuery({
    queryKey: ['reception', 'detail', receptionId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('hub_receptions')
        .select(
          `id, manifest_id, expected_count, received_count, status, discrepancy_notes,
           manifests(id, external_load_id, retailer_name)`
        )
        .eq('id', receptionId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .single();

      if (error) throw error;
      return data as HubReceptionDetail;
    },
    enabled: !!receptionId && !!operatorId,
    staleTime: 10_000,
  });
}

/**
 * Mutation to complete a hub reception.
 * - Sets hub_receptions.status = 'completed', completed_at = NOW()
 * - Stores discrepancy_notes if provided
 * - Sets manifests.reception_status = 'received'
 */
export function useCompleteReception() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CompleteReceptionInput) => {
      const supabase = createSPAClient();
      const now = new Date().toISOString();

      // Update hub_receptions to completed
      const receptionUpdate: Record<string, unknown> = {
        status: 'completed',
        completed_at: now,
        updated_at: now,
      };

      if (input.discrepancyNotes) {
        receptionUpdate.discrepancy_notes = input.discrepancyNotes;
      }

      const { error: receptionError } = await supabase
        .from('hub_receptions')
        .update(receptionUpdate)
        .eq('id', input.receptionId)
        .eq('operator_id', input.operatorId);

      if (receptionError) throw receptionError;

      // Update manifest reception_status to 'received'
      const { error: manifestError } = await supabase
        .from('manifests')
        .update({
          reception_status: 'received',
          updated_at: now,
        })
        .eq('id', input.manifestId)
        .eq('operator_id', input.operatorId);

      if (manifestError) throw manifestError;
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: ['reception', 'detail', input.receptionId],
      });
      queryClient.invalidateQueries({
        queryKey: ['reception', 'manifests'],
      });
    },
  });
}
