'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { usePickupPointStore } from '@/lib/stores/pickupPointStore';
import { useClients } from '@/hooks/useClients';
import { usePickupPoints, useCreatePickupPoint, useUpdatePickupPoint } from '@/hooks/usePickupPoints';
import { pickupPointSchema, type PickupPointFormValues } from './pickupPointFormSchema';
import { PickupPointLocationFields } from './PickupPointLocationFields';

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
      location_window_start: existingLoc?.operating_hours?.start ?? '',
      location_window_end: existingLoc?.operating_hours?.end ?? '',
      sla_pickup_cutoff_time: existingPoint?.sla_config?.pickup_cutoff_time ?? '',
    },
  });

  const isPending = isCreating || isUpdating;
  const activeClients = clients?.filter((c) => c.is_active && !c.deleted_at) ?? [];

  const onSubmit = (values: PickupPointFormValues) => {
    // Build a sparse location object: include only fields the user filled in.
    // If nothing is filled, send an empty pickup_locations array so the row
    // can still be saved (the column is JSONB NOT NULL DEFAULT '[]'::jsonb).
    // spec-83 fase 2: the window is part of the location object (schema:
    // pickup_locations[].operating_hours); the cutoff is a separate,
    // operator-facing field (sla_config.pickup_cutoff_time), not per-location.
    // Both are folded in ONLY when filled — an empty {} would be
    // indistinguishable from "not configured" on read, but sending it here
    // makes intent explicit rather than accidental.
    const loc: Record<string, unknown> = {};
    if (values.location_name) loc.name = values.location_name;
    if (values.location_address) loc.address = values.location_address;
    if (values.location_comuna) loc.comuna = values.location_comuna;
    if (values.location_contact_name) loc.contact_name = values.location_contact_name;
    if (values.location_contact_phone) loc.contact_phone = values.location_contact_phone;
    if (values.location_window_start || values.location_window_end) {
      loc.operating_hours = {
        ...(values.location_window_start && { start: values.location_window_start }),
        ...(values.location_window_end && { end: values.location_window_end }),
      };
    }
    const pickup_locations = Object.keys(loc).length > 0 ? [loc] : [];

    // spec-83 fase 2, review round 2 (B2): in CREATE mode there is no row
    // yet, so an untouched/blank field can just be omitted (`undefined`).
    // In EDIT mode that same `undefined` is what let the PUT route SKIP the
    // update entirely (`if (validation.data.sla_config !== undefined)`) —
    // blanking the field in the UI and saving did nothing, forever. Editing
    // always resends the full current state, so blank there unambiguously
    // means "clear it": send an explicit `null`, never omit the key.
    const sla_config =
      mode === 'edit'
        ? { pickup_cutoff_time: values.sla_pickup_cutoff_time || null }
        : values.sla_pickup_cutoff_time
          ? { pickup_cutoff_time: values.sla_pickup_cutoff_time }
          : undefined;

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
          sla_config,
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
            sla_config,
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

          <PickupPointLocationFields register={register} errors={errors} isPending={isPending} />

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
