// src/agents/geocode/enrich.test.ts — spec-58 fase 5: the geocode.enrich
// batch orchestration, exercised against mocked Supabase/provider/quota/
// redis. The state-machine logic itself is tested directly in ladder.test.ts;
// this file exercises the WIRING -- resolution order, cache writes, which
// centroid gets looked up, and the batch summary.
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { GeocodingProviderError, type GeocodingProvider, type GeocodeResult } from '../../providers/geocoding/types';
import { runGeocodeEnrichBatch } from './enrich';
import type { ClaimedOrder } from './claim';

function makeOrder(overrides: Partial<ClaimedOrder> = {}): ClaimedOrder {
  return {
    id: 'order-1',
    operator_id: 'op-1',
    delivery_address: 'Los Militares 5620',
    comuna: 'Las Condes',
    comuna_id: 'comuna-las-condes',
    latitude: null,
    longitude: null,
    geocoded_at: null,
    geocode_source: null,
    geocode_precision: null,
    geocode_status: 'pending',
    geocode_attempts: 0,
    geocode_last_attempt_at: null,
    geocode_next_attempt_at: null,
    ...overrides,
  };
}

interface DbMockOptions {
  claimed: ClaimedOrder[];
  cacheRow?: { id: string; latitude: number; longitude: number; geocode_source: string; hit_count: number } | null;
  centroid?: { centroid_lat: number; centroid_lng: number } | null;
}

function makeDb(opts: DbMockOptions) {
  const updateOrderCalls: unknown[] = [];
  const cacheInsertCalls: unknown[] = [];

  const db = {
    rpc: vi.fn().mockResolvedValue({ data: opts.claimed, error: null }),
    from: vi.fn((table: string) => {
      if (table === 'geocode_cache') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.cacheRow ?? null, error: null }),
              }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          upsert: (payload: unknown) => {
            cacheInsertCalls.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'chile_comunas') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.centroid ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === 'orders') {
        return {
          update: (payload: unknown) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => {
                    updateOrderCalls.push(payload);
                    return { data: {}, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };

  return { db: db as unknown as SupabaseClient, updateOrderCalls, cacheInsertCalls };
}

function makeProvider(overrides: Partial<GeocodingProvider> = {}): GeocodingProvider {
  return {
    name: 'maptiler',
    isConfigured: true,
    geocode: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const NOW = new Date('2026-09-11T12:00:00.000Z');

describe('runGeocodeEnrichBatch — cache hit', () => {
  it('resolves from cache without calling the provider', async () => {
    const order = makeOrder();
    const geocodeSpy = vi.fn();
    const { db, updateOrderCalls } = makeDb({
      claimed: [order],
      cacheRow: { id: 'cache-1', latitude: -33.4, longitude: -70.6, geocode_source: 'maptiler', hit_count: 0 },
    });
    const provider = makeProvider({ geocode: geocodeSpy });

    const summary = await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(geocodeSpy).not.toHaveBeenCalled();
    expect(summary.cacheHits).toBe(1);
    expect(summary.resolved).toBe(1);
    expect(updateOrderCalls[0]).toMatchObject({ geocode_status: 'resolved', latitude: -33.4, longitude: -70.6 });
  });
});

describe('runGeocodeEnrichBatch — exact match', () => {
  it('writes the cache and resolves the order', async () => {
    const order = makeOrder();
    const result: GeocodeResult = {
      latitude: -33.41,
      longitude: -70.57,
      matchClass: 'exact',
      precision: 'exact',
      source: 'maptiler',
    };
    const { db, updateOrderCalls, cacheInsertCalls } = makeDb({ claimed: [order], cacheRow: null });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(result) });

    const summary = await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(cacheInsertCalls).toHaveLength(1);
    expect(summary.resolved).toBe(1);
    expect(updateOrderCalls[0]).toMatchObject({ geocode_status: 'resolved', geocode_precision: 'exact' });
  });

  it('sends the NORMALISED street text to the provider, not the raw address', async () => {
    const order = makeOrder({ delivery_address: 'Av. Providencia 1234' });
    const { db } = makeDb({ claimed: [order], cacheRow: null });
    const geocodeSpy = vi.fn().mockResolvedValue(null);
    const provider = makeProvider({ geocode: geocodeSpy });

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(geocodeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'avenida providencia 1234' }),
    );
  });
});

