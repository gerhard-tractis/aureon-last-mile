import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface MissingPackage {
  id: string;
  label: string;
  order_id: string;
  order_number: string;
}

export interface DiscrepancyNote {
  id: string;
  package_id: string;
  note: string;
}

export function useMissingPackages(
  operatorId: string | null,
  externalLoadId: string | null,
  manifestId: string | null
) {
  return useQuery({
    queryKey: ['pickup', 'missing', manifestId],
    queryFn: async () => {
      const supabase = createSPAClient();

      // Get verified package IDs for this manifest
      const { data: verifiedScans } = await supabase
        .from('pickup_scans')
        .select('package_id')
        .eq('manifest_id', manifestId!)
        .eq('scan_result', 'verified')
        .is('deleted_at', null);

      const verifiedIds = (verifiedScans ?? [])
        .map((s) => s.package_id)
        .filter(Boolean) as string[];

      // Get all packages for this load
      const { data: orders } = await supabase
        .from('orders')
        .select('id, order_number')
        .eq('operator_id', operatorId!)
        .eq('external_load_id', externalLoadId!)
        .is('deleted_at', null);

      if (!orders || orders.length === 0) return [];

      const orderIds = orders.map((o) => o.id);
      const orderMap = new Map(orders.map((o) => [o.id, o.order_number]));

      const { data: allPackages } = await supabase
        .from('packages')
        .select('id, label, order_id')
        .in('order_id', orderIds)
        .is('deleted_at', null);

      const missing = (allPackages ?? [])
        .filter((p) => !verifiedIds.includes(p.id))
        .map((p) => ({
          id: p.id,
          label: p.label,
          order_id: p.order_id,
          order_number: orderMap.get(p.order_id) ?? '',
        }));

      return missing as MissingPackage[];
    },
    enabled: !!operatorId && !!externalLoadId && !!manifestId,
    staleTime: 10_000,
  });
}

export function useDiscrepancyNotes(manifestId: string | null) {
  return useQuery({
    queryKey: ['pickup', 'discrepancy-notes', manifestId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('discrepancy_notes')
        .select('id, package_id, note')
        .eq('manifest_id', manifestId!)
        .is('deleted_at', null);
      if (error) throw error;
      return data as DiscrepancyNote[];
    },
    enabled: !!manifestId,
    staleTime: 10_000,
  });
}

interface SaveNoteInput {
  operatorId: string;
  manifestId: string;
  packageId: string;
  note: string;
  userId: string;
}

export function useSaveDiscrepancyNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SaveNoteInput) => {
      const supabase = createSPAClient();

      // Check if note already exists for this package+manifest
      const { data: existing } = await supabase
        .from('discrepancy_notes')
        .select('id')
        .eq('manifest_id', input.manifestId)
        .eq('package_id', input.packageId)
        .is('deleted_at', null)
        .limit(1);

      if (existing && existing.length > 0) {
        const { error } = await supabase
          .from('discrepancy_notes')
          .update({ note: input.note })
          .eq('id', existing[0].id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('discrepancy_notes')
          .insert({
            operator_id: input.operatorId,
            manifest_id: input.manifestId,
            package_id: input.packageId,
            note: input.note,
            created_by_user_id: input.userId,
          });
        if (error) throw error;
      }
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({
        queryKey: ['pickup', 'discrepancy-notes', input.manifestId],
      });
    },
  });
}
