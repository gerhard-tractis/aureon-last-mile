// src/tools/supabase/geocoding.test.ts
import { describe, it, expect, vi } from 'vitest';
import { lookupGeocodeCache, insertExactGeocodeCache, updateOrderGeocode } from './geocoding';

function makeCacheDb(opts: {
  found: unknown;
  selectError?: unknown;
  updateError?: unknown;
}) {
  const selectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.found, error: opts.selectError ?? null }),
  };
  const updateChain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: opts.updateError ?? null }),
  };
  let calls = 0;
  const from = vi.fn().mockImplementation(() => {
    calls += 1;
    return calls === 1 ? selectChain : updateChain;
  });
  return { from, selectChain, updateChain };
}

describe('lookupGeocodeCache', () => {
  it('returns null on a cache miss without attempting an update', async () => {
    const db = makeCacheDb({ found: null });
    const result = await lookupGeocodeCache(db as never, 'hash-1', 1);
    expect(result).toBeNull();
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it('returns the cached row on a hit', async () => {
    const row = {
      id: 'cache-1',
      address_hash: 'hash-1',
      normalisation_version: 1,
      latitude: -33.44,
      longitude: -70.65,
      geocode_source: 'maptiler',
      geocode_precision: 'exact',
      hit_count: 3,
      last_used_at: null,
    };
    const db = makeCacheDb({ found: row });
    const result = await lookupGeocodeCache(db as never, 'hash-1', 1);
    expect(result).toMatchObject({ id: 'cache-1', latitude: -33.44 });
  });

  it('bumps hit_count and last_used_at on a hit', async () => {
    const row = {
      id: 'cache-1',
      address_hash: 'hash-1',
      normalisation_version: 1,
      latitude: -33.44,
      longitude: -70.65,
      geocode_source: 'maptiler',
      geocode_precision: 'exact',
      hit_count: 3,
      last_used_at: null,
    };
    const db = makeCacheDb({ found: row });
    await lookupGeocodeCache(db as never, 'hash-1', 1);

    expect(db.updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ hit_count: 4, last_used_at: expect.any(String) }),
    );
    expect(db.updateChain.eq).toHaveBeenCalledWith('id', 'cache-1');
  });

  it('queries by both address_hash and normalisation_version', async () => {
    const db = makeCacheDb({ found: null });
    await lookupGeocodeCache(db as never, 'hash-1', 2);
    expect(db.selectChain.eq).toHaveBeenNthCalledWith(1, 'address_hash', 'hash-1');
    expect(db.selectChain.eq).toHaveBeenNthCalledWith(2, 'normalisation_version', 2);
  });

  it('throws on a select error', async () => {
    const db = makeCacheDb({ found: null, selectError: { message: 'boom' } });
    await expect(lookupGeocodeCache(db as never, 'hash-1', 1)).rejects.toThrow('boom');
  });
});

function makeInsertDb(error: unknown = null) {
  const chain = { insert: vi.fn().mockResolvedValue({ data: null, error }) };
  return { from: vi.fn().mockReturnValue(chain), chain };
}

describe('insertExactGeocodeCache', () => {
  it('inserts an exact result into geocode_cache', async () => {
    const db = makeInsertDb();
    await insertExactGeocodeCache(db as never, {
      addressHash: 'hash-1',
      normalisationVersion: 1,
      latitude: -33.44,
      longitude: -70.65,
      geocodeSource: 'maptiler',
      matchClass: 'exact',
    });
    expect(db.from).toHaveBeenCalledWith('geocode_cache');
    expect(db.chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        address_hash: 'hash-1',
        normalisation_version: 1,
        geocode_precision: 'exact',
        geocode_source: 'maptiler',
      }),
    );
  });

  it('refuses to write a non-exact result, without calling the database', async () => {
    const db = makeInsertDb();
    await expect(
      insertExactGeocodeCache(db as never, {
        addressHash: 'hash-1',
        normalisationVersion: 1,
        latitude: -33.44,
        longitude: -70.65,
        geocodeSource: 'comuna_centroid',
        // @ts-expect-error -- exercising the runtime guard against a caller that bypasses the type
        matchClass: 'approximate',
      }),
    ).rejects.toThrow(/exact/i);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('throws on a Supabase insert error', async () => {
    const db = makeInsertDb({ message: 'unique violation' });
    await expect(
      insertExactGeocodeCache(db as never, {
        addressHash: 'hash-1',
        normalisationVersion: 1,
        latitude: -33.44,
        longitude: -70.65,
        geocodeSource: 'maptiler',
        matchClass: 'exact',
      }),
    ).rejects.toThrow('unique violation');
  });
});

function makeOrderUpdateDb(error: unknown = null) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  };
  // Final `.eq()` in the real chain resolves the query; make the last mock
  // call resolve instead of chain further.
  chain.eq = vi
    .fn()
    .mockReturnValueOnce(chain)
    .mockResolvedValueOnce({ data: null, error });
  return { from: vi.fn().mockReturnValue(chain), chain };
}

describe('updateOrderGeocode', () => {
  it('updates the order scoped by both id and operator_id', async () => {
    const db = makeOrderUpdateDb();
    await updateOrderGeocode(db as never, 'order-1', 'op-1', {
      latitude: -33.44,
      longitude: -70.65,
      geocoded_at: '2026-09-11T00:00:00.000Z',
      geocode_source: 'maptiler',
      geocode_precision: 'exact',
      geocode_status: 'resolved',
      geocode_attempts: 0,
      geocode_last_attempt_at: '2026-09-11T00:00:00.000Z',
      geocode_next_attempt_at: null,
    });
    expect(db.from).toHaveBeenCalledWith('orders');
    expect(db.chain.eq).toHaveBeenNthCalledWith(1, 'id', 'order-1');
    expect(db.chain.eq).toHaveBeenNthCalledWith(2, 'operator_id', 'op-1');
  });

  it('throws on a Supabase update error', async () => {
    const db = makeOrderUpdateDb({ message: 'row not found' });
    await expect(
      updateOrderGeocode(db as never, 'order-1', 'op-1', {
        latitude: null,
        longitude: null,
        geocoded_at: null,
        geocode_source: null,
        geocode_precision: null,
        geocode_status: 'pending',
        geocode_attempts: 0,
        geocode_last_attempt_at: null,
        geocode_next_attempt_at: null,
      }),
    ).rejects.toThrow('row not found');
  });
});