describe('runGeocodeEnrichBatch — coarse / wrong_comuna -> centroid, discarding the provider point', () => {
  it('coarse match writes the centroid, not the provider point', async () => {
    const order = makeOrder();
    const result: GeocodeResult = {
      latitude: -39.8,
      longitude: -73.2,
      matchClass: 'coarse',
      precision: 'approximate',
      source: 'maptiler',
    };
    const { db, updateOrderCalls } = makeDb({
      claimed: [order],
      cacheRow: null,
      centroid: { centroid_lat: -33.4, centroid_lng: -70.6 },
    });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(result) });

    const summary = await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(summary.fallback).toBe(1);
    expect(updateOrderCalls[0]).toMatchObject({
      geocode_status: 'fallback',
      latitude: -33.4,
      longitude: -70.6,
      geocode_source: 'comuna_centroid',
    });
  });
});

describe('runGeocodeEnrichBatch — uncrosscheckable keeps the provider point', () => {
  it('does not look up (or use) a centroid at all', async () => {
    const order = makeOrder({ comuna_id: null });
    const result: GeocodeResult = {
      latitude: -12.3,
      longitude: -45.6,
      matchClass: 'uncrosscheckable',
      precision: 'approximate',
      source: 'maptiler',
    };
    const { db, updateOrderCalls } = makeDb({ claimed: [order], cacheRow: null });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(result) });

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(updateOrderCalls[0]).toMatchObject({
      latitude: -12.3,
      longitude: -45.6,
      geocode_source: 'maptiler',
      geocode_status: 'fallback',
    });
  });

  // BLOCKER 1 (review): this is the discriminating case grep found
  // untested. Fase 0 measured a SECOND uncrosscheckable shape -- comuna_id
  // IS set, context[] simply carried no municipality.* entry -- where a
  // centroid IS available. The centroid being available is exactly what
  // makes this test able to tell "kept the provider's point" apart from
  // "silently swapped it for the centroid" (both branches would otherwise
  // look identical when comuna_id is null and no centroid exists at all).
  it('with a comuna_id AND a centroid available, still keeps the provider point, not the centroid', async () => {
    const order = makeOrder({ comuna_id: 'comuna-las-condes' });
    const result: GeocodeResult = {
      latitude: -12.3,
      longitude: -45.6,
      matchClass: 'uncrosscheckable',
      precision: 'approximate',
      source: 'maptiler',
    };
    const farAwayCentroid = { centroid_lat: -33.4, centroid_lng: -70.6 };
    const { db, updateOrderCalls } = makeDb({ claimed: [order], cacheRow: null, centroid: farAwayCentroid });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(result) });

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(updateOrderCalls[0]).toMatchObject({
      latitude: result.latitude,
      longitude: result.longitude,
      geocode_source: 'maptiler',
    });
    expect(updateOrderCalls[0]).not.toMatchObject({
      latitude: farAwayCentroid.centroid_lat,
      longitude: farAwayCentroid.centroid_lng,
    });
  });
});

