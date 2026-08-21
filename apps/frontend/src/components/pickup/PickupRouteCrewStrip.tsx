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
 * input, and a test that keeps it that way. The overflow indicator below is
 * plain text for the same reason — it is not a "show more" control.
 *
 * `full_name` is nullable and the null is reachable: the RPC LEFT JOINs
 * `users`, whose RLS hides soft-deleted rows, so a member whose account was
 * deleted mid-route comes back as a seat with no name. They are still on the
 * trip, so they still get a chip — labelled with the actual reason, never a
 * raw uuid and never a vague "missing data" placeholder that would send a
 * leader chasing a non-issue.
 */

const PLACEHOLDER = 'Cuenta eliminada';

/**
 * Chips shown before the strip stops growing, leader included. spec-61 puts
 * no cap on crew size at any layer, and this strip sits above the STATS grid
 * and the "next load" hero — the one thing the driver opened the screen to
 * tap. Nine chips wrap to about four rows on a 390px phone and push the hero
 * roughly 130px down. Five is two rows at that width.
 *
 * Capping is the fix rather than reordering: moving the strip below the STATS
 * grid would protect the grid but not the hero, which sits below both either
 * way. The eyebrow keeps counting everyone, so the number is never the thing
 * that gets truncated.
 */
const MAX_CHIPS = 5;

export interface PickupRouteCrewStripProps {
  /** The leader's name — null when their user row is gone. */
  driverName: string | null;
  /** Everyone else aboard; already excludes removed seats (Task 4). */
  crew: RouteCrewMember[];
}

const chipClass =
  // Same token pair as StatTile's neutral box, which is the row directly
  // below this one — a chip that reads as a sibling of those tiles rather
  // than as a third surface. `bg-surface-raised` was the first draft and is
  // wrong here: against `--color-background` it is a 1.02:1 fill, so the
  // chips had no boundary at all in light mode.
  'flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[12.5px] text-text';

const badgeClass =
  // A bordered, tinted pill — the shape every other inline marker in this
  // folder uses (PickupRouteDraftPanel, PickupMobileNextLoadCard). Bare
  // `text-text-muted` at 9.5px was ~2.3:1 on light and failed to read as a
  // role at all; `text-text-secondary` on a distinct fill is ~4.6:1 light,
  // ~8:1 dark.
  'flex-none rounded border border-border bg-surface-raised px-1 py-[2px] font-mono text-[9.5px] font-semibold uppercase tracking-[.08em] text-text-secondary';

export function PickupRouteCrewStrip({ driverName, crew }: PickupRouteCrewStripProps) {
  // A solo route has no "equipo" to speak of; an eyebrow reading "EQUIPO · 1"
  // over a single chip that repeats the name already in the header is noise.
  if (crew.length === 0) return null;

  const leaderName = driverName ?? PLACEHOLDER;
  const shown = crew.slice(0, MAX_CHIPS - 1);
  const hidden = crew.length - shown.length;

  return (
    // Labelled BY the eyebrow rather than with an aria-label of its own: one
    // string instead of two competing ones, and it makes the count part of
    // the region's accessible name instead of leaving it associated with
    // nothing.
    <section aria-labelledby="crew-strip-eyebrow" className="flex flex-col gap-2">
      <p
        id="crew-strip-eyebrow"
        className="font-mono text-[10.5px] font-semibold uppercase tracking-[.08em] text-text-muted"
      >
        EQUIPO · {crew.length + 1}
      </p>
      <ul className="flex flex-wrap gap-2">
        {/* The badge is aria-hidden and the role folded into the item's own
            label, so this announces "M. Rojas, líder" rather than running
            the name and the badge together as one string. */}
        <li data-testid="crew-member" aria-label={`${leaderName}, líder`} className={chipClass}>
          {/* No `truncate`: a phone has no hover, and Decision 1 leaves no
              tap target, so a clipped name is unrecoverable — the driver
              would have no way to find out who is in their van, which is
              the whole point of the strip. Let it wrap instead. */}
          <span>{leaderName}</span>
          <span aria-hidden="true" className={badgeClass}>
            Líder
          </span>
        </li>
        {shown.map((member) => (
          <li key={member.user_id} data-testid="crew-member" className={chipClass}>
            <span>{member.full_name ?? PLACEHOLDER}</span>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p data-testid="crew-overflow" className="text-[12px] text-text-secondary">
          +{hidden} más
        </p>
      )}
    </section>
  );
}
