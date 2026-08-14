import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ExpandedCarton {
  id: string;
  label: string;
  package_number: string | null;
  declared_box_count: number;
  parent_label: string | null;
  is_generated_label: boolean;
  order_id: string;
}

// The expand_carton RPC's RETURNS TABLE columns are named out_id, out_label,
// etc — NOT id/label. Bare column names there collide with plpgsql's
// RETURNS-TABLE-derived OUT variables of the same name (they shadow the
// packages table columns inside the function body and make every WHERE
// clause ambiguous), so the migration prefixes them. This is what actually
// comes back over the wire; map it to the friendly ExpandedCarton shape here
// rather than leaking out_* into every consumer.
interface ExpandCartonRpcRow {
  out_id: string;
  out_label: string;
  out_package_number: string | null;
  out_declared_box_count: number;
  out_parent_label: string | null;
  out_is_generated_label: boolean;
  out_order_id: string;
}

interface ExpandCartonInput {
  packageId: string;
  additionalBoxes: number;
  reason: string;
}

/**
 * spec-55 — mint additional Aureon carton IDs for a physically under-declared
 * package. Calls the expand_carton RPC (operator-scoped server-side via the
 * caller's JWT; the RPC itself is the tenant boundary, not this hook).
 *
 * On success, invalidates every useManifestOrders query so the new siblings
 * appear inline and every progress denominator derived from order.packages
 * updates without a manual refetch.
 */
export function useExpandCarton() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      packageId,
      additionalBoxes,
      reason,
    }: ExpandCartonInput): Promise<ExpandedCarton[]> => {
      const supabase = createSPAClient();
      const { data, error } = await supabase.rpc('expand_carton', {
        p_package_id: packageId,
        p_additional_boxes: additionalBoxes,
        p_reason: reason,
      });
      if (error) throw error;
      const rows = (data ?? []) as ExpandCartonRpcRow[];
      return rows.map((r) => ({
        id: r.out_id,
        label: r.out_label,
        package_number: r.out_package_number,
        declared_box_count: r.out_declared_box_count,
        parent_label: r.out_parent_label,
        is_generated_label: r.out_is_generated_label,
        order_id: r.out_order_id,
      }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup', 'manifest-orders'] });
    },
  });
}