// BLOCKER 1 (review): wrong_comuna had NO test anywhere on the branch.
// Two mutations at the dispatch site both stayed green without this:
// folding wrong_comuna into the uncrosscheckable (provider-point) branch,
// and gating that fold on `!order.comuna_id`. Both require a centroid to
// be PRESENT to catch, because with no centroid both branches degrade to
// the same "no coordinates change" result.
describe('runGeocodeEnrichBatch — wrong_comuna discards the provider point for the requested centroid', () => {
  it('writes the requested comuna centroid, never the sharp-but-wrong-comuna point', async () => {
    const order = makeOrder({ comuna_id: 'comuna-la-union', comuna: 'La Union' });
    const result: GeocodeResult = {
      // A real doorway match -- in Valdivia, ~100km from La Union -- per
      // Fase 0's measured false positive.
      latitude: -39.8142,
      longitude: -73.2459,
      matchClass: 'wrong_comuna',
      precision: 'approximate',
      source: 'maptiler',
    };
    const requestedCentroid = { centroid_lat: -40.2861, centroid_lng: -73.0928 };
    const { db, updateOrderCalls } = makeDb({ claimed: [order], cacheRow: null, centroid: requestedCentroid });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(result) });

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(updateOrderCalls[0]).toMatchObject({
      latitude: requestedCentroid.centroid_lat,
      longitude: requestedCentroid.centroid_lng,
      geocode_source: 'comuna_centroid',
    });
    expect(updateOrderCalls[0]).not.toMatchObject({
      latitude: result.latitude,
      longitude: result.longitude,
    });
  });
});

// BLOCKER 2 (review): comuna_id present but the centroid is missing is a
// DATA fault (fase 2's centroid backfill not deployed, or a schema gap),
// not the spec's "no comuna_id and no provider answer" terminal case.
// Conflating the two condemns an order to `unresolvable` on the very first
// tick, spending nothing and logging nothing, purely because a downstream
// migration has not landed yet.
describe('runGeocodeEnrichBatch — comuna_id present but centroid data missing is a transient DATA fault, never terminal', () => {
  it('a null match with comuna_id set but no centroid data logs an error and stays fallback, not unresolvable', async () => {
    const order = makeOrder({ comuna_id: 'comuna-las-condes' });
    const { db, updateOrderCalls } = makeDb({ claimed: [order], cacheRow: null, centroid: null });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(null) });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const summary = await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(updateOrderCalls[0]).toMatchObject({ geocode_status: 'fallback' });
    expect(updateOrderCalls[0]).not.toMatchObject({ geocode_status: 'unresolvable' });
    expect(summary.unresolvable).toBe(0);
    const errorLines = logSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .filter((entry) => entry.level === 'error' && entry.event === 'geocode_centroid_missing');
    expect(errorLines).toHaveLength(1);
    logSpy.mockRestore();
  });

  it('never consumes the attempt budget, even repeatedly', async () => {
    const order = makeOrder({ comuna_id: 'comuna-las-condes', geocode_attempts: 1 });
    const { db, updateOrderCalls } = makeDb({ claimed: [order], cacheRow: null, centroid: null });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(null) });

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(updateOrderCalls[0]).toMatchObject({ geocode_attempts: 1 });
  });

  it('a coarse match keeps the provider point instead of discarding it for a nonexistent centroid', async () => {
    const order = makeOrder({ comuna_id: 'comuna-las-condes' });
    const result: GeocodeResult = {
      latitude: -33.42,
      longitude: -70.58,
      matchClass: 'coarse',
      precision: 'approximate',
      source: 'maptiler',
    };
    const { db, updateOrderCalls } = makeDb({ claimed: [order], cacheRow: null, centroid: null });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(result) });

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(updateOrderCalls[0]).toMatchObject({
      latitude: result.latitude,
      longitude: result.longitude,
      geocode_source: 'maptiler',
      geocode_status: 'fallback',
    });
  });

  // Round-2 review: a wrong_comuna point during a centroid data fault is
  // NOT the same "keep what you paid for" case as coarse. The spec's whole
  // point about wrong_comuna is that the point isn't imprecise, it's FALSE
  // -- a sharp pin ~100km outside the requested comuna (Fase 0's own
  // measured false positive: "Arturo Prat 100, La Union" -> a Valdivia
  // doorway). Keeping it here would be Blocker 1's flattening reintroduced
  // one branch over. Coordinates must stay untouched and wait for the next
  // tick, which costs nothing -- the row retries in 30 minutes either way.
  it('a wrong_comuna point during a centroid data fault leaves coordinates untouched, never writes the false pin', async () => {
    const order = makeOrder({ comuna_id: 'comuna-la-union', comuna: 'La Union', latitude: null, longitude: null });
    const result: GeocodeResult = {
      latitude: -39.8142,
      longitude: -73.2459,
      matchClass: 'wrong_comuna',
      precision: 'approximate',
      source: 'maptiler',
    };
    const { db, updateOrderCalls } = makeDb({ claimed: [order], cacheRow: null, centroid: null });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(result) });

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(updateOrderCalls[0]).toMatchObject({
      latitude: null,
      longitude: null,
      geocode_status: 'fallback',
    });
    expect(updateOrderCalls[0]).not.toMatchObject({
      latitude: result.latitude,
      longitude: result.longitude,
    });
  });
});

