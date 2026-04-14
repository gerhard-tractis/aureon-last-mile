'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useClientStore } from '@/lib/stores/clientStore';
import { useClients, useCreateClient, useUpdateClient } from '@/hooks/useClients';

const clientSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(100),
  is_active: z.boolean(),
});

type ClientFormValues = z.infer<typeof clientSchema>;

interface ClientFormProps {
  mode: 'create' | 'edit';
  clientId?: string;
}

export const ClientForm = ({ mode, clientId }: ClientFormProps) => {
  const { setCreateFormOpen, setEditFormOpen } = useClientStore();
  const { data: clients } = useClients();
  const { mutate: create, isPending: isCreating } = useCreateClient();
  const { mutate: update, isPending: isUpdating } = useUpdateClient();

  const existingClient = mode === 'edit' ? clients?.find((c) => c.id === clientId) : null;

  const { register, handleSubmit, formState: { errors } } = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: existingClient?.name ?? '',
      is_active: existingClient?.is_active ?? true,
    },
  });

  const isPending = isCreating || isUpdating;

  const onSubmit = (values: ClientFormValues) => {
    if (mode === 'create') {
      create({ name: values.name }, {
        onSuccess: () => setCreateFormOpen(false),
      });
    } else if (clientId) {
      update({ id: clientId, data: { name: values.name, is_active: values.is_active } }, {
        onSuccess: () => setEditFormOpen(false),
      });
    }
  };

  const handleClose = () => {
    if (mode === 'create') setCreateFormOpen(false);
    else setEditFormOpen(false);
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) handleClose(); }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{mode === 'create' ? 'Nuevo Cliente' : 'Editar Cliente'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div>
            <label htmlFor="client-name" className="block text-sm font-medium mb-1">Nombre</label>
            <input
              id="client-name"
              aria-label="Nombre"
              type="text"
              {...register('name')}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
              disabled={isPending}
            />
            {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
          </div>

          {mode === 'edit' && existingClient && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Slug</label>
                <div className="px-3 py-2 border border-border rounded-md bg-muted text-muted-foreground text-sm">
                  {existingClient.slug}
                </div>
                <p className="text-xs text-muted-foreground mt-1">El slug no se puede modificar</p>
              </div>

              <div className="flex items-center gap-2">
                <input id="client-is-active" type="checkbox" {...register('is_active')} className="rounded" />
                <label htmlFor="client-is-active" className="text-sm font-medium">Activo</label>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={isPending}
              className="flex-1 px-4 py-2 border border-border rounded-md hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 px-4 py-2 bg-accent text-accent-foreground rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};
