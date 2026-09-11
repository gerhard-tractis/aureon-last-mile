// src/agents/geocode/claim.ts — claim_geocode_batch RPC wrapper, spec-58 fase 5.
//
// The claim query needs `FOR UPDATE SKIP LOCKED`, which PostgREST cannot
// express through a plain `.select()` -- there is no locking clause on the
// query builder. It has to live behind a Postgres function the worker calls
// via `.rpc()`. That function is
// packages/database/supabase/migrations/<ts>_spec58_fase5_claim_geocode_batch.sql
// -- not listed in fase 5's own **Archivos:**, added because the phase's
// own text ("FOR UPDATE SKIP LOCKED is not optional") cannot be honoured
// without it. See that migration's header for why it also leases the claimed
// rows (bumps geocode_next_attempt_at) inside the same atomic statement,
// rather than relying on the FOR UPDATE lock alone to protect the batch for
// this run's actual network-bound processing time.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClaimedOrder {
  id: string;
  operator_id: string;
  delivery_address: string;
  comuna: string;
  comuna_id: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  geocode_source: 'maptiler' | 'comuna_centroid' | null;
  geocode_precision: 'exact' | 'approximate' | null;
  geocode_status: string;
  geocode_attempts: number;
  geocode_last_attempt_at: string | null;
  geocode_next_attempt_at: string | null;
  [key: string]: unknown;
}

export const DEFAULT_BATCH_LIMIT = 200;
export const DEFAULT_LEASE_MINUTES = 10;

/**
 * Atomically claims up to `limit` orders due for geocoding, leasing them for
 * `leaseMinutes` so a second concurrent run (an overlapping cron tick, or a
 * BullMQ retry -- the queue is configured `attempts: 3`) cannot re-select
 * the same rows and pay the provider for them twice.
 */
export async function claimGeocodeBatch(
  db: SupabaseClient,
  limit: number = DEFAULT_BATCH_LIMIT,
  leaseMinutes: number = DEFAULT_LEASE_MINUTES,
): Promise<ClaimedOrder[]> {
  const { data, error } = await db.rpc('claim_geocode_batch', {
    p_limit: limit,
    p_lease_minutes: leaseMinutes,
  });

  if (error) throw new Error(error.message);
  return (data ?? []) as ClaimedOrder[];
}
