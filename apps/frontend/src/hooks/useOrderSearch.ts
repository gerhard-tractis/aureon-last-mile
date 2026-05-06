import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export type OrderSearchResult = {
  id: string;
  order_number: string;
  customer_name: string;
  leading_status: string;
};

export type PackageSearchResult = {
  id: string;
  label: string;
  status: string;
  order_id: string;
  order_number: string;
};

export type OrderSearchData = {
  orders: OrderSearchResult[];
  packages: PackageSearchResult[];
};

export function useOrderSearch(query: string) {
  const trimmed = query.trim();
  return useQuery<OrderSearchData>({
    queryKey: ['order-search', trimmed],
    queryFn: async () => {
      const client = createSPAClient();

      const [ordersRes, pkgsRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client.from('orders') as any)
          .select('id, order_number, customer_name, leading_status')
          .ilike('order_number', `%${trimmed}%`)
          .is('deleted_at', null)
          .limit(5),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (client.from('packages') as any)
          .select('id, label, status, order_id, orders(order_number)')
          .ilike('label', `%${trimmed}%`)
          .is('deleted_at', null)
          .limit(5),
      ]);

      if (ordersRes.error) throw ordersRes.error;
      if (pkgsRes.error) throw pkgsRes.error;

      const orders: OrderSearchResult[] = (ordersRes.data ?? []).map(
        (r: { id: string; order_number: string; customer_name: string; leading_status: string }) => r,
      );

      const packages: PackageSearchResult[] = (pkgsRes.data ?? []).map(
        (r: { id: string; label: string; status: string; order_id: string; orders?: { order_number: string } }) => ({
          id: r.id,
          label: r.label,
          status: r.status,
          order_id: r.order_id,
          order_number: r.orders?.order_number ?? '',
        }),
      );

      return { orders, packages };
    },
    enabled: trimmed.length >= 2,
    staleTime: 10_000,
  });
}
