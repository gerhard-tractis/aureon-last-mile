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
