/**
 * TanStack Query hooks for the drivers admin surface — spec-84 fase 1
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDrivers, linkDriverUser } from '@/lib/api/drivers';
import { toast } from 'sonner';

const DRIVERS_QUERY_KEY = ['admin-drivers'];

/**
 * useDrivers - Query hook for fetching the operator's drivers, with any
 * linked user embedded.
 */
export const useDrivers = () => {
  return useQuery({
    queryKey: DRIVERS_QUERY_KEY,
    queryFn: getDrivers,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });
};

/**
 * useLinkDriverUser - Mutation hook to link (userId) or unlink (null) a
 * driver's user_id.
 */
export const useLinkDriverUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ driverId, userId }: { driverId: string; userId: string | null }) =>
      linkDriverUser(driverId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DRIVERS_QUERY_KEY });
      toast.success('Conductor actualizado');
    },
    onError: (error: Error) => {
      toast.error(`Error al vincular conductor: ${error.message}`);
    },
  });
};
