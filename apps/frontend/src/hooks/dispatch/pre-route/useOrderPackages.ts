import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

/**
 * spec-75 Task 2a — the pre-route chevron's package detail.
 *
 * get_pre_route_snapshot already carries every unrouted order for the day —
 * adding sku_items to all of them (as the original spec draft assumed)
 * would balloon that payload for data an operator almost never opens. So
 * this queries `packages` directly, scoped to the one order whose chevron
 * got expanded, and stays disabled until it does.
 */

export interface OrderPackageSku {
  sku: string;
  description: string;
  quantity: number;
}

export interface OrderPackage {
  id: string;
  label: string;
  status: string | null;
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

export function useOrderPackages(orderId: string | null, operatorId: string | null, enabled: boolean) {
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
        status: pkg.status,
        isHeld: pkg.status === 'retenido',
        skuItems: normalizeSkuItems(pkg.sku_items),
      }));
    },
    enabled: enabled && !!orderId && !!operatorId,
    staleTime: 30_000,
  });
}
