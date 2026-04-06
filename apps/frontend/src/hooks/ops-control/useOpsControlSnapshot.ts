import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createSPAClient } from '@/lib/supabase/client';

export type OrderRow = Record<string, unknown>;
export type RouteRow = Record<string, unknown>;
export type PickupRow = Record<string, unknown>;
export type ReturnRow = Record<string, unknown>;
export type RetailerSlaConfigRow = Record<string, unknown>;

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

async function fetchSnapshot(operatorId: string): Promise<OpsSnapshot> {
  const client = createSPAClient();

  const [orders, routes, pickups, returns, slaConfig] = await Promise.all([
    client.from('orders').select('*').eq('operator_id', operatorId).is('deleted_at', null),
    client.from('routes').select('*').eq('operator_id', operatorId),
    client.from('pickups').select('*').eq('operator_id', operatorId),
    client.from('returns').select('*').eq('operator_id', operatorId).is('deleted_at', null),
    client.from('retailer_return_sla_config').select('*').eq('operator_id', operatorId),
  ]);

  if (orders.error) throw orders.error;
  if (routes.error) throw routes.error;
  if (pickups.error) throw pickups.error;
  if (returns.error) throw returns.error;
  if (slaConfig.error) throw slaConfig.error;

  return {
    orders: (orders.data ?? []) as OrderRow[],
    routes: (routes.data ?? []) as RouteRow[],
    pickups: (pickups.data ?? []) as PickupRow[],
    returns: (returns.data ?? []) as ReturnRow[],
    retailerSlaConfig: (slaConfig.data ?? []) as RetailerSlaConfigRow[],
    fetchedAt: new Date(),
  };
}

type TableKey = 'orders' | 'routes' | 'pickups' | 'returns';

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

export function useOpsControlSnapshot(
  operatorId: string | null
): OpsControlSnapshotResult {
  const snapshotRef = useRef<OpsSnapshot | null>(null);
  const [version, setVersion] = useState(0);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const wasSubscribed = useRef(false);
  // Track the last query data object to detect a real refetch (not a Realtime update)
  const lastQueryData = useRef<OpsSnapshot | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['ops-control', operatorId, 'snapshot'],
    queryFn: () => fetchSnapshot(operatorId!),
    enabled: !!operatorId,
    staleTime: Infinity,
    refetchInterval: false,
  });

  // Only overwrite the live snapshot when a genuinely new query result arrives
  if (data && data !== lastQueryData.current) {
    lastQueryData.current = data;
    snapshotRef.current = data;
    if (!lastSyncAt) {
      setLastSyncAt(new Date());
    }
  }

  useEffect(() => {
    if (!operatorId || !data) return;

    const client = createSPAClient();

    const tables: { table: string; key: TableKey }[] = [
      { table: 'orders', key: 'orders' },
      { table: 'routes', key: 'routes' },
      { table: 'pickups', key: 'pickups' },
      { table: 'returns', key: 'returns' },
    ];

    const channels = tables.map(({ table, key }) => {
      const channelName = `ops-control:${operatorId}:${table}`;
      const channel = client.channel(channelName);

      channel
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table,
            filter: `operator_id=eq.${operatorId}`,
          },
          (payload: {
            eventType: string;
            new: Record<string, unknown>;
            old: Record<string, unknown>;
          }) => {
            const current = snapshotRef.current;
            if (!current) return;

            let updated: OpsSnapshot;
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              updated = {
                ...current,
                [key]: upsertRow(current[key] as Record<string, unknown>[], payload.new),
              };
            } else if (payload.eventType === 'DELETE') {
              updated = {
                ...current,
                [key]: removeRow(current[key] as Record<string, unknown>[], payload.old),
              };
            } else {
              return;
            }

            snapshotRef.current = updated;
            setLastSyncAt(new Date());
            setVersion((v) => v + 1);
          }
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            if (wasSubscribed.current) {
              refetch();
            }
            wasSubscribed.current = true;
          }
        });

      return channel;
    });

    return () => {
      for (const ch of channels) {
        client.removeChannel(ch);
      }
    };
  }, [operatorId, !!data, refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Use version to force re-reads of the ref
  void version;

  return {
    snapshot: snapshotRef.current,
    isLoading,
    error: error as Error | null,
    lastSyncAt,
  };
}