describe('runGeocodeEnrichBatch — no match at all', () => {
  it('with a comuna_id, falls back to the centroid', async () => {
    const order = makeOrder();
    const { db, updateOrderCalls } = makeDb({
      claimed: [order],
      cacheRow: null,
      centroid: { centroid_lat: -33.4, centroid_lng: -70.6 },
    });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(null) });

    const summary = await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(summary.fallback).toBe(1);
    expect(updateOrderCalls[0]).toMatchObject({ geocode_status: 'fallback', geocode_source: 'comuna_centroid' });
  });

  it('without a comuna_id, lands unresolvable with NULL coordinates immediately', async () => {
    const order = makeOrder({ comuna_id: null });
    const { db, updateOrderCalls } = makeDb({ claimed: [order], cacheRow: null, centroid: null });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(null) });

    const summary = await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(summary.unresolvable).toBe(1);
    expect(updateOrderCalls[0]).toMatchObject({ geocode_status: 'unresolvable', latitude: null, longitude: null });
  });
});

describe('runGeocodeEnrichBatch — not_configured', () => {
  it('checks isConfigured and never calls geocode()', async () => {
    const order = makeOrder();
    const geocodeSpy = vi.fn();
    const { db, updateOrderCalls } = makeDb({
      claimed: [order],
      cacheRow: null,
      centroid: { centroid_lat: -33.4, centroid_lng: -70.6 },
    });
    const provider = makeProvider({ isConfigured: false, geocode: geocodeSpy });

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(geocodeSpy).not.toHaveBeenCalled();
    expect(updateOrderCalls[0]).toMatchObject({ geocode_status: 'fallback', geocode_attempts: 0 });
  });
});

describe('runGeocodeEnrichBatch — transport / credential failures never consume the attempt budget', () => {
  it('a timeout does not increment geocode_attempts', async () => {
    const order = makeOrder({ geocode_attempts: 1 });
    const { db, updateOrderCalls } = makeDb({
      claimed: [order],
      cacheRow: null,
      centroid: { centroid_lat: -33.4, centroid_lng: -70.6 },
    });
    const provider = makeProvider({
      geocode: vi.fn().mockRejectedValue(new GeocodingProviderError('timeout', 'timed out')),
    });

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(updateOrderCalls[0]).toMatchObject({ geocode_attempts: 1, geocode_status: 'fallback' });
  });

  it('an HTTP 404 from a malformed path is classified as transport, not "no match"', async () => {
    // Fase 4 emits api_error for a 404, not a null result -- this asserts
    // enrich.ts routes GeocodingProviderError('api_error', ...) into the
    // transient/transport path rather than treating a thrown error as if
    // `geocode()` had resolved to null.
    const order = makeOrder({ geocode_attempts: 0 });
    const { db, updateOrderCalls } = makeDb({
      claimed: [order],
      cacheRow: null,
      centroid: { centroid_lat: -33.4, centroid_lng: -70.6 },
    });
    const provider = makeProvider({
      geocode: vi.fn().mockRejectedValue(new GeocodingProviderError('api_error', 'MapTiler HTTP 404')),
    });

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(updateOrderCalls[0]).toMatchObject({ geocode_attempts: 0, geocode_status: 'fallback' });
  });

  it('a refused credential logs at error level', async () => {
    const order = makeOrder();
    const { db } = makeDb({
      claimed: [order],
      cacheRow: null,
      centroid: { centroid_lat: -33.4, centroid_lng: -70.6 },
    });
    const provider = makeProvider({
      geocode: vi.fn().mockRejectedValue(new GeocodingProviderError('credential', 'refused')),
    });
    // This repo's log() (src/lib/logger.ts) always writes through
    // console.log as structured JSON with a `level` field -- it never calls
    // console.error directly -- so the error-level assertion has to parse
    // that JSON rather than spy on console.error.
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    const errorLines = logSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .filter((entry) => entry.level === 'error' && entry.event === 'geocode_credential_refused');
    expect(errorLines).toHaveLength(1);
    logSpy.mockRestore();
  });
});

