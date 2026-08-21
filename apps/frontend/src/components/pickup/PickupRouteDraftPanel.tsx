'use client';

import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StartRouteButton } from './StartRouteButton';
import type { ManifestRow } from './ManifestTable';

/**
 * spec-54 phase 4.4 — "Nueva ruta de recogida" (mock 1l, right column top).
 *
 * The mock shows an estimated vehicle occupancy bar. It is not rendered:
 * occupancy needs a vehicle capacity and a package volume, and neither
 * `vehicles` nor `packages` carries one. A guessed percentage on the screen
 * that decides whether a van is full would be actively harmful.
 *
 * When a route is already open the panel steps aside — the driver has one
 * active route at a time (start_pickup_route enforces it), so offering to
 * create a second is offering an error. spec-61 adds two more reasons the
 * button steps aside: the caller cannot lead a route, or we could not find
 * out whether they already have one.
 */

interface PickupRouteDraftPanelProps {
  operatorId: string | null;
  selected: ManifestRow[];
  onRemove: (id: string) => void;
  /** Creates the route with the chosen vehicle, then attaches the selection. */
  onCreate: (vehicleId: string) => void;
  isCreating?: boolean;
  /** Set when the driver already has a route open. */
  activeRouteCode?: string | null;
  /** spec-61 — false for a pickup_crew user. Defaults to true so no
   *  pre-spec-61 caller changes meaning. */
  canLead?: boolean;
  /** spec-61 — true when the active-route lookup FAILED. Distinct from
   *  `activeRouteCode === null`, which means "asked, and there is none". */
  routeUnknown?: boolean;
  /** spec-61 — true while the JWT claims are still resolving. `canLead` is
   *  false then, but because the role is UNKNOWN, not because it is crew. */
  roleUnknown?: boolean;
}

export function PickupRouteDraftPanel({
  operatorId,
  selected,
  onRemove,
  onCreate,
  isCreating = false,
  activeRouteCode = null,
  canLead = true,
  routeUnknown = false,
  roleUnknown = false,
}: PickupRouteDraftPanelProps) {
  const orders = selected.reduce((sum, m) => sum + m.orderCount, 0);
  const packages = selected.reduce((sum, m) => sum + m.packageCount, 0);

  return (
    <section className="flex flex-none flex-col overflow-hidden rounded-[10px] border border-border bg-surface">
      <header className="flex flex-none items-center gap-2 border-b border-border px-4 py-3.5">
        <h2 className="font-heading text-[12.5px] font-semibold leading-none text-text">
          Nueva ruta de recogida
        </h2>
        <span
          className={cn(
            'ml-auto rounded-[5px] border px-1.5 py-[3px] font-mono text-[10.5px] font-semibold leading-none',
            selected.length > 0
              ? 'border-status-warning-border bg-accent-muted text-accent'
              : 'border-border bg-surface-raised text-text-muted',
          )}
        >
          BORRADOR
        </span>
      </header>

      {/* spec-61 Task 5 — a FAILED active-route lookup leaves `activeRouteCode`
          null, which used to read as "no route open" and offered the start
          button to a leader who already had one. Say we do not know instead.
          First, because it is true regardless of who is looking. */}
      {routeUnknown ? (
        <p className="px-4 py-8 text-center text-[12.5px] leading-normal text-text-secondary">
          No pudimos cargar tu ruta. Actualiza la página antes de abrir otra.
        </p>
      ) : activeRouteCode ? (
        <p className="px-4 py-8 text-center text-[12.5px] leading-normal text-text-secondary">
          Ya tienes la ruta{' '}
          <span className="font-mono font-semibold text-text">{activeRouteCode}</span> en curso.
          Ciérrala antes de armar otra.
        </p>
      ) : !canLead && !roleUnknown ? (
        // spec-61 Task 5 — `1l`'s own start affordance, gated the same way
        // 3j is. Placed AHEAD of the empty-selection prompt on purpose: a
        // crew member should learn they cannot open a route before they
        // spend time ticking manifests for one, not after.
        //
        // `&& !roleUnknown`: while GlobalContext is still resolving the JWT
        // claims, `role` is null and canLead is false — but it is false
        // because the answer is UNKNOWN, not because the caller is crew.
        // Without this a real leader read "Solo un líder de ruta puede abrir
        // una ruta" for the whole auth round-trip on every cold load. Fall
        // through to the selection prompt instead: it is true regardless of
        // who is asking, so it can be shown before we know.
        <p className="px-4 py-3 text-[12.5px] text-text-secondary">
          Solo un líder de ruta puede abrir una ruta. Pídele que te agregue a la suya.
        </p>
      ) : selected.length === 0 ? (
        <p className="px-4 py-8 text-center text-[12.5px] leading-normal text-text-secondary">
          Marca los manifiestos de la tabla y agrégalos a una ruta de recogida.
        </p>
      ) : (
        <>
          <div className="flex flex-none items-center gap-2 border-b border-border bg-background px-4 py-2.5">
            <span className="font-mono text-[9.5px] font-medium uppercase tracking-[.1em] text-text-secondary">
              Manifiestos en la ruta
            </span>
            <span className="ml-auto font-mono text-[10.5px] font-semibold leading-none text-text-secondary">
              {selected.length}
            </span>
          </div>

          <div className="flex max-h-64 flex-none flex-col overflow-y-auto">
            {selected.map((m, i) => (
              <div
                key={m.id ?? m.externalLoadId}
                data-testid="draft-manifest"
                className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-2.5 last:border-b-0"
              >
                <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-surface-raised font-mono text-[10px] font-semibold text-text-secondary">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="truncate font-mono text-[11.5px] font-semibold leading-none text-text">
                    {m.externalLoadId}
                  </span>
                  <span className="truncate text-[10.5px] leading-none text-text-muted">
                    {m.retailerName ?? 'Sin cliente'} · {m.packageCount} paq.
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`Quitar ${m.externalLoadId} de la ruta`}
                  onClick={() => m.id && onRemove(m.id)}
                  className="flex-none rounded p-1 text-text-muted transition-colors hover:text-text"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-none flex-col gap-2.5 border-t border-border bg-background px-4 py-3">
            <span className="text-xs font-semibold leading-none text-text">
              {orders} {orders === 1 ? 'orden' : 'órdenes'} · {packages}{' '}
              {packages === 1 ? 'paquete' : 'paquetes'}
            </span>
            <StartRouteButton
              operatorId={operatorId}
              isSubmitting={isCreating}
              onStart={onCreate}
            />
          </div>
        </>
      )}
    </section>
  );
}
