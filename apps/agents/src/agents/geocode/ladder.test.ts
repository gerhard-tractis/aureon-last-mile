// src/agents/geocode/ladder.test.ts — spec-58 fase 5 retry-ladder state
// machine, tested as pure functions (no Supabase, no provider, no network).
import { describe, it, expect } from 'vitest';
import type { ClaimedOrder } from './claim';
import {
  resolvedUpdate,
  centroidRetryUpdate,
  providerPointRetryUpdate,
  unresolvableNoCoordinatesUpdate,
  transientRetryUpdate,
  startOfNextMonth,
} from './ladder';

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

const NOW = new Date('2026-09-11T12:00:00.000Z');

describe('resolvedUpdate', () => {
  it('lands resolved, exact, with no further retry', () => {
    const order = makeOrder();
    const update = resolvedUpdate(order, -33.41, -70.57, 'maptiler', NOW);

    expect(update.geocode_status).toBe('resolved');
    expect(update.geocode_precision).toBe('exact');
    expect(update.geocode_source).toBe('maptiler');
    expect(update.latitude).toBe(-33.41);
    expect(update.longitude).toBe(-70.57);
    expect(update.geocode_next_attempt_at).toBeNull();
  });

  it('does not change geocode_attempts', () => {
    const order = makeOrder({ geocode_attempts: 1 });
    const update = resolvedUpdate(order, -33.41, -70.57, 'comuna_centroid', NOW);
    expect(update.geocode_attempts).toBe(1);
  });
});

