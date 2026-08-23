import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { AuditEntry, OrderDetailData, PackageDetail } from './useOrderDetail';
import type { Json } from '@/lib/types';

/**
 * spec-65 Task 7 — a package as the dossier needs it: `useOrderDetail`'s
 * `PackageDetail` plus the fields `1f`/`3b` show that `useOrderDetail`'s
 * callers never needed (dock location, weight).
 */
export type DossierPackage = PackageDetail & {
  dock_zone_name: string | null;
  declared_weight_kg: number | null;
  verified_weight_kg: number | null;
};

/**
 * spec-65 Task 7 — the order's dispatch row(s). `beetrack-webhook` upserts
 * one row per stop (one per order per `is_pickup` leg), so this is the
 * courier's current state, not a per-event history — Fase 1
 * (`webhook_events`) is parked. `external_route_id` / `driver_name` come
 * from the joined `routes` row, not `dispatches`' own (stale) copy.
 */
export type DossierDispatch = {
  id: string;
  substatus: string | null;
  substatus_code: string | null;
  status: string;
  completed_at: string | null;
  arrived_at: string | null;
  estimated_at: string | null;
  failure_reason: string | null;
  latitude: number | null;
  longitude: number | null;
  raw_data: Json;
  is_pickup: boolean;
  external_route_id: string | null;
  driver_name: string | null;
};

export type OrderDossierData = Omit<OrderDetailData, 'packages'> & {
  packages: DossierPackage[];
  dispatches: DossierDispatch[];
};

type DossierOrderRow = Omit<OrderDetailData, 'auditLogs' | 'manifestId' | 'packages'> & {
  external_load_id: string | null;
  packages: (PackageDetail & {
    declared_weight_kg: number | null;
    verified_weight_kg: number | null;
    deleted_at: string | null;
    dock_zone: { name: string } | { name: string }[] | null;
  })[];
};

type DossierDispatchRow = Omit<DossierDispatch, 'external_route_id' | 'driver_name'> & {
  routes: { external_route_id: string; driver_name: string | null } | { external_route_id: string; driver_name: string | null }[] | null;
};

function firstOf<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * spec-65 Task 7 — a hook independent of `useOrderDetail`, not an extension
 * of it. `useOrderDetail` has five existing callers that never asked for
 * courier data and never pass an `operatorId` (they rely on RLS); the
 * dossier's dispatches query needs one explicitly (see `useRouteDispatches`
 * for the existing pattern), so folding this in would force every existing
 * caller to start supplying an operator id it doesn't have, or leave the
 * new query without the operator_id filter the project requires. A
 * standalone hook keeps both call shapes honest and leaves `useOrderDetail`
 * untouched.
 */
export function useOrderDossier(orderId: string | null, operatorId: string | null) {
  return useQuery<OrderDossierData | null>({
    queryKey: ['order-dossier', orderId, operatorId],
    queryFn: async () => {
      const client = createSPAClient();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: orderData, error: orderError } = await (client.from('orders') as any)
        .select(
          'id, order_number, retailer_name, customer_name, customer_phone, delivery_address, comuna, delivery_date, delivery_window_start, delivery_window_end, status, leading_status, external_load_id, packages(id, label, package_number, status, status_updated_at, declared_weight_kg, verified_weight_kg, deleted_at, dock_zone:dock_zones(name))',
        )
        .eq('id', orderId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .single();

      if (orderError) throw orderError;
      if (!orderData) return null;

      const order = orderData as unknown as DossierOrderRow;

      let manifestId: string | null = null;
      if (order.external_load_id) {
        const { data: manifestData } = await client
          .from('manifests')
          .select('id')
          .eq('external_load_id', order.external_load_id)
          .eq('operator_id', operatorId!)
          .is('deleted_at', null)
          .maybeSingle();
        manifestId = (manifestData as { id: string } | null)?.id ?? null;
      }

      const { data: auditData, error: auditError } = await client
        .from('audit_logs')
        .select('id, action, timestamp, changes_json')
        .eq('resource_type', 'order')
        .eq('resource_id', orderId!)
        .eq('operator_id', operatorId!)
        .order('timestamp', { ascending: false });

      if (auditError) throw auditError;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dispatchData, error: dispatchError } = await (client.from('dispatches') as any)
        .select(
          'id, substatus, substatus_code, status, completed_at, arrived_at, estimated_at, failure_reason, latitude, longitude, raw_data, is_pickup, routes(external_route_id, driver_name)',
        )
        .eq('order_id', orderId!)
        .eq('operator_id', operatorId!)
        .is('deleted_at', null);

      if (dispatchError) throw dispatchError;

      const dispatches: DossierDispatch[] = ((dispatchData as DossierDispatchRow[] | null) ?? []).map(
        (row) => {
          const { routes, ...rest } = row;
          const route = firstOf(routes);
          return {
            ...rest,
            external_route_id: route?.external_route_id ?? null,
            driver_name: route?.driver_name ?? null,
          };
        },
      );

      const packages: DossierPackage[] = order.packages
        .filter((pkg) => !pkg.deleted_at)
        .map((pkg) => {
          const { dock_zone, deleted_at: _deletedAt, ...rest } = pkg;
          const zone = firstOf(dock_zone);
          return {
            ...rest,
            dock_zone_name: zone?.name ?? null,
          };
        });

      const { external_load_id: _externalLoadId, packages: _packages, ...orderFields } = order;

      return {
        ...orderFields,
        packages,
        auditLogs: (auditData as AuditEntry[] | null) ?? [],
        manifestId,
        dispatches,
      };
    },
    enabled: !!orderId && !!operatorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
