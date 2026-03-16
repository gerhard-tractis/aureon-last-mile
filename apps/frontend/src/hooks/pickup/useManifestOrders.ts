import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ManifestPackage {
  id: string;
  label: string;
  package_number: string | null;
  sku_items: Array<{ sku: string; description: string; quantity: number }>;
  declared_weight_kg: number | null;
}

export interface ManifestOrder {
  id: string;
  order_number: string;
  customer_name: string;
  comuna: string;
  delivery_address: string;
  packages: ManifestPackage[];
}

export function useManifestOrders(
  externalLoadId: string | null,
  operatorId: string | null
) {
  return useQuery({
    queryKey: ['pickup', 'manifest-orders', externalLoadId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, customer_name, comuna, delivery_address, packages(id, label, package_number, sku_items, declared_weight_kg, deleted_at)')
        .eq('operator_id', operatorId!)
        .eq('external_load_id', externalLoadId!)
        .is('deleted_at', null)
        .order('order_number', { ascending: true });
      if (error) throw error;
      // Filter out soft-deleted packages client-side
      type RawOrder = Omit<ManifestOrder, 'packages'> & { packages: (ManifestPackage & { deleted_at?: string | null })[] };
      return ((data ?? []) as RawOrder[]).map(order => ({
        ...order,
        packages: (order.packages ?? []).filter(p => !p.deleted_at),
      })) as ManifestOrder[];
    },
    enabled: !!externalLoadId && !!operatorId,
    staleTime: 30_000,
  });
}
