import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClients, createClient, updateClient, deleteClient, type CreateClientInput, type UpdateClientInput } from '@/lib/api/clients';
import { toast } from 'sonner';

export const useClients = () => {
  return useQuery({
    queryKey: ['clients'],
    queryFn: getClients,
    staleTime: 300000,
    refetchInterval: 300000,
    refetchOnWindowFocus: false,
  });
};

export const useCreateClient = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateClientInput) => createClient(input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success(`Cliente "${data.name}" creado exitosamente`);
    },
    onError: (error: Error) => {
      toast.error(`Error al crear cliente: ${error.message}`);
    },
  });
};

export const useUpdateClient = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateClientInput }) => updateClient(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      toast.success('Cliente actualizado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(`Error al actualizar cliente: ${error.message}`);
    },
  });
};

export const useDeleteClient = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteClient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['pickup-points'] });
      toast.success('Cliente eliminado exitosamente');
    },
    onError: (error: Error) => {
      toast.error(`Error al eliminar cliente: ${error.message}`);
    },
  });
};
