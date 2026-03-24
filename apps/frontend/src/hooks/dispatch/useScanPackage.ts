import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RoutePackage } from '@/lib/dispatch/types';

export function useScanPackage(routeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string): Promise<RoutePackage> => {
      const res = await fetch(`/api/dispatch/routes/${routeId}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const json = await res.json();
      if (!res.ok) throw { code: json.code, message: json.message };
      return json as RoutePackage;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dispatch', 'packages', routeId] });
    },
  });
}
