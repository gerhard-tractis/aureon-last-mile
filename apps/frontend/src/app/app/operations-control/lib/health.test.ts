import { describe, it, expect } from 'vitest';
import { computeStageHealth } from './health';

describe('duration formatting in delta lines', () => {
  it('rounds raw fractional minutes — never prints floats like 2969.0869358m', () => {
    const r = computeStageHealth('docks', [{ idle_minutes: 2969.0869358 }], new Date());
    expect(r.delta).toBe('Ruta inactiva 2d 1h');
  });

  it('keeps short durations in minutes', () => {
    const r = computeStageHealth('docks', [{ idle_minutes: 45.7 }], new Date());
    expect(r.delta).toBe('Ruta inactiva 46m');
  });

  it('uses hours between 1h and 48h', () => {
    const r = computeStageHealth('docks', [{ idle_minutes: 150 }], new Date());
    expect(r.delta).toBe('Ruta inactiva 3h');
  });

  it('formats delivery deltas the same way', () => {
    const r = computeStageHealth('delivery', [{ behind_plan_minutes: 95.4, no_gps_minutes: 0 }], new Date());
    expect(r.delta).toBe('Ruta atrasada 2h');
  });

  it('formats pickup overdue the same way', () => {
    const r = computeStageHealth('pickup', [{ overdue_minutes: 200.9 }], new Date());
    expect(r.delta).toBe('Recogida atrasada 3h');
  });
});

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
  it('ok when all routes idle < 30m', () => {
    expect(computeStageHealth('docks', [{ idle_minutes: 29 }], now).status).toBe('ok');
  });
  it('warn when any route idle 30m+', () => {
    expect(computeStageHealth('docks', [{ idle_minutes: 30 }], now).status).toBe('warn');
  });
  it('crit when any route idle 60m+', () => {
    expect(computeStageHealth('docks', [{ idle_minutes: 61 }], now).status).toBe('crit');
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
