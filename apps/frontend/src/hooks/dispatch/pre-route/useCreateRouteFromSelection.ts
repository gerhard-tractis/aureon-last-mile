import { useMutation, useQueryClient } from '@tanstack/react-query';

export type CreateRouteApiError = {
  code: 'ORDERS_ALREADY_ROUTED' | 'INVALID_ORDER_IDS' | 'INTERNAL_ERROR';
  routed_ids?: string[];
  invalid_ids?: string[];
};

export type CreatedRoute = {
  id: string;
  status: string;
  route_date: string;
  created_at: string;
};

export function useCreateRouteFromSelection() {
  const queryClient = useQueryClient();

  return useMutation<CreatedRoute, CreateRouteApiError, { orderIds: string[] }>({
    mutationFn: async ({ orderIds }) => {
      const res = await fetch('/api/dispatch/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_ids: orderIds }),
      });
      const data = await res.json();
      if (!res.ok) throw data as CreateRouteApiError;
      return data as CreatedRoute;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dispatch', 'pre-route'] });
      queryClient.invalidateQueries({ queryKey: ['dispatch', 'routes'] });
    },
  });
}
