// src/agents/geocode/enrich.ts — the geocode.enrich job: claims a batch of
// orders due for geocoding and resolves each through the retry ladder in
// ladder.ts. spec-58 fase 5.
//
// Resolution order (spec-58 fase 5, "Resolution order"):
//   1. geocode_cache hit -> resolved, no network call.
//   2. MapTiler -> exact caches; coarse/wrong_comuna/null/uncrosscheckable
//      do not.
//   3. Comuna centroid, when nothing above answers with a usable point.
import type { Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Redis from 'ioredis';
import { log } from '../../lib/logger';
import { hashAddress, normaliseStreet, NORMALISATION_VERSION } from '../../lib/geocoding/normalise';
import {
  lookupGeocodeCache,
  insertExactGeocodeCache,
  updateOrderGeocode,
  type OrderGeocodeUpdate,
} from '../../tools/supabase/geocoding';
import { GeocodingProviderError, type GeocodingProvider } from '../../providers/geocoding/types';
import { claimGeocodeBatch, type ClaimedOrder } from './claim';
import {
  resolvedUpdate,
  centroidRetryUpdate,
  providerPointRetryUpdate,
  unresolvableNoCoordinatesUpdate,
  transientRetryUpdate,
  type ComunaCentroid,
} from './ladder';
import { createQuotaGuard, type QuotaGuard } from './quota';

const BATCH_LIMIT = 200;

export interface GeocodeBatchSummary {
  claimed: number;
  resolved: number;
  fallback: number;
  unresolvable: number;
  providerCalls: number;
  cacheHits: number;
}

async function lookupComunaCentroid(db: SupabaseClient, comunaId: string): Promise<ComunaCentroid | null> {
  const { data, error } = await db
    .from('chile_comunas')
    .select('centroid_lat, centroid_lng')
    .eq('id', comunaId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.centroid_lat == null || data.centroid_lng == null) return null;
  return { latitude: data.centroid_lat, longitude: data.centroid_lng };
}

interface ResolveDeps {
  db: SupabaseClient;
  provider: GeocodingProvider;
  quota: QuotaGuard;
  now: Date;
}

interface ResolveOutcome {
  update: OrderGeocodeUpdate;
  usedProviderCall: boolean;
  cacheHit: boolean;
}

async function resolveOrder(order: ClaimedOrder, deps: ResolveDeps): Promise<ResolveOutcome> {
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
    };
  }

  const allowed = await quota.tryConsume();
  if (!allowed) {
    return {
      update: transientRetryUpdate(order, centroid, 'quota_or_missing_key', now),
      usedProviderCall: false,
      cacheHit: false,
    };
  }

  let result;
  try {
    result = await provider.geocode({
      address: normaliseStreet(order.delivery_address),
      comuna: order.comuna_id ? order.comuna : undefined,
    });
  } catch (err) {
    const type = err instanceof GeocodingProviderError ? err.type : 'network';

    if (type === 'not_configured') {
      return {
        update: transientRetryUpdate(order, centroid, 'quota_or_missing_key', now),
        usedProviderCall: true,
        cacheHit: false,
      };
    }
    if (type === 'credential') {
      log('error', 'geocode_credential_refused', {
        orderId: order.id,
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        update: transientRetryUpdate(order, centroid, 'credential', now),
        usedProviderCall: true,
        cacheHit: false,
      };
    }
    // rate_limit | timeout | network | api_error -- none of these are
    // evidence about the address (an HTTP 404 from a malformed path lands
    // here as api_error per fase 4, not as a null match).
    return {
      update: transientRetryUpdate(order, centroid, 'transport', now),
      usedProviderCall: true,
      cacheHit: false,
    };
  }

  if (result === null) {
    if (!centroid) {
      return { update: unresolvableNoCoordinatesUpdate(order, now), usedProviderCall: true, cacheHit: false };
    }
    return { update: centroidRetryUpdate(order, centroid, now), usedProviderCall: true, cacheHit: false };
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
    };
  }

  if (result.matchClass === 'uncrosscheckable') {
    return { update: providerPointRetryUpdate(order, result, now), usedProviderCall: true, cacheHit: false };
  }

  // coarse | wrong_comuna -- the adapter's classify() only reaches either of
  // these when a requested comuna was passed in, which fase 5 only ever
  // does when comuna_id is set -- so centroid is guaranteed non-null here.
  return { update: centroidRetryUpdate(order, centroid, now), usedProviderCall: true, cacheHit: false };
}

export interface RunBatchDeps {
  db: SupabaseClient;
  provider: GeocodingProvider;
  redis: Redis | null;
  monthlyQuota?: number;
  now?: () => Date;
  batchLimit?: number;
}

export async function runGeocodeEnrichBatch(deps: RunBatchDeps): Promise<GeocodeBatchSummary> {
  const nowFn = deps.now ?? (() => new Date());
  const quota = createQuotaGuard(deps.redis, deps.monthlyQuota, nowFn);
  const orders = await claimGeocodeBatch(deps.db, deps.batchLimit ?? BATCH_LIMIT);

  const summary: GeocodeBatchSummary = {
    claimed: orders.length,
    resolved: 0,
    fallback: 0,
    unresolvable: 0,
    providerCalls: 0,
    cacheHits: 0,
  };

  for (const order of orders) {
    const { update, usedProviderCall, cacheHit } = await resolveOrder(order, {
      db: deps.db,
      provider: deps.provider,
      quota,
      now: nowFn(),
    });

    await updateOrderGeocode(deps.db, order.id, order.operator_id, update);

    if (usedProviderCall) summary.providerCalls += 1;
    if (cacheHit) summary.cacheHits += 1;
    if (update.geocode_status === 'resolved') summary.resolved += 1;
    else if (update.geocode_status === 'fallback') summary.fallback += 1;
    else if (update.geocode_status === 'unresolvable') summary.unresolvable += 1;
  }

  log('info', 'geocode_batch_complete', { ...summary });
  return summary;
}

export function createGeocodeEnrichHandler(
  db: SupabaseClient,
  provider: GeocodingProvider,
  redis: Redis | null,
  monthlyQuota?: number,
): (job: Job) => Promise<void> {
  return async (_job: Job): Promise<void> => {
    await runGeocodeEnrichBatch({ db, provider, redis, monthlyQuota });
  };
}
