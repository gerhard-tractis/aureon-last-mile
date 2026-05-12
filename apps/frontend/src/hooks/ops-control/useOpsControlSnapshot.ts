import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createSPAClient } from '@/lib/supabase/client';

export type OrderRow = Record<string, unknown>;
export type RouteRow = Record<string, unknown>;
export type PickupRow = Record<string, unknown>;
export type ReturnRow = Record<string, unknown>;
export type RetailerSlaConfigRow = Record<string, unknown>;

/** Map order status → ops-control stage key */
function orderStage(status: unknown): string | null {
  switch (status) {
    case 'en_bodega':              return 'reception';
    case 'asignado':
    case 'en_carga':
    case 'listo_para_despacho':   return 'docks';
    case 'en_ruta':               return 'delivery';
    default:                      return null;
  }
}

/** Map route status → ops-control stage key */
function routeStage(status: unknown): string | null {
  switch (status) {
    case 'draft':
    case 'planned':       return 'docks';
    case 'in_progress':   return 'delivery';
    default:              return null;
  }
}

function enrichOrder(o: OrderRow): OrderRow {
  return { ...o, stage: orderStage(o['status']) };
}

function enrichRoute(r: RouteRow): RouteRow {
  return { ...r, stage: routeStage(r['status']) };
}

export type OpsSnapshot = {
  orders: OrderRow[];
  routes: RouteRow[];
  pickups: PickupRow[];
  returns: ReturnRow[];
  retailerSlaConfig: RetailerSlaConfigRow[];
  fetchedAt: Date;
};

export type OpsControlSnapshotResult = {
  snapshot: OpsSnapshot | null;
  isLoading: boolean;
  error: Error | null;
  lastSyncAt: Date | null;
};

/**
 * Single RPC call — returns only in-progress orders/routes/manifests.
 * Delivered (entregado) and cancelled orders are excluded server-side.
 */
async function fetchSnapshot(operatorId: string): Promise<OpsSnapshot> {
  const client = createSPAClient();

  const { data, error } = await client.rpc('get_ops_control_snapshot', {
    p_operator_id: operatorId,
  });

  if (error) throw error;

  const result = data as Record<string, unknown[]> | null;

  return {
    orders: ((result?.orders ?? []) as OrderRow[]).map(enrichOrder),
    routes: ((result?.routes ?? []) as RouteRow[]).map(enrichRoute),
    pickups: (result?.manifests ?? []) as PickupRow[],
    returns: (result?.returns ?? []) as ReturnRow[],
    retailerSlaConfig: (result?.sla_config ?? []) as RetailerSlaConfigRow[],
    fetchedAt: new Date(),
  };
}

function upsertRow(
  rows: Record<string, unknown>[],
  updated: Record<string, unknown>
): Record<string, unknown>[] {
  const idx = rows.findIndex((r) => r['id'] === updated['id']);
  if (idx === -1) return [...rows, updated];
  const next = [...rows];
  next[idx] = updated;
  return next;
}

function removeRow(
  rows: Record<string, unknown>[],
  deleted: Record<string, unknown>
): Record<string, unknown>[] {
  return rows.filter((r) => r['id'] !== deleted['id']);
}

/** Statuses excluded from snapshot.orders by the RPC — drop in realtime too */
const EXCLUDED_ORDER_STATUSES = new Set([
  'entregado',
  'cancelado',
  'en_retorno',
  'parcialmente_entregado',
]);
const RETURN_ORDER_STATUSES = new Set(['en_retorno', 'parcialmente_entregado']);
const EXCLUDED_ROUTE_STATUSES = new Set(['completed', 'cancelled']);

export function useOpsControlSnapshot(
  operatorId: string | null
): OpsControlSnapshotResult {
  const queryClient = useQueryClient();
  const snapshotRef = useRef<OpsSnapshot | null>(null);
  const [version, setVersion] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const lastQueryData = useRef<OpsSnapshot | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['ops-control', operatorId, 'snapshot'],
    queryFn: () => fetchSnapshot(operatorId!),
    enabled: !!operatorId,
    staleTime: 30_000,        // 30s — realtime fills the gap
    refetchOnWindowFocus: true,
    retry: 2,
  });

  // Sync query data into the mutable ref
  if (data && data !== lastQueryData.current) {
    lastQueryData.current = data;
    snapshotRef.current = data;
    if (!lastSyncAt) setLastSyncAt(new Date());
  }

  useEffect(() => {
    if (!operatorId || !data) return;

    const client = createSPAClient();

    // Subscribe to orders + routes — the two tables that change most
    const ordersCh = client
      .channel(`ops:${operatorId}:orders`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `operator_id=eq.${operatorId}` },
        (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
          const current = snapshotRef.current;
          if (!current) return;

          if (payload.eventType === 'DELETE') {
            snapshotRef.current = {
              ...current,
              orders: removeRow(current.orders, payload.old),
              returns: removeRow(current.returns, payload.old),
            };
          } else {
            const row = enrichOrder(payload.new);
            const status = row['status'] as string;
            if (RETURN_ORDER_STATUSES.has(status)) {
              // Order moved into a return state — drop from orders[] and
              // refetch so returns[] picks up pickup_point_name + packages.
              snapshotRef.current = { ...current, orders: removeRow(current.orders, row) };
              queryClient.invalidateQueries({
                queryKey: ['ops-control', operatorId, 'snapshot'],
              });
            } else if (EXCLUDED_ORDER_STATUSES.has(status)) {
              snapshotRef.current = { ...current, orders: removeRow(current.orders, row) };
            } else {
              // Order moved out of a return state (e.g., en_bodega) — drop it
              // from returns[] and upsert into orders[].
              const next = current.returns.some((r) => r['id'] === row['id'])
                ? { ...current, returns: removeRow(current.returns, row), orders: upsertRow(current.orders, row) }
                : { ...current, orders: upsertRow(current.orders, row) };
              snapshotRef.current = next;
            }
          }
          setLastSyncAt(new Date());
          setVersion((v) => v + 1);
        }
      )
      .subscribe();

    const routesCh = client
      .channel(`ops:${operatorId}:routes`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'routes', filter: `operator_id=eq.${operatorId}` },
        (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
          const current = snapshotRef.current;
          if (!current) return;

          if (payload.eventType === 'DELETE') {
            snapshotRef.current = { ...current, routes: removeRow(current.routes, payload.old) };
          } else {
            const row = enrichRoute(payload.new);
            if (EXCLUDED_ROUTE_STATUSES.has(row['status'] as string)) {
              snapshotRef.current = { ...current, routes: removeRow(current.routes, row) };
            } else {
              snapshotRef.current = { ...current, routes: upsertRow(current.routes, row) };
            }
          }
          setLastSyncAt(new Date());
          setVersion((v) => v + 1);
        }
      )
      .subscribe();

    return () => {
      client.removeChannel(ordersCh);
      client.removeChannel(routesCh);
    };
  }, [operatorId, !!data, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps

  void version; // Force re-reads of the ref

  return {
    snapshot: snapshotRef.current,
    isLoading,
    error: error as Error | null,
    lastSyncAt,
  };
}
