// src/agents/geocode/ladder.ts — spec-58 fase 5 retry-ladder state machine.
//
// Pure functions: given the outcome of resolving one order (a cache hit, a
// provider match class, or a failure), decide what lands on `orders`. No
// Supabase, no provider, no network call lives here -- see enrich.ts for the
// orchestration that calls these and does the actual reads/writes.
import type { ClaimedOrder } from './claim';
import type { OrderGeocodeUpdate } from '../../tools/supabase/geocoding';

export interface ComunaCentroid {
  latitude: number;
  longitude: number;
}

// "2 attempts exhausted -> unresolvable" in the spec's ladder table.
const MAX_ATTEMPTS = 2;
const RETRY_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const TRANSPORT_RETRY_MS = 30 * 60 * 1000;
const CREDENTIAL_LATCH_MS = 60 * 60 * 1000;

export function startOfNextMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
}

/**
 * A cache hit, or an exact provider match. Always `resolved`, never
 * retried -- "a cache hit is always resolved, because only exact results
 * are ever cached" (Resolution order, fase 5).
 */
export function resolvedUpdate(
  order: ClaimedOrder,
  latitude: number,
  longitude: number,
  source: 'maptiler' | 'comuna_centroid',
  now: Date,
): OrderGeocodeUpdate {
  return {
    latitude,
    longitude,
    geocoded_at: now.toISOString(),
    geocode_source: source,
    geocode_precision: 'exact',
    geocode_status: 'resolved',
    geocode_attempts: order.geocode_attempts,
    geocode_last_attempt_at: now.toISOString(),
    geocode_next_attempt_at: null,
  };
}

/**
 * The "not exact -> centroid" path: a coarse match, a house number matched
 * in the WRONG comuna, or no match at all (when a centroid exists). The
 * requested comuna's centroid is written and any provider point is
 * DISCARDED -- a plausible pin in the wrong region is worse than an
 * honestly vague one (Decision 4). Consumes the attempt budget; the second
 * occurrence lands `unresolvable` holding the same centroid rather than
 * retrying forever.
 *
 * `centroid` is deliberately the only source of coordinates this function
 * can write -- it takes no provider point at all, so a caller cannot wire
 * a wrong_comuna result's own coordinates in here even by mistake. Compare
 * with providerPointRetryUpdate below, which is the mirror case.
 */
export function centroidRetryUpdate(
  order: ClaimedOrder,
  centroid: ComunaCentroid | null,
  now: Date,
): OrderGeocodeUpdate {
  const attempts = order.geocode_attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  const hasCentroid = centroid !== null;

  return {
    latitude: hasCentroid ? centroid.latitude : order.latitude,
    longitude: hasCentroid ? centroid.longitude : order.longitude,
    geocoded_at: hasCentroid ? now.toISOString() : order.geocoded_at,
    geocode_source: hasCentroid ? 'comuna_centroid' : order.geocode_source,
    geocode_precision: hasCentroid ? 'approximate' : order.geocode_precision,
    geocode_status: exhausted ? 'unresolvable' : 'fallback',
    geocode_attempts: attempts,
    geocode_last_attempt_at: now.toISOString(),
    geocode_next_attempt_at: exhausted ? null : new Date(now.getTime() + RETRY_DAYS_MS).toISOString(),
  };
}

/**
 * The `uncrosscheckable` path: a real point the provider returned, but with
 * nothing to check it against (no comuna_id, or context[] carried no
 * municipality.* entry). OPPOSITE disposition from centroidRetryUpdate:
 * KEEPS the provider's point instead of discarding it for a centroid --
 * when the check could not run, the provider's point is the best
 * information anyone has (see the adjacent-rows comment in the spec's
 * ladder table). Same attempt-budget / two-strikes behaviour.
 *
 * Takes a provider point, never a centroid -- structurally the mirror of
 * centroidRetryUpdate, so the two cannot be wired backwards by accident.
 */
export function providerPointRetryUpdate(
  order: ClaimedOrder,
  point: { latitude: number; longitude: number },
  now: Date,
): OrderGeocodeUpdate {
  const attempts = order.geocode_attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;

  return {
    latitude: point.latitude,
    longitude: point.longitude,
    geocoded_at: now.toISOString(),
    geocode_source: 'maptiler',
    geocode_precision: 'approximate',
    geocode_status: exhausted ? 'unresolvable' : 'fallback',
    geocode_attempts: attempts,
    geocode_last_attempt_at: now.toISOString(),
    geocode_next_attempt_at: exhausted ? null : new Date(now.getTime() + RETRY_DAYS_MS).toISOString(),
  };
}

