import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { DashboardPeriod } from '@/app/app/dashboard/lib/period';

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useOtifChapter(operatorId: string, period: DashboardPeriod) {
  const pStart = toISODate(period.start);
  const pEnd = toISODate(period.end);

  const byRegionQuery = useQuery({
    queryKey: ['dashboard-otif-by-region', operatorId, pStart, pEnd],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_dashboard_otif_by_region',
        { p_operator_id: operatorId, p_start: pStart, p_end: pEnd },
      );
      if (error) throw error;
      return (data as unknown[]) ?? [];
    },
    enabled: !!operatorId,
    staleTime: 5 * 60 * 1000,
  });

  const byCustomerQuery = useQuery({
    queryKey: ['dashboard-otif-by-customer', operatorId, pStart, pEnd],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_dashboard_otif_by_customer',
        { p_operator_id: operatorId, p_start: pStart, p_end: pEnd },
      );
      if (error) throw error;
      return (data as unknown[]) ?? [];
    },
    enabled: !!operatorId,
    staleTime: 5 * 60 * 1000,
  });

  const lateReasonsQuery = useQuery({
    queryKey: ['dashboard-late-reasons', operatorId, pStart, pEnd],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_dashboard_late_reasons',
        { p_operator_id: operatorId, p_start: pStart, p_end: pEnd },
      );
      if (error) throw error;
      return (data as unknown[]) ?? [];
    },
    enabled: !!operatorId,
    staleTime: 5 * 60 * 1000,
  });

  return {
    byRegion: byRegionQuery.data ?? [],
    byCustomer: byCustomerQuery.data ?? [],
    lateReasons: lateReasonsQuery.data ?? [],
    isLoading: byRegionQuery.isLoading || byCustomerQuery.isLoading || lateReasonsQuery.isLoading,
    isError: byRegionQuery.isError || byCustomerQuery.isError || lateReasonsQuery.isError,
  };
}
