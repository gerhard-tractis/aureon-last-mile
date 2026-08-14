import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createSPAClient } from '@/lib/supabase/client';
import { deriveOrderStage, deriveRouteStage } from '@/lib/ops-control/stage';

export type OrderRow = Record<string, unknown>;
export type RouteRow = Record<string, unknown>;
export type PickupRow = Record<string, unknown>;
export type ReturnRow = Record<string, unknown>;
export type RetailerSlaConfigRow = Record<string, unknown>;

/**
 * Minimum gap between snapshot refetches triggered by Realtime. Package status
 * is not in the Realtime publication (only orders and dock_verifications are),
 * so a dock scan only reaches us as the orders UPDATE that
 * recalculate_order_status emits — the packages[] behind the stage has to come
 * from a refetch. Throttled so a scanning burst costs one RPC, not one per box.
 */
const REFETCH_THROTTLE_MS = 5_000;

function enrichOrder(o: OrderRow): OrderRow {
  return { ...o, stage: deriveOrderStage(o) };
}

function enrichRoute(r: RouteRow): RouteRow {
  return { ...r, stage: deriveRouteStage(r['status']) };
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

/**
 * A Realtime payload carries only the orders table's own columns, so it lacks
 * everything get_ops_control_snapshot joins on: packages[], pickup_point_name,
 * dwell/age/idle minutes. Layer it over the row we already hold rather than
 * replacing it, or every package-driven order UPDATE strips the order back to
 * its bare columns — which, with the stage now derived from packages[], would
 * drop it out of Andenes/Consolidación on the first scan.
 */
function mergeOrderRow(
  rows: Record<string, unknown>[],
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const existing = rows.find((r) => r['id'] === incoming['id']);
  return existing ? { ...existing, ...incoming } : incoming;
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
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefetchAt = useRef(0);

  /** Refetch now, or once the throttle window closes — never more than one pending. */
  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) return;

    const run = () => {
      refetchTimer.current = null;
      lastRefetchAt.current = Date.now();
      queryClient.invalidateQueries({
        queryKey: ['ops-control', operatorId, 'snapshot'],
      });
    };

    const elapsed = Date.now() - lastRefetchAt.current;
    if (elapsed >= REFETCH_THROTTLE_MS) run();
    else refetchTimer.current = setTimeout(run, REFETCH_THROTTLE_MS - elapsed);
  }, [queryClient, operatorId]);

  useEffect(() => {
    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, []);

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
            const row = enrichOrder(mergeOrderRow(current.orders, payload.new));
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
              // The event may be the echo of a package status change (a dock
              // scan bumps orders.status_updated_at through
              // recalculate_order_status) — the new packages[] only arrives
              // with a refetch.
              scheduleRefetch();
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
  }, [operatorId, !!data, queryClient, scheduleRefetch]); // eslint-disable-line react-hooks/exhaustive-deps

  void version; // Force re-reads of the ref

  return {
    snapshot: snapshotRef.current,
    isLoading,
    error: error as Error | null,
    lastSyncAt,
  };
}
