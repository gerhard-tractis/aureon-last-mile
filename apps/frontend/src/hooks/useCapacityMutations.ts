import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface BulkFillCapacityRow {
  capacity_date: string;
  daily_capacity: number;
  source: 'rule' | 'manual';
}

export interface BulkFillCapacityInput {
  operatorId: string;
  clientId: string;
  rows: BulkFillCapacityRow[];
}

/**
 * useBulkFillCapacity — bulk upserts retailer_daily_capacities rows.
 * Conflict resolution: operator_id,client_id,capacity_date (update on conflict).
 * On success: invalidates capacityCalendar queries.
 */
export function useBulkFillCapacity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ operatorId, clientId, rows }: BulkFillCapacityInput) => {
      const insertRows = rows.map((row) => ({
        operator_id: operatorId,
        client_id: clientId,
        capacity_date: row.capacity_date,
        daily_capacity: row.daily_capacity,
        source: row.source,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (createSPAClient() as any).from('retailer_daily_capacities')
        .upsert(insertRows, {
          onConflict: 'operator_id,client_id,capacity_date',
          ignoreDuplicates: false,
        });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capacityCalendar'] });
    },
  });
}

export interface UpdateCapacityInput {
  id: string;
  daily_capacity: number;
}

/**
 * useUpdateCapacity — updates the daily_capacity of a single retailer_daily_capacities row.
 * On success: invalidates both capacityCalendar and capacityUtilization queries.
 */
export function useUpdateCapacity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, daily_capacity }: UpdateCapacityInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (createSPAClient() as any).from('retailer_daily_capacities')
        .update({ daily_capacity })
        .eq('id', id);

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['capacityCalendar'] });
      queryClient.invalidateQueries({ queryKey: ['capacityUtilization'] });
    },
  });
}
