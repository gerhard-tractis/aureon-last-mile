// src/agents/geocode/resolve.ts — resolves ONE claimed order through cache
// -> provider -> the retry ladder. Extracted out of enrich.ts (which does
// the batch loop and BullMQ wiring) to keep both files under the repo's
// 300-line rule once the fase 5 review's BLOCKER 1/2 fixes added real
// branching here.
import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '../../lib/logger';
import { hashAddress, normaliseStreet, NORMALISATION_VERSION } from '../../lib/geocoding/normalise';
import { lookupGeocodeCache, insertExactGeocodeCache, type OrderGeocodeUpdate } from '../../tools/supabase/geocoding';
import { GeocodingProviderError, type GeocodingProvider } from '../../providers/geocoding/types';
import type { ClaimedOrder } from './claim';
import {
  resolvedUpdate,
  centroidRetryUpdate,
  providerPointRetryUpdate,
  unresolvableNoCoordinatesUpdate,
  transientRetryUpdate,
  centroidDataFaultUpdate,
  type ComunaCentroid,
} from './ladder';
import type { QuotaGuard } from './quota';

export async function lookupComunaCentroid(db: SupabaseClient, comunaId: string): Promise<ComunaCentroid | null> {
  const { data, error } = await db
    .from('chile_comunas')
    .select('centroid_lat, centroid_lng')
    .eq('id', comunaId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.centroid_lat == null || data.centroid_lng == null) return null;
  return { latitude: data.centroid_lat, longitude: data.centroid_lng };
}

export interface ResolveDeps {
  db: SupabaseClient;
  provider: GeocodingProvider;
  quota: QuotaGuard;
  now: Date;
}

// Reason tags for the batch summary's breakdown (review finding 7): a bare
// `providerCalls: 0, fallback: 200` cannot distinguish a missing key from
// an exhausted local quota from an open circuit breaker from every address
// simply coming back coarse. This can.
export type ResolveReason =
  | 'cache_hit'
  | 'exact'
  | 'coarse_or_wrong_comuna'
  | 'uncrosscheckable'
  | 'no_match_centroid'
  | 'unresolvable_no_comuna'
  | 'centroid_data_fault'
  | 'not_configured'
  | 'quota_exhausted'
  | 'credential'
  | 'transport';

export interface ResolveOutcome {
  update: OrderGeocodeUpdate;
  usedProviderCall: boolean;
  cacheHit: boolean;
  reason: ResolveReason;
}

