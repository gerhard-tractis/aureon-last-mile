// src/tools/supabase/geocoding.ts — geocode_cache reads/writes and the
// `orders` geocode-column update, spec-58 fase 3.
//
// No network call to any geocoding provider lives here (that is fase 4) --
// this is pure Supabase read/write, exercised offline against a mocked
// client.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface GeocodeCacheRow {
  id: string;
  address_hash: string;
  normalisation_version: number;
  latitude: number;
  longitude: number;
  geocode_source: string;
  geocode_precision: string;
  hit_count: number;
  last_used_at: string | null;
  [key: string]: unknown;
}

/**
 * Cache lookup by (address_hash, normalisation_version). A hit bumps
 * `hit_count` and `last_used_at` and returns the row; a miss returns null
 * without writing anything.
 */
export async function lookupGeocodeCache(
  db: SupabaseClient,
  addressHash: string,
  normalisationVersion: number,
): Promise<GeocodeCacheRow | null> {
  const { data, error } = await db
    .from('geocode_cache')
    .select('*')
    .eq('address_hash', addressHash)
    .eq('normalisation_version', normalisationVersion)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as GeocodeCacheRow;

  const { error: updateError } = await db
    .from('geocode_cache')
    .update({ hit_count: row.hit_count + 1, last_used_at: new Date().toISOString() })
    .eq('id', row.id);

  if (updateError) throw new Error(updateError.message);

  return row;
}

export interface ExactGeocodeCacheEntry {
  addressHash: string;
  normalisationVersion: number;
  latitude: number;
  longitude: number;
  geocodeSource: string;
  // Narrowed to the literal 'exact' at the type level so a caller cannot
  // pass a coarse result by accident -- freezing an unverified point into
  // the cache is the one thing spec-58 says it cannot cheaply undo, there
  // being no purge procedure. The runtime check below is the same rule
  // enforced for a caller that bypasses the type (e.g. from plain JS).
  matchClass: 'exact';
}

/**
 * Writes a cache row. Only ever called with an `exact` match — a coarse or
 * centroid result must never be cached (spec-58 fase 3 / "Resolution
 * order"), because caching it would short-circuit the retry the state
 * machine promises.
 */
export async function insertExactGeocodeCache(
  db: SupabaseClient,
  entry: ExactGeocodeCacheEntry,
): Promise<void> {
  if (entry.matchClass !== 'exact') {
    throw new Error('geocode_cache only accepts exact matches; refusing to cache a non-exact result');
  }

  const { error } = await db.from('geocode_cache').insert({
    address_hash: entry.addressHash,
    normalisation_version: entry.normalisationVersion,
    latitude: entry.latitude,
    longitude: entry.longitude,
    geocode_source: entry.geocodeSource,
    geocode_precision: 'exact',
  });

  if (error) throw new Error(error.message);
}

export interface OrderGeocodeUpdate {
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  geocode_source: string | null;
  geocode_precision: string | null;
  geocode_status: string;
  geocode_attempts: number;
  geocode_last_attempt_at: string | null;
  geocode_next_attempt_at: string | null;
}

/**
 * Writes the geocode result columns back onto `orders`, scoped by both id
 * and operator_id (non-negotiable: operator_id on every query).
 */
export async function updateOrderGeocode(
  db: SupabaseClient,
  orderId: string,
  operatorId: string,
  update: OrderGeocodeUpdate,
): Promise<void> {
  const { error } = await db
    .from('orders')
    .update(update)
    .eq('id', orderId)
    .eq('operator_id', operatorId);

  if (error) throw new Error(error.message);
}
