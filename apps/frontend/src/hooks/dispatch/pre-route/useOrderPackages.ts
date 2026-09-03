import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { PACKAGE_STATUS_HELD } from '@/lib/types/pipeline';

/**
 * The pre-route chevron's package detail.
 *
 * get_pre_route_snapshot already carries every unrouted order for the day —
 * adding sku_items to all of them would balloon that payload for data an
 * operator almost never opens. So this queries `packages` directly, scoped
 * to one order. Called only from `UnroutedOrderPackages`, which itself only
 * mounts once its row's chevron is expanded — mounting is the gate, so this
 * hook needs no separate `enabled` flag of its own beyond having both ids.
 */

export interface OrderPackageSku {
  sku: string;
  description: string;
  quantity: number;
}

export interface OrderPackage {
  id: string;
  label: string;
  /** A package held in consolidation — the root cause of an order shipping incomplete. */
  isHeld: boolean;
  skuItems: OrderPackageSku[];
}

interface RawSkuItem {
  sku?: unknown;
  description?: unknown;
  quantity?: unknown;
}

function normalizeSkuItems(raw: unknown): OrderPackageSku[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((it): it is RawSkuItem => typeof it === 'object' && it !== null)
    .map((it) => ({
      sku: typeof it.sku === 'string' ? it.sku : '',
      description: typeof it.description === 'string' ? it.description : '',
      quantity: typeof it.quantity === 'number' ? it.quantity : 1,
    }));
}

interface PackageRow {
  id: string;
  label: string;
  status: string | null;
  sku_items: unknown;
}

export function useOrderPackages(orderId: string | null, operatorId: string | null) {
  return useQuery<OrderPackage[]>({
    queryKey: ['dispatch', 'pre-route', 'order-packages', orderId, operatorId],
    queryFn: async () => {
      const client = createSPAClient();
      const { data, error } = await client
        .from('packages')
        .select('id, label, status, sku_items')
        .eq('order_id', orderId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .order('label', { ascending: true });

      if (error) throw error;

      return ((data as PackageRow[] | null) ?? []).map((pkg) => ({
        id: pkg.id,
        label: pkg.label,
        isHeld: pkg.status === PACKAGE_STATUS_HELD,
        skuItems: normalizeSkuItems(pkg.sku_items),
      }));
    },
    enabled: !!orderId && !!operatorId,
    staleTime: 30_000,
  });
}
