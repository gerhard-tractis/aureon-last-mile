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

/**
 * Review round 2, B1: a blank cutoff is not "configured but blank" — it is
 * absent, same as NULL. `'' ?? windowEnd` does NOT fall through ('' is not
 * nullish), which put a fully-populated window behind a blank cutoff field
 * into `sin_datos` while the label still showed the real range — the
 * semaphore contradicting the text right next to it. Whitespace-only counts
 * as blank too (a stray space typed into the admin form, not a value).
 */
function nonBlank(value: string | null | undefined): string | undefined {
  return value != null && value.trim().length > 0 ? value : undefined;
}

/**
 * Parses "HH:MM" (optionally "HH:MM:SS" — the natural text shape of a
 * Postgres TIME column, e.g. data populated directly via SQL/backfill/QA
 * seed rather than through this UI's own form, which always saves "HH:MM").
 * Anything else is unusable. NOTE: anchors to `now`'s LOCAL timezone — a
 * browser running in a different zone than the pickup point's real location
 * (e.g. a laptop set to UTC dispatching for Santiago) will compute a
 * shifted close time. Neither `operating_hours` nor `pickup_cutoff_time`
 * carry a zone today; fixing this needs a product decision on which zone
 * wins, not a code change here.
 */
function parseTimeToday(time: string, now: Date): Date | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(time);
  if (!match) return null;
  const result = new Date(now);
  result.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return result;
}

/**
 * The cutoff (`sla_config.pickup_cutoff_time`) is the operator-wide "no more
 * pickups after this" line — stricter than a single point's own window, so
 * it wins when both are configured (and actually non-blank).
 */
function resolveCloseTime(input: PickupWindowInput, now: Date): Date | null {
  const raw = nonBlank(input.pickupCutoffTime) ?? nonBlank(input.pickupWindowEnd);
  if (!raw) return null;
  return parseTimeToday(raw, now);
}

/**
 * Review round 2 (declared, not fixed here — it's a product decision, not a
 * bug): a window that closed hours ago (e.g. checking at 23:00 against a
 * 13:00 close) still reports `cerca_del_cierre`, the SAME state as "closing
 * within the hour". There is no fourth "ya cerró" state. Whether a long-past
 * window should read differently from an imminent one is a call for
 * whoever owns this screen, not something to guess at here — both are, at
 * minimum, "act now", which `cerca_del_cierre` already conveys honestly.
 */
export function getPickupWindowStatus(input: PickupWindowInput, now: Date = new Date()): PickupWindowStatus {
  const closeTime = resolveCloseTime(input, now);
  if (!closeTime) return 'sin_datos';

  const minutesRemaining = (closeTime.getTime() - now.getTime()) / 60_000;
  return minutesRemaining <= CLOSING_SOON_THRESHOLD_MINUTES ? 'cerca_del_cierre' : 'dentro_de_plazo';
}

export function formatPickupWindowLabel(input: PickupWindowInput): string {
  const start = nonBlank(input.pickupWindowStart);
  const end = nonBlank(input.pickupWindowEnd);
  if (start && end) {
    return `${start}–${end}`;
  }
  const cutoff = nonBlank(input.pickupCutoffTime);
  if (cutoff) {
    return `Cierra ${cutoff}`;
  }
  return 'Sin datos';
}
