import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPickupPoints, createPickupPoint, updatePickupPoint, deletePickupPoint, type CreatePickupPointInput, type UpdatePickupPointInput } from '@/lib/api/pickup-points';
import { toast } from 'sonner';

export const usePickupPoints = () => {
  return useQuery({
    queryKey: ['pickup-points'],
    queryFn: getPickupPoints,
    staleTime: 300000,
    refetchInterval: 300000,
    refetchOnWindowFocus: false,
  });
};

export const useCreatePickupPoint = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePickupPointInput) => createPickupPoint(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pickup-points'] });
      toast.success(`Punto de retiro "${data.name}" creado exitosamente`);
    },
    onError: (error: Error) => {
      toast.error(`Error al crear punto de retiro: ${error.message}`);
    },
  });
};

export const useUpdatePickupPoint = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdatePickupPointInput }) => updatePickupPoint(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup-points'] });
      toast.success('Punto de retiro actualizado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(`Error al actualizar punto de retiro: ${error.message}`);
    },
  });
};

export const useDeletePickupPoint = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePickupPoint,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pickup-points'] });
      toast.success('Punto de retiro eliminado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(`Error al eliminar punto de retiro: ${error.message}`);
    },
  });
};
