import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { MoveTaskSnapshot } from '@/lib/types';

/**
 * spec-71 phase 5 — the move-task picker's data source.
 *
 * Same shape as `usePreRouteSnapshot`: one RPC (`get_move_task_snapshot`,
 * 20260828000001) returning the whole payload as jsonb, cached via
 * react-query. Counts are computed server-side, live, on every call — never
 * `routes.planned_stops` — so there is nothing to derive client-side here.
 */
async function fetchSnapshot(operatorId: string): Promise<MoveTaskSnapshot> {
  const client = createSPAClient();
  const { data, error } = await client.rpc('get_move_task_snapshot', {
    p_operator_id: operatorId,
  });
  if (error) throw error;
  return data as MoveTaskSnapshot;
}

export type MoveTaskSnapshotResult = {
  snapshot: MoveTaskSnapshot | null;
  isLoading: boolean;
  isError: boolean;
  fetchStatus: string;
  isSuccess: boolean;
};

export function useMoveTaskSnapshot(operatorId: string | null): MoveTaskSnapshotResult {
  const { data, isLoading, isError, fetchStatus, isSuccess } = useQuery({
    queryKey: ['distribution', 'move-task-snapshot', operatorId],
    queryFn: () => fetchSnapshot(operatorId!),
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  return {
    snapshot: data ?? null,
    isLoading,
    isError,
    fetchStatus,
    isSuccess,
  };
}
