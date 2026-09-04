import { describe, it, expect } from 'vitest';
import { computeTodayScanStats } from './crew-shift-stats';
import type { CrewPackageRow } from './crew-board';

describe('computeTodayScanStats', () => {
  const civilDateOf = (iso: string) => iso.slice(0, 10);

  it("counts only this user's scans on the given civil date", () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'o1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
      { order_id: 'o2', loaded_at: '2026-09-03T10:30:00Z', loaded_by: 'u1', status: 'en_bodega' },
      { order_id: 'o3', loaded_at: '2026-09-02T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' }, // yesterday
      { order_id: 'o4', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u2', status: 'en_bodega' }, // someone else
    ];
    const stats = computeTodayScanStats(packages, 'u1', '2026-09-03', civilDateOf);
    expect(stats.scannedToday).toBe(2);
  });

  it('returns a null rate with fewer than two scans or a too-small time spread', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'o1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
    ];
    expect(computeTodayScanStats(packages, 'u1', '2026-09-03', civilDateOf).ratePerHour).toBeNull();
  });

  it('derives packages/hour once there is a real spread', () => {
    const packages: CrewPackageRow[] = [
      { order_id: 'o1', loaded_at: '2026-09-03T10:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
      { order_id: 'o2', loaded_at: '2026-09-03T11:00:00Z', loaded_by: 'u1', status: 'en_bodega' },
    ];
    const stats = computeTodayScanStats(packages, 'u1', '2026-09-03', civilDateOf);
    expect(stats.ratePerHour).toBe(2);
  });

  it('returns zero/null for a user with no scans today, never undefined', () => {
    expect(computeTodayScanStats([], 'u1', '2026-09-03', civilDateOf)).toEqual({ scannedToday: 0, ratePerHour: null });
    expect(computeTodayScanStats([], null, '2026-09-03', civilDateOf)).toEqual({ scannedToday: 0, ratePerHour: null });
  });
});
