// apps/frontend/src/lib/dispatch/vehicle-capacity.ts
//
// spec-73 Phase 2 (Decision 3) — the single place that turns a route's
// loaded package count, a vehicle's tier-1 capacity_packages, and a route's
// max_drops into fill percentage, tone, and drop-cap status. Mirrors
// lib/distribution/dock-capacity.ts one level up (vehicle instead of dock
// zone) but deliberately does NOT copy that module's nullable-field shape.
//
// dock-capacity.ts returns one interface with `fillPct: number | null` —
// workable there because every consumer already narrows on `configured`
// before reading it. spec-73's Goal is stronger: capacity must never be
// guessed, and "unknown" must be impossible to accidentally render as a
// number (0% or 100%), not just discouraged by convention. So this module
// returns a discriminated union keyed on the `configured` literal: the
// unconfigured variant has no `fillPct`/`tone`/`remaining*` fields at all.
// A caller cannot write `status.fillPct` without first narrowing
// `status.configured === true` — TypeScript refuses the read, it is not a
// matter of the value happening to be null. That is what makes "unknown"
// structurally impossible to render as a number rather than merely
// discouraged.
//
// Capacity is nullable in the schema on purpose (20260904000001,
// fleet_vehicles.capacity_packages / routes.max_drops): a vehicle or route
// nobody configured gets tier-0 treatment forever — the raw count is still
// shown by whatever screen embeds these results, only the fill bar / cap
// warning disappears. This module treats 0 and negative capacity/max_drops
// the same as unconfigured — a defensive floor, since neither column has a
// CHECK constraint enforcing positivity (spec-73 Decision 2).
//
// Over-capacity (fillPct > 100) is a real, renderable state, not an error:
// a manager can load a vehicle past its typed number (a bad guess, a rush
// day), and the fill bar needs to say "130%", not throw or silently clamp
// to "full". fillPct is therefore never clamped above 100 — same choice
// dock-capacity.ts made, same reasoning. `remaining` IS clamped at 0 (there
// is no such thing as "-30 packages remaining" to render).
//
// Non-finite input (NaN, Infinity — the reliable shape of an empty or
// invalid `<input type="number">`, e.g. `valueAsNumber`, `Number('abc')`,
// `parseInt('abc')`) is a distinct failure mode from "unset". A capacity or
// max_drops of NaN/Infinity is not "the operator typed a bad number and we
// know it" — arithmetic on it (`NaN <= 0` is false) would otherwise slip
// straight past the `<= 0` guard and land on the `configured: true` side
// with a `NaN`/`Infinity`-poisoned result. Both guards below therefore
// reject non-finite capacity/max_drops the same way they reject null and
// <= 0: `configured: false`. That is the honest answer — not "usable",
// just non-throwing — we cannot compute a fill from a number that isn't
// one.
//
// A non-finite *count* (packageCount/dropCount) is a narrower case: the
// capacity/max_drops side is validly configured, only the count is
// garbage. For `getVehicleFillStatus` that count feeds a soft, advisory
// tone (nothing downstream blocks an action on it in this phase), so a
// non-finite packageCount is treated as 0 — a real, renderable "we don't
// see any packages" state that nudges towards the warning tone rather than
// inventing a fabricated number. `getMaxDropsStatus`'s max_drops is a hard
// constraint (Decision 6) that phase 4 reads to decide whether to *offer*
// a top-up: a non-finite dropCount must not fail open into "not at cap,
// go ahead" (see spec-73 review, finding 1). It fails closed instead —
// `atCap: true` — so an unknown drop count never looks like room to add
// more.

export type VehicleCapacityTone = 'neutral' | 'warning' | 'error';

/** What the fill computation was derived from. spec-73's Decision 1 ladder
 *  is package-count-only in this phase; later phases (5) make fill
 *  volume/weight-aware. Adding the discriminator now — while there are
 *  zero consumers — means a future basis is additive, not a breaking
 *  rename of every call site that currently assumes "packages". */
export type VehicleFillBasis = 'packages';

/**
 * Tier 0/1 fill status for a vehicle's package load.
 *
 * `configured: false` carries only the raw count — no fillPct, no tone, no
 * remaining figure exist on this variant. `configured: true` carries the
 * full computed status. A caller must narrow on `configured` before it can
 * reach any numeric fill field; there is no nullable-number shortcut.
 */
export type VehicleFillStatus =
  | {
      configured: false;
      packageCount: number;
    }
  | {
      configured: true;
      packageCount: number;
      capacityPackages: number;
      /** What this fill was computed from. Always 'packages' in this
       *  phase — see `VehicleFillBasis`. */
      basis: VehicleFillBasis;
      /** e.g. 93.9 for 169/180. Raw, unrounded, not clamped above 100 —
       *  over-capacity is a real state the UI must be able to show, not
       *  hide. `tone`/`atCapacity`/`overCapacity` are derived from the
       *  *rounded* percentage (see module tone rule below) so they always
       *  agree with `Math.round(fillPct)`, the value every consumer
       *  actually renders — this field stays raw for a caller that needs
       *  the exact number. */
      fillPct: number;
      tone: VehicleCapacityTone;
      /** Packages of room left, clamped at 0 (never negative). */
      remaining: number;
      /** True once the *rounded* fill percentage is >= 100 — "this load is
       *  finished", not "this load is illegal". Use this to decide whether
       *  a truck is done loading. */
      atCapacity: boolean;
      /** True once the *rounded* fill percentage is STRICTLY > 100 — the
       *  load exceeds the vehicle's typed capacity, an over-capacity state
       *  distinct from "exactly full". Use this to decide whether to show
       *  the over-capacity marker. An exactly-full truck (atCapacity but
       *  not overCapacity) is finished, not illegal. */
      overCapacity: boolean;
    };

