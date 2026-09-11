// src/agents/geocode/enrich.ts — the geocode.enrich job: claims a batch of
// orders due for geocoding and resolves each through the retry ladder.
// spec-58 fase 5. Per-row resolution logic lives in resolve.ts; this file
// is the batch loop, the summary, and the BullMQ handler factory.
import type { Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Redis from 'ioredis';
import { log } from '../../lib/logger';
import { updateOrderGeocode } from '../../tools/supabase/geocoding';
import type { GeocodingProvider } from '../../providers/geocoding/types';
import { claimGeocodeBatch } from './claim';
import { resolveOrder, type ResolveReason } from './resolve';
import { createQuotaGuard } from './quota';

const BATCH_LIMIT = 200;

export interface GeocodeBatchSummary {
  claimed: number;
  resolved: number;
  fallback: number;
  unresolvable: number;
  providerCalls: number;
  cacheHits: number;
  // A row whose write itself failed (e.g. updateOrderGeocode threw) --
  // review finding 4: one bad row must not silence the whole run's log.
  errors: number;
  // Breakdown by ResolveReason (review finding 7): distinguishes a missing
  // key from an exhausted local quota from an open circuit breaker from
  // every address simply coming back coarse, which the totals above
  // cannot.
  reasons: Partial<Record<ResolveReason, number>>;
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
    errors: 0,
    reasons: {},
  };

  try {
    for (const order of orders) {
      try {
        const { update, usedProviderCall, cacheHit, reason } = await resolveOrder(order, {
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
        summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1;
      } catch (err) {
        // A single row's own failure (e.g. the orders UPDATE itself threw)
        // must not abort the rest of the batch, and must not suppress this
        // run's summary log -- the log is the only thing the QA step for
        // this phase reads (review finding 4).
        summary.errors += 1;
        log('error', 'geocode_row_failed', {
          orderId: order.id,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    log('info', 'geocode_batch_complete', { ...summary, reasons: { ...summary.reasons } });
  }

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
