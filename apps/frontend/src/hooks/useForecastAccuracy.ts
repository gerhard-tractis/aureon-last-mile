import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface ForecastAccuracyRow {
  capacity_date: string;
  forecasted: number;
  actual: number;
  accuracy_pct: number;
}

/**
 * useForecastAccuracy — fetches forecast accuracy data for a date range.
 * Calls get_forecast_accuracy RPC.
 * Uses a longer staleTime (60s) since accuracy data is slower-moving.
 */
export function useForecastAccuracy(
  operatorId: string | null,
  dateFrom: string,
  dateTo: string
) {
  return useQuery<ForecastAccuracyRow[]>({
    queryKey: ['forecastAccuracy', operatorId, dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await (createSPAClient().rpc as CallableFunction)(
        'get_forecast_accuracy',
        {
          p_operator_id: operatorId!,
          p_date_from: dateFrom,
          p_date_to: dateTo,
        }
      );
      if (error) throw error;
      return (data as ForecastAccuracyRow[]) ?? [];
    },
    enabled: !!operatorId && !!dateFrom && !!dateTo,
    staleTime: 60_000,
  });
}