/**
 * Tier-0-always-visible drop-count status against a route's optional
 * max_drops cap (spec-73 Decision 6). Independent of package/volume
 * capacity entirely — a route can be well under its package capacity and
 * still be at its drop cap. Deliberately NOT implemented in terms of
 * `getVehicleFillStatus`: max_drops has its own basis (drop count, not
 * package count) and its own hard-constraint fail-closed rule for
 * non-finite input (see module header) that fill status does not share —
 * delegating would silently reintroduce the fill module's softer,
 * advisory-tone behaviour onto a hard cap.
 */
export type MaxDropsStatus =
  | {
      configured: false;
      dropCount: number;
    }
  | {
      configured: true;
      dropCount: number;
      maxDrops: number;
      /** True once dropCount >= maxDrops. */
      atCap: boolean;
      /** Drops of room left, clamped at 0. */
      remaining: number;
    };

// Inverted from dock-capacity.ts's thresholds (90% warning / 100% error for
// "too full"): this module's low end is the interesting one. spec-73's
// Decision 1 problem is trucks leaving half full, so the warning tone
// fires for being too EMPTY, not for approaching full. Neutral is the
// well-loaded middle band; error is reserved for over-capacity, the one
// state that is unambiguously a problem regardless of intent.
const UNDERFILL_WARNING_THRESHOLD_PCT = 50;
export const OVER_CAPACITY_THRESHOLD_PCT = 100;

function toneForFillPct(fillPct: number): VehicleCapacityTone {
  if (fillPct >= OVER_CAPACITY_THRESHOLD_PCT) return 'error';
  if (fillPct < UNDERFILL_WARNING_THRESHOLD_PCT) return 'warning';
  return 'neutral';
}

/**
 * Tier 0/1 vehicle fill status. `capacityPackages` is the vehicle's
 * `fleet_vehicles.capacity_packages` (may be null/unset). `packageCount` is
 * the route's current loaded package count.
 *
 * Never throws. A capacity of null, 0, negative, or non-finite (NaN,
 * Infinity) — and a package count above capacity, negative, or non-finite —
 * all produce a result without throwing. Non-finite capacity is honestly
 * unconfigured (see module header): we cannot compute a fill from a number
 * that isn't one.
 */
export function getVehicleFillStatus(
  packageCount: number,
  capacityPackages: number | null,
): VehicleFillStatus {
  const safeCount = Number.isFinite(packageCount) ? Math.max(0, packageCount) : 0;

  if (capacityPackages == null || !Number.isFinite(capacityPackages) || capacityPackages <= 0) {
    return { configured: false, packageCount: safeCount };
  }

  const fillPct = (safeCount / capacityPackages) * 100;
  const remaining = Math.max(0, capacityPackages - safeCount);
  // Tone and the capacity flags are derived from the same rounded value the
  // label renders (`Math.round(fillPct)`), not the raw fillPct above — see
  // the `fillPct` field doc. That is what keeps "the bar says 50% and is
  // amber" or "100% with a Sobrecupo marker vs 100% without one" from ever
  // happening: whatever crosses a threshold is the number on screen.
  const roundedFillPct = Math.round(fillPct);

  return {
    configured: true,
    packageCount: safeCount,
    capacityPackages,
    basis: 'packages',
    fillPct,
    tone: toneForFillPct(roundedFillPct),
    remaining,
    atCapacity: roundedFillPct >= OVER_CAPACITY_THRESHOLD_PCT,
    overCapacity: roundedFillPct > OVER_CAPACITY_THRESHOLD_PCT,
  };
}

/**
 * Tier-0-always-visible drop-count status against a route's optional
 * `max_drops`. Independent of `getVehicleFillStatus` — a route can be
 * evaluated for its drop cap with no capacity data configured at all.
 *
 * max_drops is a hard constraint (Decision 6): phase 4 reads `atCap` to
 * decide whether to offer a top-up drop. A non-finite dropCount (unknown)
 * therefore fails CLOSED — `atCap: true` — rather than falling through the
 * ordinary `>=` comparison, where `NaN >= maxDrops` is always `false` and
 * would silently offer a top-up against a drop count we cannot verify.
 */
export function getMaxDropsStatus(dropCount: number, maxDrops: number | null): MaxDropsStatus {
  if (maxDrops == null || !Number.isFinite(maxDrops) || maxDrops <= 0) {
    const safeCount = Number.isFinite(dropCount) ? Math.max(0, dropCount) : 0;
    return { configured: false, dropCount: safeCount };
  }

  if (!Number.isFinite(dropCount)) {
    // Fail closed on the hard constraint (see doc comment above): report
    // the route as full rather than guessing a count we don't have.
    return { configured: true, dropCount: maxDrops, maxDrops, atCap: true, remaining: 0 };
  }

  const safeCount = Math.max(0, dropCount);

  return {
    configured: true,
    dropCount: safeCount,
    maxDrops,
    atCap: safeCount >= maxDrops,
    remaining: Math.max(0, maxDrops - safeCount),
  };
}
