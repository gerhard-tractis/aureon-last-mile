import { describe, it, expect } from 'vitest';
import { computeStageHealth } from './health';

const now = new Date('2026-04-06T12:00:00');

describe('computeStageHealth — pickup', () => {
  it('ok when all pickups recent', () => {
    const items = [{ overdue_minutes: 10 }, { overdue_minutes: 0 }];
    expect(computeStageHealth('pickup', items, now).status).toBe('ok');
  });
  it('warn when any overdue 31 min', () => {
    const items = [{ overdue_minutes: 31 }];
    expect(computeStageHealth('pickup', items, now).status).toBe('warn');
  });
  it('crit when any overdue 121 min', () => {
    const items = [{ overdue_minutes: 121 }];
    expect(computeStageHealth('pickup', items, now).status).toBe('crit');
  });
  it('ok on empty items', () => {
    expect(computeStageHealth('pickup', [], now).status).toBe('ok');
  });
});

describe('computeStageHealth — reception', () => {
  it('ok when dwell ≤ 4h', () => {
    expect(computeStageHealth('reception', [{ dwell_minutes: 240 }], now).status).toBe('ok');
  });
  it('warn when dwell > 4h', () => {
    expect(computeStageHealth('reception', [{ dwell_minutes: 241 }], now).status).toBe('warn');
  });
  it('crit when dwell > 6h', () => {
    expect(computeStageHealth('reception', [{ dwell_minutes: 361 }], now).status).toBe('crit');
  });
});

describe('computeStageHealth — consolidation', () => {
  it('ok when oldest < 2h', () => {
    expect(computeStageHealth('consolidation', [{ age_minutes: 119, missed_dock_window: false }], now).status).toBe('ok');
  });
  it('warn when oldest ≥ 2h, no missed window', () => {
    expect(computeStageHealth('consolidation', [{ age_minutes: 120, missed_dock_window: false }], now).status).toBe('warn');
  });
  it('crit when any missed dock window', () => {
    expect(computeStageHealth('consolidation', [{ age_minutes: 30, missed_dock_window: true }], now).status).toBe('crit');
  });
});

describe('computeStageHealth — docks', () => {
  // Andenes holds two kinds of item and they fail in different ways: orders
  // parked at a dock, and routes waiting on a driver. The old rules read
  // idle_minutes off both and reported every result as "Ruta inactiva" — but
  // routes carry idle_time_minutes, never idle_minutes, so that number was
  // always an ORDER's dwell wearing route wording.
  const order = (idleMinutes: number) => ({ order_number: 'ORD-1', idle_minutes: idleMinutes });
  const route = (over: Record<string, unknown>) => ({
    external_route_id: 'R-1',
    route_date: '2026-04-06',
    driver_name: null,
    updated_at: '2026-04-06T12:00:00',
    ...over,
  });

  it('ok when nothing is waiting', () => {
    expect(computeStageHealth('docks', [], now).status).toBe('ok');
  });

  it('ok when an order has been in the andén < 2h', () => {
    expect(computeStageHealth('docks', [order(119)], now).status).toBe('ok');
  });

  it('warn when an order has been in the andén 2h+', () => {
    const result = computeStageHealth('docks', [order(120)], now);
    expect(result.status).toBe('warn');
    expect(result.delta).toBe('2h en andén');
  });

  it('crit when an order has been in the andén 4h+', () => {
    const result = computeStageHealth('docks', [order(245)], now);
    expect(result.status).toBe('crit');
    expect(result.delta).toBe('4h en andén');
  });

  it('warn when a route has waited 30m+ for a driver', () => {
    const result = computeStageHealth('docks', [route({ updated_at: '2026-04-06T11:20:00' })], now);
    expect(result.status).toBe('warn');
    expect(result.delta).toBe('Ruta sin conductor 40m');
  });

  it('crit when a route has waited 60m+ for a driver', () => {
    const result = computeStageHealth('docks', [route({ updated_at: '2026-04-06T10:30:00' })], now);
    expect(result.status).toBe('crit');
    expect(result.delta).toBe('Ruta sin conductor 90m');
  });

  it('ok when a waiting route already has a driver', () => {
    const items = [route({ driver_name: 'Ana Rojas', updated_at: '2026-04-06T10:30:00' })];
    expect(computeStageHealth('docks', items, now).status).toBe('ok');
  });

  it('ok when a driverless route is dated for a later day', () => {
    const items = [route({ route_date: '2026-04-07', updated_at: '2026-04-06T10:30:00' })];
    expect(computeStageHealth('docks', items, now).status).toBe('ok');
  });

  it('reports the worse of the two signals', () => {
    const items = [order(120), route({ updated_at: '2026-04-06T10:30:00' })];
    const result = computeStageHealth('docks', items, now);
    expect(result.status).toBe('crit');
    expect(result.delta).toBe('Ruta sin conductor 90m');
  });
});

describe('computeStageHealth — delivery', () => {
  it('ok when all routes on time, recent GPS', () => {
    expect(computeStageHealth('delivery', [{ behind_plan_minutes: 0, no_gps_minutes: 10 }], now).status).toBe('ok');
  });
  it('warn when any route behind > 1h', () => {
    expect(computeStageHealth('delivery', [{ behind_plan_minutes: 61, no_gps_minutes: 0 }], now).status).toBe('warn');
  });
  it('crit when any route no GPS > 30m', () => {
    expect(computeStageHealth('delivery', [{ behind_plan_minutes: 0, no_gps_minutes: 31 }], now).status).toBe('crit');
  });
});

describe('computeStageHealth — returns', () => {
  it('ok when return age < 80% of sla', () => {
    // sla_hours=10, age=7h (70%) → ok
    expect(computeStageHealth('returns', [{ age_minutes: 420, sla_hours: 10 }], now).status).toBe('ok');
  });
  it('warn when return age ≥ 80% of sla', () => {
    // sla_hours=10, age=8h (80%) → warn
    expect(computeStageHealth('returns', [{ age_minutes: 480, sla_hours: 10 }], now).status).toBe('warn');
  });
  it('crit when return age > sla', () => {
    // sla_hours=10, age=10h+1m → crit
    expect(computeStageHealth('returns', [{ age_minutes: 601, sla_hours: 10 }], now).status).toBe('crit');
  });
  it('falls back to 24h default when sla_hours missing', () => {
    // no sla_hours → default 24h; age=23h → 96% → warn
    expect(computeStageHealth('returns', [{ age_minutes: 1380 }], now).status).toBe('warn');
  });
});

describe('computeStageHealth — reverse', () => {
  it('always returns neutral', () => {
    expect(computeStageHealth('reverse', [{ anything: true }], now).status).toBe('neutral');
    expect(computeStageHealth('reverse', [], now).status).toBe('neutral');
  });
});