/**
 * No `comuna_id` AND no provider point at all. Terminal NOW, not after two
 * strikes: there is no comuna to try a different centroid from, and the
 * address has already been confirmed "no match" -- a second attempt would
 * ask the same deterministic geocoder the same question. Does not consume
 * the attempt counter; it is simply irrelevant once this row is terminal.
 */
export function unresolvableNoCoordinatesUpdate(order: ClaimedOrder, now: Date): OrderGeocodeUpdate {
  return {
    latitude: null,
    longitude: null,
    geocoded_at: null,
    geocode_source: null,
    geocode_precision: null,
    geocode_status: 'unresolvable',
    geocode_attempts: order.geocode_attempts,
    geocode_last_attempt_at: now.toISOString(),
    geocode_next_attempt_at: null,
  };
}

/**
 * `comuna_id` IS present -- a comuna was resolved for this order -- but the
 * centroid lookup came back empty. That is a DATA fault (chile_comunas
 * lacks centroid data for this row, e.g. fase 2's backfill not yet
 * deployed), not the business case `unresolvableNoCoordinatesUpdate`
 * exists for ("no comuna_id and no provider answer"). Treated as fully
 * transient: never consumes the attempt budget, never terminates, retried
 * soon -- once the data fault is fixed the very next tick resolves it
 * properly. Keeps whatever point IS available (a coarse/wrong_comuna
 * result still returned real coordinates) rather than discarding it for a
 * centroid that does not exist -- discarding paid information for nothing
 * is worse than an approximate pin during a temporary fault.
 */
export function centroidDataFaultUpdate(
  order: ClaimedOrder,
  point: { latitude: number; longitude: number } | null,
  now: Date,
): OrderGeocodeUpdate {
  const hasPoint = point !== null;

  return {
    latitude: hasPoint ? point.latitude : order.latitude,
    longitude: hasPoint ? point.longitude : order.longitude,
    geocoded_at: hasPoint ? now.toISOString() : order.geocoded_at,
    geocode_source: hasPoint ? 'maptiler' : order.geocode_source,
    geocode_precision: hasPoint ? 'approximate' : order.geocode_precision,
    geocode_status: 'fallback',
    geocode_attempts: order.geocode_attempts,
    geocode_last_attempt_at: now.toISOString(),
    geocode_next_attempt_at: new Date(now.getTime() + TRANSPORT_RETRY_MS).toISOString(),
  };
}

export type TransientReason = 'transport' | 'credential' | 'quota_or_missing_key';

/**
 * Transport failure (circuit-breaker open, 429, timeout, network,
 * api_error), a refused credential, an exhausted monthly quota, or a
 * missing API key -- none of these are evidence about the address, so NONE
 * consume the attempt budget, and none ever terminate the order
 * (Decision 4: never permanently fail an order). Each still writes the
 * requested comuna's centroid when one is available, so the order is not
 * left blank on the map while retries continue; when no centroid exists
 * yet (no comuna_id), the existing coordinates -- almost always NULL -- are
 * left untouched rather than invented.
 */
export function transientRetryUpdate(
  order: ClaimedOrder,
  centroid: ComunaCentroid | null,
  reason: TransientReason,
  now: Date,
): OrderGeocodeUpdate {
  const hasCentroid = centroid !== null;
  const next =
    reason === 'transport'
      ? new Date(now.getTime() + TRANSPORT_RETRY_MS)
      : reason === 'credential'
        ? new Date(now.getTime() + CREDENTIAL_LATCH_MS)
        : startOfNextMonth(now);

  return {
    latitude: hasCentroid ? centroid.latitude : order.latitude,
    longitude: hasCentroid ? centroid.longitude : order.longitude,
    geocoded_at: hasCentroid ? now.toISOString() : order.geocoded_at,
    geocode_source: hasCentroid ? 'comuna_centroid' : order.geocode_source,
    geocode_precision: hasCentroid ? 'approximate' : order.geocode_precision,
    geocode_status: 'fallback',
    geocode_attempts: order.geocode_attempts,
    geocode_last_attempt_at: now.toISOString(),
    geocode_next_attempt_at: next.toISOString(),
  };
}