describe('centroidRetryUpdate — the wrong_comuna / coarse / null-with-comuna path', () => {
  const centroid = { latitude: -33.4, longitude: -70.6 };

  it('first occurrence: fallback, +1 attempt, retries in 7 days, holds the centroid', () => {
    const order = makeOrder({ geocode_attempts: 0 });
    const update = centroidRetryUpdate(order, centroid, NOW);

    expect(update.geocode_status).toBe('fallback');
    expect(update.geocode_attempts).toBe(1);
    expect(update.latitude).toBe(centroid.latitude);
    expect(update.longitude).toBe(centroid.longitude);
    expect(update.geocode_source).toBe('comuna_centroid');
    expect(update.geocode_precision).toBe('approximate');
    expect(update.geocode_next_attempt_at).toBe(
      new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('second occurrence: unresolvable, holding the centroid, never retried again', () => {
    const order = makeOrder({ geocode_attempts: 1 });
    const update = centroidRetryUpdate(order, centroid, NOW);

    expect(update.geocode_status).toBe('unresolvable');
    expect(update.geocode_attempts).toBe(2);
    expect(update.latitude).toBe(centroid.latitude);
    expect(update.longitude).toBe(centroid.longitude);
    expect(update.geocode_next_attempt_at).toBeNull();
  });

  it('when no centroid exists (no comuna_id resolvable), leaves existing coordinates untouched', () => {
    const order = makeOrder({ geocode_attempts: 0, latitude: null, longitude: null });
    const update = centroidRetryUpdate(order, null, NOW);

    expect(update.latitude).toBeNull();
    expect(update.longitude).toBeNull();
    expect(update.geocode_source).toBeNull();
    expect(update.geocode_status).toBe('fallback');
    expect(update.geocode_attempts).toBe(1);
  });
});

describe('providerPointRetryUpdate — the uncrosscheckable path', () => {
  const point = { latitude: -12.3, longitude: -45.6 };

  it('first occurrence: fallback, +1 attempt, retries in 7 days, keeps the PROVIDER point', () => {
    const order = makeOrder({ geocode_attempts: 0 });
    const update = providerPointRetryUpdate(order, point, NOW);

    expect(update.geocode_status).toBe('fallback');
    expect(update.geocode_attempts).toBe(1);
    expect(update.latitude).toBe(point.latitude);
    expect(update.longitude).toBe(point.longitude);
    expect(update.geocode_source).toBe('maptiler');
    expect(update.geocode_precision).toBe('approximate');
  });

  it('second occurrence: unresolvable, still holding the provider point', () => {
    const order = makeOrder({ geocode_attempts: 1 });
    const update = providerPointRetryUpdate(order, point, NOW);

    expect(update.geocode_status).toBe('unresolvable');
    expect(update.latitude).toBe(point.latitude);
    expect(update.longitude).toBe(point.longitude);
    expect(update.geocode_next_attempt_at).toBeNull();
  });
});

// The pair the spec calls out as "the easiest to implement backwards":
// wrong_comuna DISCARDS the provider's point in favour of the requested
// comuna's centroid; uncrosscheckable KEEPS the provider's point. Testing
// them against each other, with a centroid and a provider point that are
// deliberately far apart, is what would catch the two being swapped.
describe('wrong_comuna vs uncrosscheckable — the two opposite dispositions', () => {
  it('centroidRetryUpdate never returns the far-away provider point', () => {
    const order = makeOrder({ geocode_attempts: 0 });
    const centroid = { latitude: -33.4, longitude: -70.6 }; // requested comuna
    const providerPoint = { latitude: -39.8, longitude: -73.2 }; // e.g. Valdivia

    const update = centroidRetryUpdate(order, centroid, NOW);

    expect([update.latitude, update.longitude]).toEqual([centroid.latitude, centroid.longitude]);
    expect([update.latitude, update.longitude]).not.toEqual([providerPoint.latitude, providerPoint.longitude]);
  });

  it('providerPointRetryUpdate never substitutes a comuna centroid', () => {
    const order = makeOrder({ geocode_attempts: 0 });
    const providerPoint = { latitude: -39.8, longitude: -73.2 };
    const someCentroid = { latitude: -33.4, longitude: -70.6 };

    const update = providerPointRetryUpdate(order, providerPoint, NOW);

    expect([update.latitude, update.longitude]).toEqual([providerPoint.latitude, providerPoint.longitude]);
    expect([update.latitude, update.longitude]).not.toEqual([someCentroid.latitude, someCentroid.longitude]);
  });
});

describe('unresolvableNoCoordinatesUpdate', () => {
  it('terminal immediately, NULL coordinates, regardless of attempt count', () => {
    const order = makeOrder({ geocode_attempts: 0 });
    const update = unresolvableNoCoordinatesUpdate(order, NOW);

    expect(update.geocode_status).toBe('unresolvable');
    expect(update.latitude).toBeNull();
    expect(update.longitude).toBeNull();
    expect(update.geocode_next_attempt_at).toBeNull();
  });

  it('does not increment geocode_attempts', () => {
    const order = makeOrder({ geocode_attempts: 0 });
    const update = unresolvableNoCoordinatesUpdate(order, NOW);
    expect(update.geocode_attempts).toBe(0);
  });
});

describe('transientRetryUpdate', () => {
  const centroid = { latitude: -33.4, longitude: -70.6 };

  it('transport failure: fallback, attempts unchanged, retries in 30 minutes, writes centroid', () => {
    const order = makeOrder({ geocode_attempts: 0 });
    const update = transientRetryUpdate(order, centroid, 'transport', NOW);

    expect(update.geocode_status).toBe('fallback');
    expect(update.geocode_attempts).toBe(0);
    expect(update.latitude).toBe(centroid.latitude);
    expect(update.geocode_next_attempt_at).toBe(new Date(NOW.getTime() + 30 * 60 * 1000).toISOString());
  });

  it('credential refused: fallback, attempts unchanged, retries in 1 hour', () => {
    const order = makeOrder({ geocode_attempts: 0 });
    const update = transientRetryUpdate(order, centroid, 'credential', NOW);

    expect(update.geocode_attempts).toBe(0);
    expect(update.geocode_next_attempt_at).toBe(new Date(NOW.getTime() + 60 * 60 * 1000).toISOString());
  });

  it('quota exhausted or missing key: fallback, attempts unchanged, retries start of next month', () => {
    const order = makeOrder({ geocode_attempts: 0 });
    const update = transientRetryUpdate(order, centroid, 'quota_or_missing_key', NOW);

    expect(update.geocode_attempts).toBe(0);
    expect(update.geocode_next_attempt_at).toBe(startOfNextMonth(NOW).toISOString());
  });

  it('a coarse/null failure that has already retried once does not consume a SECOND real attempt on a transient failure', () => {
    // Regression guard: transport/credential/quota failures must never touch
    // geocode_attempts, even for a row that already carries attempts=1 from
    // an earlier real (coarse/null) answer.
    const order = makeOrder({ geocode_attempts: 1 });
    const update = transientRetryUpdate(order, centroid, 'transport', NOW);
    expect(update.geocode_attempts).toBe(1);
    expect(update.geocode_status).toBe('fallback');
  });

  it('leaves existing coordinates untouched when no centroid is available', () => {
    const order = makeOrder({ geocode_attempts: 0, latitude: null, longitude: null });
    const update = transientRetryUpdate(order, null, 'transport', NOW);
    expect(update.latitude).toBeNull();
    expect(update.longitude).toBeNull();
  });
});

describe('startOfNextMonth', () => {
  it('returns the first instant of the following UTC month', () => {
    expect(startOfNextMonth(new Date('2026-09-11T12:00:00.000Z')).toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it('rolls over the year at December', () => {
    expect(startOfNextMonth(new Date('2026-12-15T00:00:00.000Z')).toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});
