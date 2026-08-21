'use client';

import type { RouteCrewMember } from '@/hooks/pickup/useActivePickupRoute';

/**
 * spec-61 Task 6 — who is on the trip, on the active-route screen (3h).
 *
 * Before this, 3h named only the driver, so a pickup_crew member riding the
 * leader's route saw a screen that never acknowledged them and a leader had
 * no way to check that the right people were aboard.
 *
 * Read-only by Decision 1: the crew is fixed when the route opens, and
 * `pickup_route_crew.removed_at` has exactly one writer (the route-status
 * trigger). An "add someone" control here would need a second RPC, a second
 * uniqueness path, and an answer to "what happens to the loads they already
 * scanned" — none of which this spec settles. So: no <button>, no <a>, no
 * input, and a test that keeps it that way.
 *
 * `full_name` is nullable and the null is reachable: the RPC LEFT JOINs
 * `users`, whose RLS hides soft-deleted rows, so a member whose account was
 * deleted mid-route comes back as a seat with no name. They are still on the
 * trip, so they still get a chip — under a placeholder, never a raw uuid.
 */

const PLACEHOLDER = 'Sin nombre';

export interface PickupRouteCrewStripProps {
  /** The leader's name — null when their user row is gone. */
  driverName: string | null;
  /** Everyone else aboard; already excludes removed seats (Task 4). */
  crew: RouteCrewMember[];
}

const chipClass =
  'flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-[12.5px] text-text';

export function PickupRouteCrewStrip({ driverName, crew }: PickupRouteCrewStripProps) {
  // A solo route has no "equipo" to speak of; an eyebrow reading "EQUIPO · 1"
  // over a single chip that repeats the name already in the header is noise.
  if (crew.length === 0) return null;

  return (
    <section aria-label="Equipo de la ruta" className="flex flex-col gap-2">
      <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[.08em] text-text-muted">
        EQUIPO · {crew.length + 1}
      </p>
      <ul className="flex flex-wrap gap-2">
        <li data-testid="crew-member" className={chipClass}>
          <span className="truncate">{driverName ?? PLACEHOLDER}</span>
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-text-muted">
            Líder
          </span>
        </li>
        {crew.map((member) => (
          <li key={member.user_id} data-testid="crew-member" className={chipClass}>
            <span className="truncate">{member.full_name ?? PLACEHOLDER}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
