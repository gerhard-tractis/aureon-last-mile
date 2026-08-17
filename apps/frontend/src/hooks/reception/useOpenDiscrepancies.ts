import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

/**
 * spec-54 phase 4.6 — "Pendiente de resolución" (mock 3c).
 *
 * A closed reception whose received count never matched what was expected is
 * the thing nobody owns once the truck leaves. There was no operator-wide
 * query for it — useMissingPackages is per manifest — so this reads
 * route_receptions directly.
 *
 * The shortfall is derived (expected - received) rather than read from a
 * column: `unexpected_count` was added to the snapshot RPC after the table,
 * and depending on a column this table may not have would break the panel.
 */

export interface OpenDiscrepancy {
  id: string;
  routeCode: string;
  expected: number;
  received: number;
  /** Positive = packages missing. Negative = more arrived than expected. */
  delta: number;
  completedAt: string | null;
}

interface Row {
  id: string;
  expected_count: number;
  received_count: number;
  completed_at: string | null;
  pickup_routes: { code: string } | { code: string }[] | null;
}

function routeCode(row: Row): string {
  const r = row.pickup_routes;
  if (!r) return '—';
  return Array.isArray(r) ? (r[0]?.code ?? '—') : r.code;
}

export function useOpenDiscrepancies(operatorId: string | null) {
  return useQuery<OpenDiscrepancy[]>({
    queryKey: ['reception', 'open-discrepancies', operatorId],
    enabled: !!operatorId,
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('route_receptions')
        .select('id, expected_count, received_count, completed_at, pickup_routes(code)')
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      return ((data ?? []) as unknown as Row[])
        .filter((row) => row.received_count !== row.expected_count)
        .map((row) => ({
          id: row.id,
          routeCode: routeCode(row),
          expected: row.expected_count,
          received: row.received_count,
          delta: row.expected_count - row.received_count,
          completedAt: row.completed_at,
        }));
    },
  });
}
