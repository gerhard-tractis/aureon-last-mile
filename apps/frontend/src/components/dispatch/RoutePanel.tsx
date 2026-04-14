'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { FleetVehicle } from '@/lib/dispatch/types';

interface Props {
  packageCount: number;
  vehicles: FleetVehicle[];
  selectedVehicle: string;
  driverName: string;
  routeClosed: boolean;
  dispatching: boolean;
  dispatchError: string | null;
  canDelete?: boolean;
  onVehicleChange: (v: string) => void;
  onDriverChange: (v: string) => void;
  onClose: () => void;
  onDispatch: () => void;
  onRetry: () => void;
  onDelete?: () => void;
}

export function RoutePanel({
  packageCount,
  vehicles,
  selectedVehicle,
  driverName,
  routeClosed,
  dispatching,
  dispatchError,
  canDelete,
  onVehicleChange,
  onDriverChange,
  onClose,
  onDispatch,
  onRetry,
  onDelete,
}: Props) {
  return (
    <div className="w-full md:w-[340px] shrink-0 flex flex-col bg-surface border-l-[1.5px] border-border">
      {/* Vehicle section */}
      <div className="px-5 py-[18px] border-b border-border">
        <h3 className="text-[10px] font-bold tracking-widest uppercase text-text-muted mb-3.5">
          Vehículo
        </h3>
        <div className="mb-3.5">
          <div className="text-[11px] text-text-muted mb-1.5">Camión</div>
          <select
            value={selectedVehicle}
            onChange={(e) => onVehicleChange(e.target.value)}
            disabled={routeClosed}
            className="w-full min-h-[52px] bg-background border-[1.5px] border-border rounded-[10px] text-text text-[15px] px-3.5 cursor-pointer outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">Seleccionar camión…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.external_vehicle_id}>
                {v.external_vehicle_id}
                {v.plate_number ? ` · ${v.plate_number}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-[11px] text-text-muted mb-1.5">
            Conductor (opcional)
          </div>
          <Input
            value={driverName}
            onChange={(e) => onDriverChange(e.target.value)}
            disabled={routeClosed}
            placeholder="Nombre o RUT…"
            className="min-h-[52px] rounded-[10px] border-[1.5px] text-[15px] px-3.5"
          />
        </div>
      </div>

      {/* Summary section */}
      <div className="px-5 py-[18px] border-b border-border">
        <h3 className="text-[10px] font-bold tracking-widest uppercase text-text-muted mb-3.5">
          Resumen
        </h3>
        <div className="grid grid-cols-2 gap-2.5">
          {(['Paquetes', 'Órdenes'] as const).map((label) => (
            <div
              key={label}
              className="bg-surface-raised border border-border rounded-lg px-3 py-2.5 text-center"
            >
              <div className="font-mono text-[22px] font-bold text-text">
                {packageCount}
              </div>
              <div className="text-[11px] text-text-muted mt-px">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions section */}
      <div className="mt-auto px-5 py-4 border-t border-border flex flex-col gap-2.5">
        {dispatchError && (
          <div className="bg-status-error-bg border border-status-error-border text-status-error px-3.5 py-2.5 rounded-lg text-xs">
            ⚠ {dispatchError}{' '}
            <button
              onClick={onRetry}
              className="bg-transparent border-none cursor-pointer text-status-error underline text-xs"
            >
              Reintentar
            </button>
          </div>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="w-full h-13 rounded-[10px] text-[15px] font-semibold"
              disabled={routeClosed || packageCount === 0}
            >
              Cerrar Ruta
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar cierre de ruta</AlertDialogTitle>
              <AlertDialogDescription>
                No se podrán agregar más paquetes a esta ruta después de
                cerrarla.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={onClose}>
                Cerrar ruta
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              className="w-full h-14 rounded-[10px] text-base font-extrabold"
              disabled={!routeClosed || !selectedVehicle || dispatching}
            >
              {dispatching ? 'Despachando…' : 'Despachar a DispatchTrack →'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar despacho</AlertDialogTitle>
              <AlertDialogDescription>
                Se enviará la ruta con {packageCount} paquetes a DispatchTrack.
                Esta acción no se puede deshacer.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={onDispatch}>
                Despachar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {canDelete && onDelete && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="w-full h-10 rounded-[10px] text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Eliminar Ruta
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar esta ruta?</AlertDialogTitle>
                <AlertDialogDescription>
                  Los paquetes asignados volverán al estado <strong>asignado</strong>. Esta acción no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