export async function resolveOrder(order: ClaimedOrder, deps: ResolveDeps): Promise<ResolveOutcome> {
  const { db, provider, quota, now } = deps;
  const addressHash = hashAddress(order.delivery_address, order.comuna);

  const cacheRow = await lookupGeocodeCache(db, addressHash, NORMALISATION_VERSION);
  if (cacheRow) {
    return {
      update: resolvedUpdate(
        order,
        cacheRow.latitude,
        cacheRow.longitude,
        cacheRow.geocode_source as 'maptiler' | 'comuna_centroid',
        now,
      ),
      usedProviderCall: false,
      cacheHit: true,
      reason: 'cache_hit',
    };
  }

  const centroid = order.comuna_id ? await lookupComunaCentroid(db, order.comuna_id) : null;

  // Belt and braces: fase 4's provider.isConfigured is the primary guard
  // (checked once per row, cheap sync getter -- no network cost either
  // way), and GeocodingProviderError('not_configured', ...) below is the
  // backstop if a call somehow slips through.
  if (!provider.isConfigured) {
    return {
      update: transientRetryUpdate(order, centroid, 'quota_or_missing_key', now),
      usedProviderCall: false,
      cacheHit: false,
      reason: 'not_configured',
    };
  }

  const allowed = await quota.tryConsume();
  if (!allowed) {
    return {
      update: transientRetryUpdate(order, centroid, 'quota_or_missing_key', now),
      usedProviderCall: false,
      cacheHit: false,
      reason: 'quota_exhausted',
    };
  }

  let result;
  try {
    result = await provider.geocode({
      address: normaliseStreet(order.delivery_address),
      comuna: order.comuna_id ? order.comuna : undefined,
    });
  } catch (err) {
    // The reservation tryConsume() just made did not buy a usable network
    // result -- refund it regardless of which failure this is: a refused
    // credential, a rate limit, a timeout, a malformed response, or the
    // circuit breaker rejecting the call before it ever reached the network
    // are all the same story for the quota counter (BLOCKER 3). Without
    // this, a breaker-open stretch spends the whole monthly cap on zero
    // HTTP calls and freezes every remaining row until next month.
    await quota.refund();

    if (!(err instanceof GeocodingProviderError)) {
      // An unclassified exception is OUR bug (e.g. a TypeError inside the
      // adapter), not a known provider failure mode. Left silent, it would
      // be retried as a plain transport failure every 30 minutes forever
      // with nothing in the logs saying why (review finding 8).
      log('error', 'geocode_unexpected_error', {
        orderId: order.id,
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        update: transientRetryUpdate(order, centroid, 'transport', now),
        usedProviderCall: true,
        cacheHit: false,
        reason: 'transport',
      };
    }

    if (err.type === 'not_configured') {
      return {
        update: transientRetryUpdate(order, centroid, 'quota_or_missing_key', now),
        usedProviderCall: true,
        cacheHit: false,
        reason: 'not_configured',
      };
    }
    if (err.type === 'credential') {
      log('error', 'geocode_credential_refused', { orderId: order.id, message: err.message });
      return {
        update: transientRetryUpdate(order, centroid, 'credential', now),
        usedProviderCall: true,
        cacheHit: false,
        reason: 'credential',
      };
    }
    // rate_limit | timeout | network | api_error -- none of these are
    // evidence about the address (an HTTP 404 from a malformed path lands
    // here as api_error per fase 4, not as a null match).
    return {
      update: transientRetryUpdate(order, centroid, 'transport', now),
      usedProviderCall: true,
      cacheHit: false,
      reason: 'transport',
    };
  }

  if (result === null) {
    if (!order.comuna_id) {
      // The spec's actual terminal case: NO comuna_id AND no provider
      // answer. There is no comuna to try a different centroid from, and
      // the address has already been confirmed "no match" by a
      // deterministic geocoder -- asking again gets the same answer.
      return {
        update: unresolvableNoCoordinatesUpdate(order, now),
        usedProviderCall: true,
        cacheHit: false,
        reason: 'unresolvable_no_comuna',
      };
    }
    if (!centroid) {
      // comuna_id IS set, but chile_comunas has no centroid for it -- a
      // DATA fault (BLOCKER 2), not the business case above. Never
      // terminal: this is not evidence the address is bad, it is evidence
      // the centroid backfill (fase 2) has not landed for this comuna yet,
      // and it self-heals the moment it does.
      log('error', 'geocode_centroid_missing', { orderId: order.id, comunaId: order.comuna_id });
      return {
        update: centroidDataFaultUpdate(order, null, now),
        usedProviderCall: true,
        cacheHit: false,
        reason: 'centroid_data_fault',
      };
    }
    return {
      update: centroidRetryUpdate(order, centroid, now),
      usedProviderCall: true,
      cacheHit: false,
      reason: 'no_match_centroid',
    };
  }

  if (result.matchClass === 'exact') {
    await insertExactGeocodeCache(db, {
      addressHash,
      normalisationVersion: NORMALISATION_VERSION,
      latitude: result.latitude,
      longitude: result.longitude,
      geocodeSource: 'maptiler',
      matchClass: 'exact',
    });
    return {
      update: resolvedUpdate(order, result.latitude, result.longitude, 'maptiler', now),
      usedProviderCall: true,
      cacheHit: false,
      reason: 'exact',
    };
  }

  if (result.matchClass === 'uncrosscheckable') {
    // KEEPS the provider's point -- the opposite disposition from
    // coarse/wrong_comuna below. This is the branch BLOCKER 1 found
    // untested: it must never fall through to centroidRetryUpdate, with or
    // without a comuna_id, with or without a centroid available.
    return {
      update: providerPointRetryUpdate(order, result, now),
      usedProviderCall: true,
      cacheHit: false,
      reason: 'uncrosscheckable',
    };
  }

  // coarse | wrong_comuna -- the adapter's classify() only reaches either of
  // these when a requested comuna was passed in, which fase 5 only ever
  // does when comuna_id is set -- so a centroid SHOULD exist. When it does
  // not, that is the same data fault as the no-match case above: the
  // provider's own (coarse, or wrong-comuna) point is kept rather than
  // discarded for a centroid that does not exist (BLOCKER 2) -- discarding
  // paid information for nothing is worse than an approximate pin during a
  // temporary, self-healing fault.
  if (!centroid) {
    log('error', 'geocode_centroid_missing', { orderId: order.id, comunaId: order.comuna_id });
    return {
      update: centroidDataFaultUpdate(order, result, now),
      usedProviderCall: true,
      cacheHit: false,
      reason: 'centroid_data_fault',
    };
  }
  return {
    update: centroidRetryUpdate(order, centroid, now),
    usedProviderCall: true,
    cacheHit: false,
    reason: 'coarse_or_wrong_comuna',
  };
}
