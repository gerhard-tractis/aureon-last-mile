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
  // geocode_precision on this table is really always 'exact' (only exact
  // results are ever cached, and insertExactGeocodeCache/the migration's
  // CHECK both enforce it) -- kept as `string` rather than the narrower
  // literal union `orders.geocode_precision` uses, since a row read back
  // from the DB should not be typed more strictly than the column itself.
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
 *
 * Uses upsert with `ignoreDuplicates` rather than a plain insert: fase 5
 * can process two orders sharing an address_hash (Decision 3's own
 * example — depto 42 and depto 7 in the same building) in one batch, both
 * missing the cache and both geocoding before either write lands. A plain
 * insert would throw an opaque 23505 on the second write, which fase 5
 * cannot tell apart from a real failure; ignoreDuplicates makes "already
 * cached by a sibling in this batch" a silent no-op instead.
 */
export async function insertExactGeocodeCache(
  db: SupabaseClient,
  entry: ExactGeocodeCacheEntry,
): Promise<void> {
  if (entry.matchClass !== 'exact') {
    throw new Error('geocode_cache only accepts exact matches; refusing to cache a non-exact result');
  }

  const { error } = await db.from('geocode_cache').upsert(
    {
      address_hash: entry.addressHash,
      normalisation_version: entry.normalisationVersion,
      latitude: entry.latitude,
      longitude: entry.longitude,
      geocode_source: entry.geocodeSource,
      geocode_precision: 'exact',
    },
    { onConflict: 'address_hash,normalisation_version', ignoreDuplicates: true },
  );

  if (error) throw new Error(error.message);
}

// Literal unions, not bare `string` -- `'resolvd'` compiling and dying at
// runtime is the same rigour `matchClass` already gets above.
// geocode_precision and geocode_status are backed by real CHECK
// constraints (orders_geocode_precision_check / orders_geocode_status_check,
// 20261010000001). geocode_source is NOT -- fase 1 left it as a column
// comment only ('maptiler' | 'comuna_centroid', 20261010000001:17), no
// CHECK -- so this union is a TS-only guard with no DB-side backup; a
// direct SQL write (or a future migration adding a constraint with
// different values) would not be caught here.
export interface OrderGeocodeUpdate {
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  geocode_source: 'maptiler' | 'comuna_centroid' | null;
  geocode_precision: 'exact' | 'approximate' | null;
  geocode_status: 'pending' | 'resolved' | 'fallback' | 'unresolvable';
  geocode_attempts: number;
  geocode_last_attempt_at: string | null;
  geocode_next_attempt_at: string | null;
}

/**
 * Writes the geocode result columns back onto `orders`, scoped by both id
 * and operator_id (non-negotiable: operator_id on every query).
 *
 * `.select().single()` is load-bearing, not decoration: a PostgREST UPDATE
 * matching zero rows returns `error: null` by default. Without forcing a
 * row back, a mismatched operator_id or a soft-deleted order would leave
 * the worker believing the write succeeded while the row stays
 * `pending`/`attempts=0` forever — silently re-claimed by
 * idx_orders_geocode_queue on every run. Same fix orders.ts already uses
 * for updateOrderStatus.
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
    .eq('operator_id', operatorId)
    .select()
    .single();

  if (error) throw new Error(error.message);
}
