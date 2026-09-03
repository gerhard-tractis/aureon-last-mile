'use client';

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useVehicleAssignmentOptions } from '@/hooks/dispatch/mobile/useVehicleAssignmentOptions';
import { useAssignVehicleAndDriver } from '@/hooks/dispatch/mobile/useAssignVehicleAndDriver';
import { DispatchVehiclePickerRow } from './DispatchVehiclePickerRow';

/**
 * spec-76 task 2 — `2d`, the bottom sheet `2c`'s "Asignar camión y
 * conductor" opens. Persists onto `routes.vehicle_id`/`driver_name` via
 * `PATCH /api/dispatch/routes/[id]` (useAssignVehicleAndDriver) at
 * ASSIGNMENT time — see that route handler's header for why this used to
 * be impossible before this task.
 *
 * Rule 7 (Lecciones aplicadas) — `enabled: false` stops the fetch, not the
 * QueryObserver. `useVehicleAssignmentOptions` is only called from
 * `Body`, and `Body` is only rendered while `open` — a genuine mount gate,
 * not a prop threaded down to a hook that mounts regardless.
 *
 * The mock's primary action reads "Asignar y empezar carga" — that literal
 * copy is kept because it is the design's copy, but this sheet does not
 * navigate to a scan screen: `2e` (spec-76 task 4) does not exist on this
 * branch yet (see DispatchRouteSurface.tsx's own SCAN_NOT_READY_REASON).
 * `onAssigned` only reports the completed assignment back to the caller
 * (2c refetches its load brief and shows the truck); wiring the CTA to
 * actually start scanning is task 4's job, not this one's.
 */
export interface DispatchVehicleAssignmentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routeId: string;
  routeCode: string;
  operatorId: string;
  onAssigned: (result: { vehicleId: string; driverName: string | null }) => void;
}

export function DispatchVehicleAssignmentSheet({
  open,
  onOpenChange,
  routeId,
  routeCode,
  operatorId,
  onAssigned,
}: DispatchVehicleAssignmentSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        {open && (
          <Body
            routeId={routeId}
            routeCode={routeCode}
            operatorId={operatorId}
            onAssigned={onAssigned}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

interface BodyProps {
  routeId: string;
  routeCode: string;
  operatorId: string;
  onAssigned: (result: { vehicleId: string; driverName: string | null }) => void;
  onClose: () => void;
}

function Body({ routeId, routeCode, operatorId, onAssigned, onClose }: BodyProps) {
  const { data: rows, isLoading, isError, refetch } = useVehicleAssignmentOptions(routeId, operatorId, {
    enabled: true,
  });
  const { assign, isAssigning } = useAssignVehicleAndDriver();

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [driverName, setDriverName] = useState('');
  const [driverTouched, setDriverTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedRow = (rows ?? []).find((r) => r.id === selectedVehicleId) ?? null;

  const handleSelect = (vehicleId: string) => {
    setSelectedVehicleId(vehicleId);
    setError(null);
    if (!driverTouched) {
      const row = (rows ?? []).find((r) => r.id === vehicleId);
      setDriverName(row?.driverName ?? '');
    }
  };

  const handleAssign = async () => {
    if (!selectedRow) return;
    setError(null);
    const outcome = await assign(routeId, selectedRow.externalVehicleId, driverName);
    if (!outcome.ok) {
      setError(outcome.message ?? 'No se pudo asignar el camión');
      return;
    }
    onAssigned({ vehicleId: outcome.vehicleId ?? selectedRow.id, driverName: outcome.driverName ?? null });
    onClose();
  };

  return (
    <div className="flex flex-col gap-4 pt-2">
      <SheetHeader className="text-left">
        <SheetTitle className="font-mono text-[15px]">
          {routeCode} · Camión y conductor
        </SheetTitle>
        <SheetDescription>
          Flota disponible en la nave. Un camión que ya lleva otra ruta hoy aparece bloqueado.
        </SheetDescription>
      </SheetHeader>

      {isLoading ? (
        <div data-testid="vehicle-assignment-sheet-skeleton" className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full rounded-[10px]" />
          <Skeleton className="h-14 w-full rounded-[10px]" />
          <Skeleton className="h-14 w-full rounded-[10px]" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-[13.5px] text-status-error-text">No pudimos cargar la flota.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="min-h-[44px] rounded-[10px] border border-border px-4 text-[13.5px] font-medium text-text active:opacity-90"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <div role="radiogroup" aria-label="Vehículos" className="flex flex-col gap-2">
          {(rows ?? []).map((row) => (
            <DispatchVehiclePickerRow
              key={row.id}
              row={row}
              selected={row.id === selectedVehicleId}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="dispatch-driver-name" className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">
          Conductor
        </label>
        <input
          id="dispatch-driver-name"
          type="text"
          value={driverName}
          onChange={(e) => {
            setDriverTouched(true);
            setDriverName(e.target.value);
          }}
          placeholder="Nombre del conductor"
          className="h-11 w-full rounded-[10px] border border-border bg-background px-3.5 text-[13.5px] text-text placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>

      {error && <p className="text-[13px] text-status-error-text">{error}</p>}

      <Button
        type="button"
        onClick={handleAssign}
        disabled={!selectedRow || isAssigning}
        className="min-h-[56px] w-full text-[14.5px] font-semibold"
      >
        {isAssigning ? 'Asignando…' : 'Asignar y empezar carga'}
      </Button>
    </div>
  );
}