describe('runGeocodeEnrichBatch — quota guard', () => {
  it('stops calling the provider once the quota is exhausted, and rows land fallback', async () => {
    const orders = [makeOrder({ id: 'o1' }), makeOrder({ id: 'o2' })];
    const { db, updateOrderCalls } = makeDb({
      claimed: orders,
      cacheRow: null,
      centroid: { centroid_lat: -33.4, centroid_lng: -70.6 },
    });
    const geocodeSpy = vi.fn().mockResolvedValue(null);
    const provider = makeProvider({ geocode: geocodeSpy });

    const store = new Map<string, number>();
    const redis = {
      incr: vi.fn(async (key: string) => {
        const next = (store.get(key) ?? 0) + 1;
        store.set(key, next);
        return next;
      }),
      decr: vi.fn(async (key: string) => {
        const next = (store.get(key) ?? 0) - 1;
        store.set(key, next);
        return next;
      }),
      expireat: vi.fn().mockResolvedValue(1),
    } as never;

    await runGeocodeEnrichBatch({ db, provider, redis, monthlyQuota: 1, now: () => NOW });

    expect(geocodeSpy).toHaveBeenCalledTimes(1);
    expect(updateOrderCalls).toHaveLength(2);
    expect(updateOrderCalls[1]).toMatchObject({ geocode_status: 'fallback' });
  });
});

describe('runGeocodeEnrichBatch — batch summary', () => {
  it('counts provider calls separately from cache hits', async () => {
    const order = makeOrder();
    const { db } = makeDb({ claimed: [order], cacheRow: null, centroid: null });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(null) });

    const summary = await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(summary.providerCalls).toBe(1);
    expect(summary.cacheHits).toBe(0);
  });

  it('breaks the reasons down so a quota-exhausted row is distinguishable from a coarse-match row', async () => {
    const orders = [makeOrder({ id: 'o1' }), makeOrder({ id: 'o2' })];
    const { db } = makeDb({ claimed: orders, cacheRow: null, centroid: { centroid_lat: -33.4, centroid_lng: -70.6 } });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(null) });
    const redis = {
      incr: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2),
      decr: vi.fn().mockResolvedValue(0),
      expireat: vi.fn().mockResolvedValue(1),
    } as never;

    const summary = await runGeocodeEnrichBatch({ db, provider, redis, monthlyQuota: 1, now: () => NOW });

    expect(summary.reasons.no_match_centroid).toBe(1);
    expect(summary.reasons.quota_exhausted).toBe(1);
  });
});

