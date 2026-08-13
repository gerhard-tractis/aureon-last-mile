import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export type PackageDetail = {
  id: string;
  label: string;
  package_number: string | null;
  status: string | null;
  status_updated_at: string | null;
};

export type AuditEntry = {
  id: string;
  action: string;
  timestamp: string | null;
  changes_json: Record<string, unknown> | null;
};

export type OrderDetailData = {
  id: string;
  order_number: string;
  retailer_name: string | null;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  comuna: string;
  delivery_date: string;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  status: string;
  leading_status: string;
  packages: PackageDetail[];
  auditLogs: AuditEntry[];
  /** spec-53 — the manifest this order's packages belong to, resolved via
   * external_load_id (orders and manifests are not FK-linked). NULL when the
   * order has no external_load_id, or no manifests row exists for it yet. */
  manifestId: string | null;
};

type OrderRow = Omit<OrderDetailData, 'auditLogs' | 'manifestId'> & {
  packages: PackageDetail[];
  external_load_id: string | null;
};

export function useOrderDetail(orderId: string | null) {
  return useQuery<OrderDetailData | null>({
    queryKey: ['order-detail', orderId],
    queryFn: async () => {
      const client = createSPAClient();

      // 1. Fetch order with packages
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: orderData, error: orderError } = await (client.from('orders') as any)
        .select(
          'id, order_number, retailer_name, customer_name, customer_phone, delivery_address, comuna, delivery_date, delivery_window_start, delivery_window_end, status, leading_status, external_load_id, packages(id, label, package_number, status, status_updated_at)',
        )
        .eq('id', orderId!)
        .single();

      if (orderError) throw orderError;
      if (!orderData) return null;

      // Supabase's generated types cannot infer nested join results; OrderRow includes
      // manually-defined packages[] that diverges from the generated schema shape.
      const order = orderData as unknown as OrderRow;

      // 1b. Resolve the manifest for this order's external_load_id (spec-53).
      // orders and manifests are not FK-linked — they share external_load_id.
      let manifestId: string | null = null;
      if (order.external_load_id) {
        const { data: manifestData } = await client
          .from('manifests')
          .select('id')
          .eq('external_load_id', order.external_load_id)
          .is('deleted_at', null)
          .maybeSingle();
        manifestId = (manifestData as { id: string } | null)?.id ?? null;
      }

      // 2. Fetch audit logs
      const { data: auditData, error: auditError } = await client
        .from('audit_logs')
        .select('id, action, timestamp, changes_json')
        .eq('resource_type', 'order')
        .eq('resource_id', orderId!)
        .order('timestamp', { ascending: false });

      if (auditError) throw auditError;

      const { external_load_id: _externalLoadId, ...orderFields } = order;
      return {
        ...orderFields,
        auditLogs: (auditData as AuditEntry[] | null) ?? [],
        manifestId,
      };
    },
    enabled: !!orderId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
