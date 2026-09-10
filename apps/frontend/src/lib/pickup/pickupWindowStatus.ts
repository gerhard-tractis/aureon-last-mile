/**
 * spec-83 fase 2 — pickup window semaphore, pure logic.
 *
 * "I don't know" is not "there's plenty of time". Today no pickup point has
 * `operating_hours`/`sla_config.pickup_cutoff_time` configured, so this must
 * default to `sin_datos`, not `dentro_de_plazo` — a green light over an
 * absent deadline is a false claim, not a missing one.
 */

export type PickupWindowStatus = 'sin_datos' | 'dentro_de_plazo' | 'cerca_del_cierre';

export interface PickupWindowInput {
  pickupWindowStart?: string | null;
  pickupWindowEnd?: string | null;
  pickupCutoffTime?: string | null;
}

/** Minutes before the close time at which the semaphore turns amber. */
const CLOSING_SOON_THRESHOLD_MINUTES = 60;

/** Parses "HH:MM" onto `now`'s calendar day. Anything else is unusable. */
function parseTimeToday(time: string, now: Date): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  const result = new Date(now);
  result.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return result;
}

/**
 * The cutoff (`sla_config.pickup_cutoff_time`) is the operator-wide "no more
 * pickups after this" line — stricter than a single point's own window, so
 * it wins when both are configured.
 */
function resolveCloseTime(input: PickupWindowInput, now: Date): Date | null {
  const raw = input.pickupCutoffTime ?? input.pickupWindowEnd;
  if (!raw) return null;
  return parseTimeToday(raw, now);
}

export function getPickupWindowStatus(input: PickupWindowInput, now: Date = new Date()): PickupWindowStatus {
  const closeTime = resolveCloseTime(input, now);
  if (!closeTime) return 'sin_datos';

  const minutesRemaining = (closeTime.getTime() - now.getTime()) / 60_000;
  return minutesRemaining <= CLOSING_SOON_THRESHOLD_MINUTES ? 'cerca_del_cierre' : 'dentro_de_plazo';
}

export function formatPickupWindowLabel(input: PickupWindowInput): string {
  if (input.pickupWindowStart && input.pickupWindowEnd) {
    return `${input.pickupWindowStart}–${input.pickupWindowEnd}`;
  }
  if (input.pickupCutoffTime) {
    return `Cierra ${input.pickupCutoffTime}`;
  }
  return 'Sin datos';
}
