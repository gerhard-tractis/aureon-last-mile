import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export interface Vehicle {
  id: string;
  plate: string;
  vehicle_type: string | null;
  active: boolean;
}

/**
 * The migration's placeholder vehicle for historical routes. It is `active =
 * false` in the database and must never be selectable, nor re-created as an
 * active row — the DB would reject it, but we fail earlier and in Spanish.
 */
export const RESERVED_PLATE = 'SIN-REGISTRO';

export const RESERVED_PLATE_MESSAGE =
  'SIN-REGISTRO es una patente reservada del sistema. Usa la patente real del vehículo.';

export const EMPTY_PLATE_MESSAGE = 'Ingresa una patente';

/** Plates are stored canonical: trimmed and upper-cased. */
export function normalizePlate(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Active, non-deleted vehicles for the operator, ordered by plate. This is the
 * option list behind `VehicleSelect`; a pickup route cannot start without one.
 */
export function useVehicles(operatorId: string | null) {
  return useQuery<Vehicle[]>({
    queryKey: ['pickup', 'vehicles', operatorId],
    enabled: !!operatorId,
    staleTime: 60_000,
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, plate, vehicle_type, active')
        .eq('operator_id', operatorId!)
        .eq('active', true)
        .is('deleted_at', null)
        .order('plate', { ascending: true });

      if (error) throw error;
      return (data ?? []) as Vehicle[];
    },
  });
}

/**
 * Inline plate registration. Target tenants run on paper and Excel today, so
 * demanding a pre-loaded fleet registry would block them on day one — the
 * fleet fills itself during the first week instead.
 */
export function useCreateVehicle(operatorId: string | null) {
  const qc = useQueryClient();
  return useMutation<Vehicle, Error, { plate: string }>({
    mutationFn: async ({ plate }) => {
      const normalized = normalizePlate(plate);
      if (!normalized) throw new Error(EMPTY_PLATE_MESSAGE);
      if (normalized === RESERVED_PLATE) throw new Error(RESERVED_PLATE_MESSAGE);

      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('vehicles')
        .insert({ operator_id: operatorId!, plate: normalized })
        .select('id, plate, vehicle_type, active')
        .single();

      if (error) throw new Error(error.message);
      return data as Vehicle;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pickup', 'vehicles', operatorId] });
    },
  });
}
