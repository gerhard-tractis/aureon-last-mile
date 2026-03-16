import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export function useRealtimeOrders(operatorId: string) {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const supabase = createSPAClient();

    const channel = supabase
      .channel(`operator:${operatorId}:orders`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `operator_id=eq.${operatorId}`,
      }, () => {
        // Debounce: batch invalidations within 1s window
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['pipeline-counts'] });
          queryClient.invalidateQueries({ queryKey: ['orders'] });
        }, 1000);
      })
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [operatorId, queryClient]);
}