// BLOCKER 3 (review): tryConsume() reserved quota even for a call that
// never reached the network (circuit breaker open, or any other thrown
// error) and never gave it back, so a provider outage can freeze the whole
// remaining month having spent zero real HTTP calls.
describe('runGeocodeEnrichBatch — quota is refunded when the reserved call did not succeed', () => {
  it('a transport failure gives back its quota reservation', async () => {
    const order = makeOrder();
    const { db } = makeDb({
      claimed: [order],
      cacheRow: null,
      centroid: { centroid_lat: -33.4, centroid_lng: -70.6 },
    });
    const provider = makeProvider({
      geocode: vi.fn().mockRejectedValue(new GeocodingProviderError('network', 'circuit breaker open')),
    });

    const store = new Map<string, number>();
    const redis = {
      incr: vi.fn(async (key: string) => {
        const next = (store.get(key) ?? 0) + 1;
        store.set(key, next);
        return next;
      }),
      decr: vi.fn(async (key: string) => {
        const next = (store.get(key) ?? 0) - 1;
        store.set(key, next);
        return next;
      }),
      expireat: vi.fn().mockResolvedValue(1),
    } as never;

    await runGeocodeEnrichBatch({ db, provider, redis, monthlyQuota: 100, now: () => NOW });

    // One reservation, one refund -- net zero. Without the refund this
    // would be 1, and with a monthlyQuota of 1 a SECOND row in the same
    // outage would be wrongly blocked as "quota exhausted".
    expect(store.get('geocode:quota:2026-09')).toBe(0);
  });
});

// Review finding 4: one row's own write failure must not abort the batch
// or suppress the summary log this phase's QA step reads.
describe('runGeocodeEnrichBatch — one row failing does not abort the batch', () => {
  it('continues to the next row, counts the failure, and still emits the summary log', async () => {
    const orders = [makeOrder({ id: 'bad-row' }), makeOrder({ id: 'good-row' })];
    const { db, updateOrderCalls } = makeDb({ claimed: orders, cacheRow: null, centroid: null });
    // Force the FIRST order's write to throw by overriding `from('orders')`
    // after the base mock is built.
    const baseFrom = (db as unknown as { from: (t: string) => unknown }).from as (t: string) => unknown;
    let call = 0; // outside the factory -- `.from('orders')` is called once PER ROW
    (db as unknown as { from: (t: string) => unknown }).from = vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          update: (payload: unknown) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => {
                    call += 1;
                    if (call === 1) throw new Error('write failed');
                    updateOrderCalls.push(payload);
                    return { data: {}, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      return baseFrom(table);
    });
    const provider = makeProvider({ geocode: vi.fn().mockResolvedValue(null) });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const summary = await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(summary.errors).toBe(1);
    expect(updateOrderCalls).toHaveLength(1); // the second (good) row still got written
    const completeLine = logSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .find((entry) => entry.event === 'geocode_batch_complete');
    expect(completeLine).toBeDefined();
    expect(completeLine.errors).toBe(1);
    logSpy.mockRestore();
  });
});

// Review finding 8: an unclassified exception (our own bug, e.g. a
// TypeError inside the adapter) must not silently become an ordinary,
// unlogged transport failure.
describe('runGeocodeEnrichBatch — an unexpected (non-provider) exception is logged', () => {
  it('logs at error level and still degrades to a transient retry, not a crash', async () => {
    const order = makeOrder();
    const { db, updateOrderCalls } = makeDb({
      claimed: [order],
      cacheRow: null,
      centroid: { centroid_lat: -33.4, centroid_lng: -70.6 },
    });
    const provider = makeProvider({ geocode: vi.fn().mockRejectedValue(new TypeError('boom')) });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runGeocodeEnrichBatch({ db, provider, redis: null, now: () => NOW });

    expect(updateOrderCalls[0]).toMatchObject({ geocode_status: 'fallback' });
    const errorLines = logSpy.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .filter((entry) => entry.level === 'error' && entry.event === 'geocode_unexpected_error');
    expect(errorLines).toHaveLength(1);
    logSpy.mockRestore();
  });
});
