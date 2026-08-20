import { describe, it, expect } from 'vitest';
import { driverInitials, shortDateLabel, timeLabel, splitLoads } from './pickupMobileHelpers';
import type { RouteManifestRow } from '@/components/pickup/RouteManifestList';

function manifest(overrides: Partial<RouteManifestRow>): RouteManifestRow {
  return {
    id: 'm1',
    external_load_id: 'CARGA-1',
    retailer_name: 'Falabella',
    pickup_location: 'Mall Plaza Vespucio',
    total_orders: 10,
    total_packages: 20,
    verified_count: 0,
    status: 'pending',
    ...overrides,
  };
}

describe('driverInitials', () => {
  it('takes the first letter of the first and last word', () => {
    expect(driverInitials('M. Rojas')).toBe('MR');
    expect(driverInitials('Ana Torres')).toBe('AT');
  });

  it('falls back to a placeholder when no name is available, never fabricating one', () => {
    expect(driverInitials(null)).toBe('··');
    expect(driverInitials(undefined)).toBe('··');
    expect(driverInitials('')).toBe('··');
  });

  it('uses the single word twice-normalized for a one-word name', () => {
    expect(driverInitials('Rojas')).toBe('R');
  });
});

describe('shortDateLabel', () => {
  it('renders weekday + day/month, no trailing period', () => {
    const label = shortDateLabel(new Date('2026-08-13T12:00:00'));
    expect(label).toMatch(/^[a-záéíóú]{3} 13\/08$/i);
    expect(label).not.toContain('.');
  });
});

describe('timeLabel', () => {
  it('formats an ISO timestamp as HH:MM', () => {
    const iso = new Date('2026-08-13T07:31:00').toISOString();
    expect(timeLabel(iso)).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('splitLoads', () => {
  it('picks the first unfinished load as next, in queue order', () => {
    const a = manifest({ id: 'a', external_load_id: 'A', status: 'pending' });
    const b = manifest({ id: 'b', external_load_id: 'B', status: 'pending' });
    const { next, remaining } = splitLoads([a, b]);
    expect(next).toBe(a);
    expect(remaining).toEqual([b]);
  });

  it('never promotes a completed load to next', () => {
    const done = manifest({ id: 'a', external_load_id: 'A', status: 'completed' });
    const pending = manifest({ id: 'b', external_load_id: 'B', status: 'pending' });
    const { next, completedLoads } = splitLoads([done, pending]);
    expect(next).toBe(pending);
    expect(completedLoads).toEqual([done]);
  });

  it('an in_progress load counts as unfinished and can be next', () => {
    const inProgress = manifest({ id: 'a', status: 'in_progress' });
    const { next } = splitLoads([inProgress]);
    expect(next).toBe(inProgress);
  });

  it('returns next: null when every load is completed', () => {
    const done1 = manifest({ id: 'a', status: 'completed' });
    const done2 = manifest({ id: 'b', status: 'completed' });
    const { next, completedLoads, remaining } = splitLoads([done1, done2]);
    expect(next).toBeNull();
    expect(completedLoads).toEqual([done1, done2]);
    expect(remaining).toEqual([]);
  });

  it('returns next: null for an empty route', () => {
    expect(splitLoads([])).toEqual({ next: null, remaining: [], completedLoads: [] });
  });

  it('keeps a cancelled load out of next but still lists it in remaining', () => {
    const cancelled = manifest({ id: 'a', status: 'cancelled' });
    const pending = manifest({ id: 'b', status: 'pending' });
    const { next, remaining } = splitLoads([cancelled, pending]);
    expect(next).toBe(pending);
    expect(remaining).toEqual([cancelled]);
  });
});
