'use client';

import { useState } from 'react';

/**
 * spec-76 task 2 (2d) — the client side of `PATCH /api/dispatch/routes/[id]`.
 * Same shape as `useSealLoadPosition.ts` (fetch + loading state, no
 * react-query mutation) — this is a one-shot action from a bottom sheet,
 * not a cached read.
 */
export interface AssignOutcome {
  ok: boolean;
  message?: string;
  code?: string | null;
  vehicleId?: string;
  driverName?: string | null;
}

export function useAssignVehicleAndDriver() {
  const [isAssigning, setIsAssigning] = useState(false);

  const assign = async (
    routeId: string,
    truckIdentifier: string,
    driverName: string | null,
  ): Promise<AssignOutcome> => {
    setIsAssigning(true);
    try {
      // An empty/blank typed name is "no driver yet", same as `null` — the
      // driver field is optional (spec-76 decision 6: assignment is not a
      // scanning precondition, and naming a driver is not a precondition
      // of assignment either).
      const trimmedDriver = driverName?.trim() || null;
      const res = await fetch(`/api/dispatch/routes/${routeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ truck_identifier: truckIdentifier, driver_name: trimmedDriver }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, message: json.message ?? 'No se pudo asignar el camión', code: json.code ?? null };
      }
      return { ok: true, vehicleId: json.vehicle_id, driverName: json.driver_name ?? null };
    } catch {
      return { ok: false, message: 'Error al asignar — intenta de nuevo', code: null };
    } finally {
      setIsAssigning(false);
    }
  };

  return { assign, isAssigning };
}
