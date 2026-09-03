'use client';

import { Truck, ChevronRight } from 'lucide-react';

/**
 * spec-76 2c / decision 6 — VEHÍCULO Y CONDUCTOR. `routes.vehicle_id` is
 * NULL for every route this screen can show (only the dispatch handler
 * writes it, after `loaded`), so `assignment` is `null` in practice today;
 * this still reads `useRouteLoadBrief`'s real value rather than hardcoding
 * "Sin asignar", so the card stops lying the day that changes. Tapping it
 * is a stub for `2d` (spec-76 task 2, out of scope here) — `onAssign` is
 * left to the caller.
 */
export interface DispatchVehicleAssignmentBlockProps {
  assignment: { externalVehicleId: string; driverName: string | null } | null;
  onAssign: () => void;
}

export function DispatchVehicleAssignmentBlock({ assignment, onAssign }: DispatchVehicleAssignmentBlockProps) {
  return (
    <button
      type="button"
      onClick={onAssign}
      className="flex w-full min-h-[56px] items-center gap-3 rounded-[10px] border border-border bg-surface px-3.5 py-3 text-left active:opacity-90"
    >
      <Truck className="h-5 w-5 flex-none text-text-muted" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-[.06em] text-text-muted">Vehículo y conductor</p>
        {assignment ? (
          <p className="mt-0.5 truncate text-[13.5px] font-medium text-text">
            {assignment.externalVehicleId}
            {assignment.driverName ? ` · ${assignment.driverName}` : ''}
          </p>
        ) : (
          <p className="mt-0.5 text-[13px] text-text-secondary">
            Sin asignar · toca para elegir camión y conductor
          </p>
        )}
      </div>
      <ChevronRight className="h-4 w-4 flex-none text-text-muted" />
    </button>
  );
}
