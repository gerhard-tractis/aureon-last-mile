import { describe, it, expect } from 'vitest';
import {
  driverInitials,
  shortDateLabel,
  timeLabel,
  splitLoads,
  needsSignatureRescue,
} from './pickupMobileHelpers';
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
    const done = manifest({
      id: 'a',
      external_load_id: 'A',
      status: 'completed',
      signature_operator: 'M. Rojas',
    });
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
    const done1 = manifest({ id: 'a', status: 'completed', signature_operator: 'M. Rojas' });
    const done2 = manifest({ id: 'b', status: 'completed', signature_operator: 'M. Rojas' });
    const { next, completedLoads, remaining } = splitLoads([done1, done2]);
    expect(next).toBeNull();
    expect(completedLoads).toEqual([done1, done2]);
    expect(remaining).toEqual([]);
  });

  it('returns next: null for an empty route', () => {
    expect(splitLoads([])).toEqual({
      next: null,
      remaining: [],
      completedLoads: [],
      rescueLoads: [],
    });
  });

  // spec-80 fase 2b — a manifest `trg_route_receptions_status_sync` closed
  // WITHOUT a signature (the H1 rescue, spec-80 fase 1) is `status:
  // 'completed'` but must NOT land in `completedLoads` with the genuinely
  // signed ones: it still needs the crew's attention. Split into its own
  // bucket instead of a boolean flag on the existing one, so a caller
  // cannot forget to check it — same shape discipline as `next`/`remaining`/
  // `completedLoads` above.
  describe('rescueLoads (spec-80 fase 2b)', () => {
    it('separates a completed-without-signature load into rescueLoads, not completedLoads', () => {
      const rescue = manifest({
        id: 'a',
        external_load_id: 'A',
        status: 'completed',
        signature_operator: null,
      });
      const signed = manifest({
        id: 'b',
        external_load_id: 'B',
        status: 'completed',
        signature_operator: 'M. Rojas',
      });
      const { rescueLoads, completedLoads } = splitLoads([rescue, signed]);
      expect(rescueLoads).toEqual([rescue]);
      expect(completedLoads).toEqual([signed]);
    });

    it('never treats a manifest whose signature_operator was never fetched as needing rescue', () => {
      // Asymmetric on purpose: unlike the test above, this fixture never
      // sets signature_operator at all (undefined, not fetched by some
      // OTHER caller of RouteManifestRow) — must not be confused with the
      // explicit `null` above, which is the real rescue signal.
      const unknownSignature = manifest({ id: 'a', status: 'completed' });
      const { rescueLoads, completedLoads } = splitLoads([unknownSignature]);
      expect(rescueLoads).toEqual([]);
      expect(completedLoads).toEqual([unknownSignature]);
    });

    it('does not promote a rescue load to next — it is still status completed', () => {
      const rescue = manifest({ id: 'a', status: 'completed', signature_operator: null });
      const pending = manifest({ id: 'b', status: 'pending' });
      const { next, rescueLoads } = splitLoads([rescue, pending]);
      expect(next).toBe(pending);
      expect(rescueLoads).toEqual([rescue]);
    });
  });

  it('keeps a cancelled load out of next but still lists it in remaining', () => {
    const cancelled = manifest({ id: 'a', status: 'cancelled' });
    const pending = manifest({ id: 'b', status: 'pending' });
    const { next, remaining } = splitLoads([cancelled, pending]);
    expect(next).toBe(pending);
    expect(remaining).toEqual([cancelled]);
  });
});

describe('needsSignatureRescue', () => {
  it('is true only when status is completed AND signature_operator is explicitly null', () => {
    expect(
      needsSignatureRescue(manifest({ status: 'completed', signature_operator: null })),
    ).toBe(true);
  });

  it('is false when signed', () => {
    expect(
      needsSignatureRescue(
        manifest({ status: 'completed', signature_operator: 'M. Rojas' }),
      ),
    ).toBe(false);
  });

  it('is false when signature_operator was never fetched (undefined) — unknown is not a rescue signal', () => {
    expect(needsSignatureRescue(manifest({ status: 'completed' }))).toBe(false);
  });

  it('is false for a non-completed manifest even without a signature', () => {
    expect(
      needsSignatureRescue(manifest({ status: 'in_progress', signature_operator: null })),
    ).toBe(false);
  });
});
