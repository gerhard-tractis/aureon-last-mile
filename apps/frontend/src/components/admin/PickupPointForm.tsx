'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { usePickupPointStore } from '@/lib/stores/pickupPointStore';
import { useClients } from '@/hooks/useClients';
import { usePickupPoints, useCreatePickupPoint, useUpdatePickupPoint } from '@/hooks/usePickupPoints';

// All fields optional — operators want to save partial records and fill in
// the rest later. Backend (API + DB) accepts nulls/empty strings and stores
// pickup_locations as an empty array when no location data is provided.
const pickupPointSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  tenant_client_id: z.string().optional(),
  is_active: z.boolean(),
  location_name: z.string().optional(),
  location_address: z.string().optional(),
  location_comuna: z.string().optional(),
  location_contact_name: z.string().optional(),
  location_contact_phone: z.string().optional(),
});

type PickupPointFormValues = z.infer<typeof pickupPointSchema>;

interface PickupPointFormProps {
  mode: 'create' | 'edit';
  pointId?: string;
}

export const PickupPointForm = ({ mode, pointId }: PickupPointFormProps) => {
  const { setCreateFormOpen, setEditFormOpen } = usePickupPointStore();
  const { data: clients } = useClients();
  const { data: points } = usePickupPoints();
  const { mutate: create, isPending: isCreating } = useCreatePickupPoint();
  const { mutate: update, isPending: isUpdating } = useUpdatePickupPoint();

  const existingPoint = mode === 'edit' ? points?.find((p) => p.id === pointId) : null;
  const existingLoc = existingPoint?.pickup_locations?.[0];

  const { register, handleSubmit, formState: { errors } } = useForm<PickupPointFormValues>({
    resolver: zodResolver(pickupPointSchema),
    defaultValues: {
      name: existingPoint?.name ?? '',
      code: existingPoint?.code ?? '',
      tenant_client_id: existingPoint?.tenant_client_id ?? '',
      is_active: existingPoint?.is_active ?? true,
      location_name: existingLoc?.name ?? '',
      location_address: existingLoc?.address ?? '',
      location_comuna: existingLoc?.comuna ?? '',
      location_contact_name: existingLoc?.contact_name ?? '',
      location_contact_phone: existingLoc?.contact_phone ?? '',
    },
  });

  const isPending = isCreating || isUpdating;
  const activeClients = clients?.filter((c) => c.is_active && !c.deleted_at) ?? [];

  const onSubmit = (values: PickupPointFormValues) => {
    // Build a sparse location object: include only fields the user filled in.
    // If nothing is filled, send an empty pickup_locations array so the row
    // can still be saved (the column is JSONB NOT NULL DEFAULT '[]'::jsonb).
    const loc: Record<string, string> = {};
    if (values.location_name) loc.name = values.location_name;
    if (values.location_address) loc.address = values.location_address;
    if (values.location_comuna) loc.comuna = values.location_comuna;
    if (values.location_contact_name) loc.contact_name = values.location_contact_name;
    if (values.location_contact_phone) loc.contact_phone = values.location_contact_phone;
    const pickup_locations = Object.keys(loc).length > 0 ? [loc] : [];

    // Convert empty strings to undefined so the API treats them as "not
    // provided" rather than "blank value to save". The API in turn writes
    // NULL into the DB so unique (operator_id, code) does not conflict on
    // empty codes.
    const blank = (s?: string) => (s && s.trim().length > 0 ? s : undefined);

    if (mode === 'create') {
      create(
        {
          name: blank(values.name),
          code: blank(values.code),
          tenant_client_id: blank(values.tenant_client_id),
          pickup_locations,
        },
        { onSuccess: () => setCreateFormOpen(false) },
      );
    } else if (pointId) {
      update(
        {
          id: pointId,
          data: {
            name: blank(values.name),
            code: blank(values.code),
            tenant_client_id: blank(values.tenant_client_id),
            pickup_locations,
            is_active: values.is_active,
          },
        },
        { onSuccess: () => setEditFormOpen(false) },
      );
    }
  };

  const handleClose = () => {
    if (mode === 'create') setCreateFormOpen(false);
    else setEditFormOpen(false);
  };

  return (
    <Sheet open onOpenChange={(open) => { if (!open) handleClose(); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{mode === 'create' ? 'Nuevo Punto de Retiro' : 'Editar Punto de Retiro'}</SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-6">
          <div>
            <label htmlFor="pp-name" className="block text-sm font-medium mb-1">
              Nombre <span className="text-text-muted font-normal">(opcional)</span>
            </label>
            <input
              id="pp-name"
              type="text"
              {...register('name')}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
              disabled={isPending}
            />
            {errors.name && <p className="text-xs text-destructive mt-1">{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor="pp-code" className="block text-sm font-medium mb-1">
              Código <span className="text-text-muted font-normal">(opcional)</span>
            </label>
            <input
              id="pp-code"
              type="text"
              {...register('code')}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
              disabled={isPending}
            />
            {errors.code && <p className="text-xs text-destructive mt-1">{errors.code.message}</p>}
          </div>

          <div>
            <label htmlFor="pp-client" className="block text-sm font-medium mb-1">
              Cliente <span className="text-text-muted font-normal">(opcional)</span>
            </label>
            <select
              id="pp-client"
              {...register('tenant_client_id')}
              className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
              disabled={isPending}
            >
              <option value="">Sin cliente</option>
              {activeClients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errors.tenant_client_id && <p className="text-xs text-destructive mt-1">{errors.tenant_client_id.message}</p>}
          </div>

          {mode === 'edit' && (
            <div className="flex items-center gap-2">
              <input id="pp-active" type="checkbox" {...register('is_active')} className="rounded" />
              <label htmlFor="pp-active" className="text-sm font-medium">Activo</label>
            </div>
          )}

          <div className="border border-border rounded-md p-4 space-y-3">
            <h3 className="text-sm font-semibold">Ubicación</h3>

            <div>
              <label htmlFor="loc-name" className="block text-xs font-medium mb-1">Nombre de ubicación</label>
              <input
                id="loc-name"
                type="text"
                {...register('location_name')}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
                disabled={isPending}
              />
              {errors.location_name && <p className="text-xs text-destructive mt-1">{errors.location_name.message}</p>}
            </div>

            <div>
              <label htmlFor="loc-address" className="block text-xs font-medium mb-1">Dirección</label>
              <input
                id="loc-address"
                type="text"
                {...register('location_address')}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
                disabled={isPending}
              />
              {errors.location_address && <p className="text-xs text-destructive mt-1">{errors.location_address.message}</p>}
            </div>

            <div>
              <label htmlFor="loc-comuna" className="block text-xs font-medium mb-1">Comuna</label>
              <input
                id="loc-comuna"
                type="text"
                {...register('location_comuna')}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
                disabled={isPending}
              />
            </div>

            <div>
              <label htmlFor="loc-contact" className="block text-xs font-medium mb-1">Contacto</label>
              <input
                id="loc-contact"
                type="text"
                {...register('location_contact_name')}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
                disabled={isPending}
              />
            </div>

            <div>
              <label htmlFor="loc-phone" className="block text-xs font-medium mb-1">Teléfono</label>
              <input
                id="loc-phone"
                type="text"
                {...register('location_contact_phone')}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
                disabled={isPending}
              />
            </div>
          </div>

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
