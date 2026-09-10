import type { UseFormRegister, FieldErrors } from 'react-hook-form';
import type { PickupPointFormValues } from './pickupPointFormSchema';

/**
 * The "Ubicación" fieldset of PickupPointForm — extracted (spec-83 fase 2)
 * to keep the form under the 300-line guideline once the pickup window and
 * cutoff fields were added. Pure presentation: all state and submit logic
 * stay in PickupPointForm.tsx.
 */

interface PickupPointLocationFieldsProps {
  register: UseFormRegister<PickupPointFormValues>;
  errors: FieldErrors<PickupPointFormValues>;
  isPending: boolean;
}

export function PickupPointLocationFields({ register, errors, isPending }: PickupPointLocationFieldsProps) {
  return (
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

      {/* spec-83 fase 2 — sin esto, get_pending_manifests nunca tiene nada
          que devolver: hoy ningún punto de retiro define ventana ni cierre
          de retiros. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="loc-window-start" className="block text-xs font-medium mb-1">Apertura</label>
          <input
            id="loc-window-start"
            type="time"
            {...register('location_window_start')}
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
            disabled={isPending}
          />
          {errors.location_window_start && <p className="text-xs text-destructive mt-1">{errors.location_window_start.message}</p>}
        </div>
        <div>
          <label htmlFor="loc-window-end" className="block text-xs font-medium mb-1">Cierre</label>
          <input
            id="loc-window-end"
            type="time"
            {...register('location_window_end')}
            className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
            disabled={isPending}
          />
          {errors.location_window_end && <p className="text-xs text-destructive mt-1">{errors.location_window_end.message}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="sla-cutoff" className="block text-xs font-medium mb-1">
          Cierre de retiros <span className="text-text-muted font-normal">(opcional)</span>
        </label>
        <input
          id="sla-cutoff"
          type="time"
          {...register('sla_pickup_cutoff_time')}
          className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
          disabled={isPending}
        />
        {errors.sla_pickup_cutoff_time && <p className="text-xs text-destructive mt-1">{errors.sla_pickup_cutoff_time.message}</p>}
      </div>
    </div>
  );
}
