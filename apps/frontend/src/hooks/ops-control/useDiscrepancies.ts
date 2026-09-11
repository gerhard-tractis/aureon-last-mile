import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { callRpc } from '@/lib/supabase/rpc';

/**
 * spec-86 fase 3 — the Discrepancias view in Ops Control.
 *
 * One row per bulto that either never arrived at pickup (operation_type=
 * 'pickup') or arrived at pickup but never turned up at the hub
 * (operation_type='reception') — see get_discrepancies_ops_control
 * (20260925000001). `carga` and `ruta` are derived server-side; there is no
 * single "expected count" field here on purpose — this view lists what
 * public.discrepancies actually knows row by row, not an aggregate that can
 * disagree with it (see spec-86, "Un hueco conocido que heredas").
 */
export type DiscrepancyKind = 'missing' | 'unexpected';
export type DiscrepancyOperation = 'pickup' | 'reception';
export type DiscrepancyStatus = 'open' | 'resolved' | 'lost';

export interface DiscrepancyRow {
  id: string;
  kind: DiscrepancyKind;
  operation_type: DiscrepancyOperation;
  status: DiscrepancyStatus;
  detected_at: string;
  note: string | null;
  order_number: string | null;
  package_label: string | null;
  carga: string | null;
  ruta: string | null;
  closed_by_name: string | null;
  /**
   * Ronda 3 (#715, M3) — total rows matching the filter BEFORE the RPC's
   * LIMIT 500, identical on every row (a window function). LIMIT 500 was a
   * safety cap, not a solution: nothing today moves a discrepancy out of
   * 'open' at scale, so the queue is monotonically growing and ORDER BY
   * detected_at DESC means the rows that fall off are the OLDEST — exactly
   * the ones "Abierta hace" exists to surface. total_count > rows.length is
   * how the UI knows to say so instead of pretending the list is complete.
   */
  total_count: string | number;
}

/**
 * Ronda 3 (#715, M1) — "do we actually know the answer yet?", shared between
 * every consumer of useDiscrepancies (the StageRail tile AND the panel it
 * opens). Split out so the two cannot drift the way they did in ronda 2: the
 * tile learned to say "—"/neutral while loading, offline (fetchStatus=
 * 'paused' under TanStack Query's networkMode:'online'), or errored, but the
 * panel kept `data ?? []`, so clicking the honest "—" tile opened a panel
 * that confidently said "Sin discrepancias abiertas" with three KPIs of
 * zero — worse than the original bug, because the user clicked precisely
 * because they didn't know.
 */
export function isDiscrepanciesUnknown(query: {
  data: DiscrepancyRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  fetchStatus: string;
}): boolean {
  return (
    query.data === undefined &&
    (query.isLoading || query.isError || query.fetchStatus === 'paused')
  );
}

/**
 * Ronda 3 (#715, M3) — the real total behind a (possibly LIMIT 500-truncated)
 * row set. Every row carries the same total_count; an empty array has no row
 * to read it from, so 0 is correct there without special-casing.
 */
export function totalDiscrepancyCount(rows: DiscrepancyRow[]): number {
  return rows.length === 0 ? 0 : Number(rows[0].total_count);
}

export function useDiscrepancies(
  operatorId: string,
  status: DiscrepancyStatus | null = 'open',
) {
  return useQuery<DiscrepancyRow[]>({
    queryKey: ['ops-control', operatorId, 'discrepancies', status],
    queryFn: async () => {
      const { data, error } = await callRpc<DiscrepancyRow[]>(
        createSPAClient(),
        'get_discrepancies_ops_control',
        { p_status: status },
      );
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!operatorId,
    staleTime: 30_000,
  });
}
