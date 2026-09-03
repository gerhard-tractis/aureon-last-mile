import { describe, it, expect } from 'vitest';
import {
  STALL_THRESHOLD_MINUTES,
  LOAD_STATE_ORDER,
  deriveRouteLoadState,
  formatFreshness,
  formatStaleness,
  computeLoadRateFmt,
  sortByUrgency,
  type LoadState,
} from './loading-monitor';

const NOW = new Date('2026-09-03T12:00:00Z').getTime();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('deriveRouteLoadState', () => {
  it('maps a draft route to "draft" regardless of scan activity', () => {
    expect(deriveRouteLoadState('draft', 0, null, NOW)).toBe<LoadState>('draft');
  });

  it('maps a loaded route to "ready" (LISTA PARA DESPACHO)', () => {
    expect(deriveRouteLoadState('loaded', 96, iso(-60_000), NOW)).toBe<LoadState>('ready');
  });

  it('maps a planned/loading route with no scans yet to "loading" (not started is not stalled)', () => {
    expect(deriveRouteLoadState('planned', 0, null, NOW)).toBe<LoadState>('loading');
    expect(deriveRouteLoadState('loading', 0, null, NOW)).toBe<LoadState>('loading');
  });

  it('maps a loading route with a recent scan to "loading"', () => {
    const lastScan = iso(-8_000); // 8s ago
    expect(deriveRouteLoadState('loading', 148, lastScan, NOW)).toBe<LoadState>('loading');
  });

  it('maps a loading route with a scan older than the stall threshold to "stalled"', () => {
    const lastScan = iso(-(STALL_THRESHOLD_MINUTES + 4) * 60_000);
    expect(deriveRouteLoadState('loading', 41, lastScan, NOW)).toBe<LoadState>('stalled');
  });

  it('is not stalled exactly AT the threshold boundary minus one ms', () => {
    const lastScan = iso(-(STALL_THRESHOLD_MINUTES * 60_000 - 1));
    expect(deriveRouteLoadState('loading', 41, lastScan, NOW)).toBe<LoadState>('loading');
  });

  it('is stalled exactly AT the threshold boundary', () => {
    const lastScan = iso(-STALL_THRESHOLD_MINUTES * 60_000);
    expect(deriveRouteLoadState('loading', 41, lastScan, NOW)).toBe<LoadState>('stalled');
  });
});

describe('formatFreshness (último escaneo)', () => {
  it('renders seconds under a minute', () => {
    expect(formatFreshness(iso(-8_000), NOW)).toBe('8 s');
  });

  it('renders whole minutes at and beyond 60s', () => {
    expect(formatFreshness(iso(-60_000), NOW)).toBe('1 min');
    expect(formatFreshness(iso(-90_000), NOW)).toBe('1 min');
    expect(formatFreshness(iso(-125_000), NOW)).toBe('2 min');
  });

  it('never renders a negative duration for a clock-skewed future timestamp', () => {
    expect(formatFreshness(iso(5_000), NOW)).toBe('0 s');
  });
});

describe('formatStaleness (sin escaneos)', () => {
  it('renders whole minutes since the last scan', () => {
    expect(formatStaleness(iso(-14 * 60_000), NOW)).toBe('14 min');
  });

  it('floors sub-minute stale durations to 0 min rather than going negative', () => {
    expect(formatStaleness(iso(-40_000), NOW)).toBe('0 min');
  });
});

describe('computeLoadRateFmt (paquetes/h)', () => {
  it('returns null when fewer than 2 minutes of elapsed loading time exist (unreliable rate)', () => {
    expect(computeLoadRateFmt(10, iso(-30_000), NOW)).toBeNull();
  });

  it('returns null when there is no first-scan timestamp', () => {
    expect(computeLoadRateFmt(0, null, NOW)).toBeNull();
  });

  it('computes packages per hour, rounded, from real elapsed time', () => {
    // 148 boxes over 41.5 minutes ~ 213.98/h -> rounds to 214
    const first = iso(-41.5 * 60_000);
    expect(computeLoadRateFmt(148, first, NOW)).toBe(214);
  });
});

describe('sortByUrgency', () => {
  it('orders stalled routes before loading, ready, and draft', () => {
    const order: LoadState[] = ['ready', 'draft', 'loading', 'stalled'];
    const sorted = [...order].sort(
      (a, b) => LOAD_STATE_ORDER[a] - LOAD_STATE_ORDER[b],
    );
    expect(sorted).toEqual(['stalled', 'loading', 'ready', 'draft']);
  });

  it('sortByUrgency reorders a list of routes by their derived state', () => {
    interface Row { id: string; state: LoadState }
    const rows: Row[] = [
      { id: 'r-ready', state: 'ready' },
      { id: 'r-draft', state: 'draft' },
      { id: 'r-stalled', state: 'stalled' },
      { id: 'r-loading', state: 'loading' },
    ];
    const sorted = sortByUrgency(rows, (r) => r.state);
    expect(sorted.map((r) => r.id)).toEqual(['r-stalled', 'r-loading', 'r-ready', 'r-draft']);
  });
});
