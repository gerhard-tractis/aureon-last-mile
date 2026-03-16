import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface CapacityAlert {
  id: string;
  operator_id: string;
  client_id: string | null;
  alert_date: string;
  threshold_pct: number;
  actual_orders: number;
  daily_capacity: number;
  utilization_pct: number;
  dismissed_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

/**
 * useCapacityAlerts — fetches active (non-dismissed, non-deleted) capacity alerts.
 * Queries: SELECT * FROM capacity_alerts WHERE operator_id = ? AND dismissed_at IS NULL AND deleted_at IS NULL ORDER BY created_at DESC
 */
export function useCapacityAlerts(operatorId: string | null) {
  return useQuery<CapacityAlert[]>({
    queryKey: ['capacityAlerts', operatorId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (createSPAClient() as any).from('capacity_alerts')
        .select('*')
        .eq('operator_id', operatorId!)
        .is('dismissed_at', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as CapacityAlert[]) ?? [];
    },
    enabled: !!operatorId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * useDismissAlert — mutation that sets dismissed_at on a capacity alert.
 * On success: invalidates capacityAlerts query.
 */
export function useDismissAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (createSPAClient() as any).from('capacity_alerts')
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', alertId);
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capacityAlerts'] });
    },
  });
}
