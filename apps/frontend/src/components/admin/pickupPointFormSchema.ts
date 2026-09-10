import { z } from 'zod';

/**
 * Extracted from PickupPointForm.tsx so PickupPointLocationFields.tsx can
 * type its `register` prop against the same shape without a circular
 * import between the form and its own fieldset.
 *
 * All fields optional — operators want to save partial records and fill in
 * the rest later. Backend (API + DB) accepts nulls/empty strings and stores
 * pickup_locations as an empty array when no location data is provided.
 */
export const pickupPointSchema = z.object({
  name: z.string().optional(),
  code: z.string().optional(),
  tenant_client_id: z.string().optional(),
  is_active: z.boolean(),
  location_name: z.string().optional(),
  location_address: z.string().optional(),
  location_comuna: z.string().optional(),
  location_contact_name: z.string().optional(),
  location_contact_phone: z.string().optional(),
  // spec-83 fase 2 — the write path for operating_hours/pickup_cutoff_time.
  // Nobody could populate either before this: the schema had the columns
  // since March (pickup_locations[].operating_hours, sla_config), but no
  // form field ever wrote to them.
  location_window_start: z.string().optional(),
  location_window_end: z.string().optional(),
  sla_pickup_cutoff_time: z.string().optional(),
});

export type PickupPointFormValues = z.infer<typeof pickupPointSchema>;
