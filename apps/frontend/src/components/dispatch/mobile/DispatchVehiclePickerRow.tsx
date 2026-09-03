'use client';

import { Lock, Truck } from 'lucide-react';
import type { VehiclePickerRow } from '@/lib/dispatch/mobile/vehicle-picker';

/**
 * spec-76 task 2 (2d) — one row of the vehicle list inside the "Asignar
 * camión y conductor" sheet.
 *
 * Lecciones aplicadas #4 (this module's own rule, already learned twice in
 * spec-75): never a role-bearing container wrapping an interactive child.
 * An assignable row is exactly ONE native `<button role="radio">` — no
 * wrapping `<div>`, nothing else focusable inside it. A blocked or
 * unconfigured row renders as a plain, non-interactive `<div>`: visible
 * (decision 6 — never hidden), but genuinely inert, not a disabled control
 * pretending to be tappable. `DispatchVehiclePickerRow.test.tsx` asserts a
 * blocked row exposes neither `role="radio"` nor `role="button"`.
 *
 * The mock's `ZALDUENDO · RTHK-72` pairs a manufacturer/fleet name with the
 * identifier. `fleet_vehicles` has no such column — only
 * `external_vehicle_id` (spec-76's own "campos que no existen" table
 * applies here too, not documented there because task 1 never reached this
 * screen) — so only the real identifier is rendered, never a fabricated
 * brand.
 */
export interface DispatchVehiclePickerRowProps {
  row: VehiclePickerRow;
  selected: boolean;
  onSelect: (vehicleId: string) => void;
}

function typeAndCapacityLabel(row: VehiclePickerRow): string {
  const type = row.vehicleType ?? 'Vehículo';
  if (row.capacityPackages == null) return type;
  return `${type} · ${row.capacityPackages} pqt`;
}

export function DispatchVehiclePickerRow({ row, selected, onSelect }: DispatchVehiclePickerRowProps) {
  if (!row.assignable) {
    return (
      <div
        data-testid="vehicle-picker-row-blocked"
        className="flex min-h-[56px] items-center gap-3 rounded-[10px] border border-border bg-background px-3.5 py-3 opacity-60"
      >
        <Truck className="h-5 w-5 flex-none text-text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-text">{row.externalVehicleId}</p>
          <p className="mt-0.5 text-[12px] text-text-secondary">{typeAndCapacityLabel(row)}</p>
        </div>
        {row.blockReason === 'blocked' ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[.04em] text-status-error-text">
            <Lock className="h-3.5 w-3.5" />
            EN {row.blockedByRouteCode}
          </span>
        ) : (
          <span className="text-[11px] font-medium text-text-muted">Sin capacidad configurada</span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${row.externalVehicleId} · ${typeAndCapacityLabel(row)}`}
      onClick={() => onSelect(row.id)}
      className={`flex min-h-[56px] w-full items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left active:opacity-90 ${
        selected ? 'border-accent bg-accent-light' : 'border-border bg-surface'
      }`}
    >
      <Truck className={`h-5 w-5 flex-none ${selected ? 'text-accent' : 'text-text-muted'}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-text">{row.externalVehicleId}</p>
        <p className="mt-0.5 text-[12px] text-text-secondary">{typeAndCapacityLabel(row)}</p>
      </div>
      {row.driverName && (
        <span className="max-w-[35%] truncate text-[11.5px] text-text-muted">{row.driverName}</span>
      )}
    </button>
  );
}
