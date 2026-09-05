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
import { LOADABLE_ROUTE_STATUSES, OPEN_ROUTE_STATUSES, type FleetVehicle, type RouteStatus, type TerritoryHistoryEntry } from '@/lib/dispatch/types';
import type { DispatchErrorInfo } from '@/lib/dispatch/dispatch-review';
import { TerritoryStability } from './TerritoryStability';

/**
 * spec-75 phase 4 review — "Cerrar Ruta" (seal) was briefly removed from
 * this panel on the theory that decision 4 ("closing is crew-mobile only,
 * `2i`, spec-77") meant desktop closing could go now. Reverted: verified
 * zero clients call `POST /api/dispatch/routes/[id]/seal` once it was
 * gone — the mobile `2i` replacement doesn't exist yet (`disabled`,
 * "El cierre de ruta es la próxima pantalla — spec-77", and spec-77 is
 * `Status: backlog`, phase 1 `[pending]`). That is the exact sequencing
 * spec-75's own "Orden alterado" section requires for scanning (build the
 * replacement, then retire the old path) — it applies to closing too, not
 * just scanning. Keep this action until spec-77 phase 1 ships a working
 * mobile close; that is the commit that gets to delete it, not this one.
 */

interface Props {
  packageCount: number;
  vehicles: FleetVehicle[];
  selectedVehicle: string;
  driverName: string;
  /**
   * spec-70 phase 4, breakage #3. The route's real status, not a local
   * `useState` a reload could wipe. `undefined` while the route is still
   * loading is treated as "not yet actionable" — every affordance below
   * defaults to disabled rather than guessing.
   */
  routeStatus: RouteStatus | undefined;
  dispatching: boolean;
  /** spec-79 M-2 (round 8 mediums): the mapped `dispatchErrorCopy` result,
   *  not a raw string — a discarded `code` used to surface an untranslated
   *  internal message (e.g. a fetch/AbortSignal timeout string) for
   *  `DT_OUTCOME_UNKNOWN`. */
  dispatchError: DispatchErrorInfo | null;
  onVehicleChange: (v: string) => void;
  onDriverChange: (v: string) => void;
  onClose: () => void;
  onDispatch: () => void;
  onRetry: () => void;
  onDelete?: () => void;
  /**
   * spec-72 phase 4 (Decision 6) — territory stability. All default so
   * every pre-existing caller (and every test in RoutePanel.test.tsx) keeps
   * rendering exactly as before without passing any of them.
   *
   * `territoryOrphanCount` defaults to `0`, not `null` — an omitted prop
   * means "this caller doesn't wire territory data at all" (the pre-spec-72
   * shape), which is a different fact from RouteBuilder.tsx's own `null`
   * ("wired, but the blocks read failed" — review item 4).
   */
  territory?: TerritoryHistoryEntry[];
  territoryOrphanCount?: number | null;
  isDriverSuggested?: boolean;
}

export function RoutePanel({
  packageCount,
  vehicles,
  selectedVehicle,
  driverName,
  routeStatus,
  dispatching,
  dispatchError,
  onVehicleChange,
  onDriverChange,
  onClose,
  onDispatch,
  onRetry,
  onDelete,
  territory = [],
  territoryOrphanCount = 0,
  isDriverSuggested = false,
}: Props) {
  // Same set scan/route.ts's LOADING_WALK and seal/route.ts's SEALABLE_FROM
  // key off — a route can still take stops and still be sealed exactly while
  // it is draft/planned/loading.
  const canLoad = routeStatus != null && (LOADABLE_ROUTE_STATUSES as readonly string[]).includes(routeStatus);
  // Matches what POST /dispatch requires (route.status !== 'loaded' -> 409):
  // Despachar must never be enabled at any other status, including past it.
  const isLoaded = routeStatus === 'loaded';
  /**
   * The truck and driver stay editable through `loaded`, not just while
   * loading.
   *
   * Gating these on `canLoad` alone made a sealed route permanently
   * undispatchable: `selectedVehicle` lives in React state, so reloading the
   * tablet after a seal — the PWA reload this phase exists to survive — came
   * back with an empty selection, a disabled selector and a Despachar button
   * that could never enable. Sealing before picking a truck did the same. The
   * assignment is only frozen once the route actually leaves.
   */
  const canAssignVehicle = canLoad || isLoaded;
  // Matches DELETE /routes/[id]'s OPEN_ROUTE_STATUSES check: delete is legal
  // through 'loaded', refused from 'dispatched' on (spec-70 decision 6).
  const canDelete = routeStatus != null && (OPEN_ROUTE_STATUSES as readonly string[]).includes(routeStatus);

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
            disabled={!canAssignVehicle}
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
            disabled={!canAssignVehicle}
            placeholder="Nombre o RUT…"
            className="min-h-[52px] rounded-[10px] border-[1.5px] text-[15px] px-3.5"
          />
          <TerritoryStability
            territory={territory}
            driverName={driverName}
            orphanCount={territoryOrphanCount}
            isDriverSuggested={isDriverSuggested}
          />
        </div>
      </div>

      {/* Summary section */}
      <div className="px-5 py-[18px] border-b border-border">
        <h3 className="text-[10px] font-bold tracking-widest uppercase text-text-muted mb-3.5">
          Resumen
        </h3>
        {/*
          One tile, not two identical ones: this hook only ever knew the
          order count (breakage #8 — the rows are orders on the route, not
          packages), so a "Paquetes" tile next to an "Órdenes" tile showing
          the same number claimed a package-level count that doesn't exist.
        */}
        <div className="bg-surface-raised border border-border rounded-lg px-3 py-2.5 text-center">
          <div className="font-mono text-[22px] font-bold text-text">
            {packageCount}
          </div>
          <div className="text-[11px] text-text-muted mt-px">Órdenes</div>
        </div>
      </div>

      {/* Actions section */}
      <div className="mt-auto px-5 py-4 border-t border-border flex flex-col gap-2.5">
        {dispatchError && (
          <div className="bg-status-error-bg border border-status-error-border text-status-error px-3.5 py-2.5 rounded-lg text-xs">
            ⚠ {dispatchError.text}{' '}
            <button
              onClick={onRetry}
              className="bg-transparent border-none cursor-pointer text-status-error underline text-xs"
            >
              {dispatchError.primaryLabel ?? 'Reintentar'}
            </button>
          </div>
        )}

        {/* spec-75 phase 4 review — restored, see the header comment above.
            Removed only by spec-77 phase 1, once mobile 2i can close a
            route for real. */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="w-full h-13 rounded-[10px] text-[15px] font-semibold"
              disabled={!canLoad || packageCount === 0}
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
              disabled={!isLoaded || !selectedVehicle || dispatching}
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
                  {/* Fixes breakage #9's stale copy: nothing writes 'asignado' any
                      more — the dock-scan trigger is what puts a package on an
                      andén, and DELETE /routes/[id] reverts to 'sectorizado'. */}
                  Los paquetes asignados volverán al estado <strong>sectorizado</strong>. Esta acción no se puede deshacer.
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
