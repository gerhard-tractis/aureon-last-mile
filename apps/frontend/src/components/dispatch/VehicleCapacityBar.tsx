'use client';

import { cn } from '@/lib/utils';
import {
  OVER_CAPACITY_THRESHOLD_PCT,
  type VehicleCapacityTone,
  type VehicleFillBasis,
  type VehicleFillStatus,
} from '@/lib/dispatch/vehicle-capacity';

/**
 * spec-73 Phase 2 — the dispatch-side sibling of
 * `components/distribution/DockCapacityBar.tsx`, one level up (vehicle
 * instead of dock zone). Lives under `components/dispatch/` rather than
 * `components/distribution/` because every consumer of a vehicle's load —
 * RouteBuilder, RoutePanel, the route list — is a dispatch-side screen;
 * distribution/ is the reception-and-andenes side of the app and has no
 * reason to import this.
 *
 * Takes the `VehicleFillStatus` discriminated union directly (Decision 3 /
 * this phase's return-type requirement) rather than raw `count`/`capacity`
 * props: the whole point of that union is that "unknown" has no numeric
 * field to accidentally pass through, and re-deriving the fill from raw
 * numbers here would reopen exactly the hole the union closes. No
 * additional narrowing helper is needed on top of it — switching on
 * `status.configured` is enough for TypeScript to forbid reading `fillPct`
 * etc. on the unconfigured branch, which is itself a sign the union shape
 * is right for this consumer. Same reason `overCapacity` is read off
 * `status` rather than re-derived here with a local `fillPct > 100` — the
 * module already computed and exported that threshold (and its rounding
 * rule); duplicating it locally is exactly the local arithmetic Decision 3
 * exists to forbid.
 *
 * Renders nothing at all for `configured: false` — not a zero bar, not a
 * grey bar, not a "—". This is the last place "unknown" could still turn
 * into a visible number; a caller who forgets to check `configured` gets
 * an empty `<>` back, never a misleading bar.
 *
 * Tone is never colour-only here (spec-63 precedent: a glyph/word channel
 * must accompany colour for any non-text status). Over-capacity gets
 * "Sobrecarga" ("overloaded" — the freight/logistics term for a vehicle
 * past its rated load; "Sobrecupo" was rejected as an airline/overbooking
 * word with no other use in this codebase). The under-filled warning tone
 * gets its own "Bajo cupo" marker for the same reason: below 100% the only
 * signal used to be colour (amber vs grey), which a colour-blind manager
 * cannot read.
 *
 * `DockCapacityBar` (components/distribution/) shares this markup almost
 * exactly but with INVERTED tone semantics — amber means "nearly full,
 * stop sending" there and "half empty, send more" here. That inversion is
 * intentional (opposite screens, opposite problems) but invisible from the
 * markup alone; see the note in docs/specs/spec-73-capacity-ladder-truck-
 * topup.md before ever merging the two into one shared component.
 */
interface VehicleCapacityBarProps {
  status: VehicleFillStatus;
  className?: string;
}

const FILL_TONE_CLASS: Record<VehicleCapacityTone, string> = {
  neutral: 'bg-text-secondary',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
};

const TRACK_TONE_CLASS: Record<VehicleCapacityTone, string> = {
  neutral: 'bg-surface-raised',
  warning: 'bg-status-warning-bg',
  error: 'bg-status-error-bg',
};

const LABEL_TONE_CLASS: Record<VehicleCapacityTone, string> = {
  neutral: 'text-text-muted',
  warning: 'text-status-warning-text',
  error: 'text-status-error-text',
};

/**
 * spec-73 phase 4c review item 2. "5 / 10" alone is ambiguous, and on the
 * screen that wires this bar (RouteBuilder) it lands a few pixels under a
 * row reading "Órdenes en la ruta · 2" — two different units, adjacent,
 * neither naming itself. `capacity_packages` is a BULTO capacity and
 * `packageCount` is a bulto count, so the bar says so; the same disambiguation
 * spec-74 phase 4 review item 4 already applied to the "Faltan N bultos"
 * banner on that row. Keyed on `status.basis` rather than hard-coded so
 * phase 5's volume/weight basis has to name its own unit instead of
 * inheriting "bultos" silently.
 */
const BASIS_UNIT_LABEL: Record<VehicleFillBasis, string> = {
  packages: 'bultos',
};

export function VehicleCapacityBar({ status, className }: VehicleCapacityBarProps) {
  if (!status.configured) {
    return null;
  }

  const { tone, fillPct, packageCount, capacityPackages, overCapacity, basis } = status;
  const unitLabel = BASIS_UNIT_LABEL[basis];
  // The track itself is always drawn to 100% — fillPct is deliberately not
  // clamped (see lib/dispatch/vehicle-capacity.ts), so the bar's own width
  // clamps for layout. `status.overCapacity` (strictly > 100%, rounded —
  // see the module) drives the extra marker/ring here so a >100% load
  // never renders identically to an exactly-full one, which tone alone
  // (both 'error') can't distinguish.
  const roundedPct = Math.round(fillPct);
  const clampedPct = Math.max(0, Math.min(OVER_CAPACITY_THRESHOLD_PCT, fillPct));

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-1">
          <span className={cn('text-xs font-semibold', LABEL_TONE_CLASS[tone])}>
            {packageCount} / {capacityPackages}
          </span>
          <span data-testid="vehicle-capacity-unit" className={cn('text-[11px]', LABEL_TONE_CLASS[tone])}>
            {unitLabel}
          </span>
        </span>
        <span className={cn('text-[11px]', LABEL_TONE_CLASS[tone])}>
          {overCapacity ? (
            <span data-testid="vehicle-capacity-overcapacity">Sobrecarga · {roundedPct}%</span>
          ) : tone === 'warning' ? (
            <span data-testid="vehicle-capacity-underfilled">Bajo cupo · {roundedPct}%</span>
          ) : (
            `${roundedPct}%`
          )}
        </span>
      </div>
      <div
        role="progressbar"
        // A bare progressbar has no accessible name, so a screen reader
        // announces "25 of 40" with no idea what is being counted — the same
        // ambiguity the visible unit label above fixes for sighted users.
        aria-label={`Carga del camión en ${unitLabel}`}
        aria-valuenow={packageCount}
        aria-valuemin={0}
        aria-valuemax={capacityPackages}
        className={cn(
          'h-1.5 overflow-hidden rounded',
          TRACK_TONE_CLASS[tone],
          // Over-capacity gets a ring the exactly-full state doesn't, so
          // the two error-tone states remain visually distinct.
          overCapacity && 'ring-1 ring-status-error',
        )}
      >
        <span
          data-testid="vehicle-capacity-fill"
          className={cn('block h-full rounded', FILL_TONE_CLASS[tone])}
          style={{ width: `${clampedPct}%` }}
        />
      </div>
    </div>
  );
}
