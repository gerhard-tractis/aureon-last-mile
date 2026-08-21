import { describe, it, expect } from 'vitest';
import {
  CARGA_STAGES,
  manifestStateForStage,
  pickupTabForManifest,
} from './manifest-state';

/**
 * The seed's whole claim about Musan is "each carga lands on the tab its stage
 * names". That claim is two steps — stage -> manifest columns, then manifest
 * columns -> tab — and both used to be inline ternaries nobody could test.
 * pickupTabForManifest mirrors the three Pickup RPCs' predicates, so these
 * tests fail if the mapping drifts from what the screen actually does.
 */
describe('manifestStateForStage', () => {
  it('leaves a pending carga with no reception status', () => {
    expect(manifestStateForStage('pending')).toEqual({
      status: 'pending',
      receptionStatus: null,
      createWhenMissing: false,
    });
  });

  it('never creates a manifest for a pending carga', () => {
    // "pending loads may not have a manifest row until the operator opens the
    // scan flow" — inventing one changes what the screen is showing.
    expect(manifestStateForStage('pending').createWhenMissing).toBe(false);
  });

  it('keeps a scanning carga on the pending tab (reception still null)', () => {
    expect(manifestStateForStage('scanning')).toEqual({
      status: 'in_progress',
      receptionStatus: null,
      createWhenMissing: true,
    });
  });

  it('marks an in_transit carga awaiting reception but not completed', () => {
    expect(manifestStateForStage('in_transit')).toEqual({
      status: 'in_progress',
      receptionStatus: 'awaiting_reception',
      createWhenMissing: true,
    });
  });

  it('marks a completed carga received', () => {
    expect(manifestStateForStage('completed')).toEqual({
      status: 'completed',
      receptionStatus: 'received',
      createWhenMissing: true,
    });
  });

  it('covers every stage', () => {
    for (const stage of CARGA_STAGES) {
      expect(() => manifestStateForStage(stage)).not.toThrow();
    }
  });
});

describe('pickupTabForManifest', () => {
  it('puts a load with no manifest row on the pending tab', () => {
    expect(pickupTabForManifest(null)).toBe('pending');
  });

  it('puts a routed load on no tab at all', () => {
    // spec-61 Task 7: pickup_route_id IS NOT NULL drops the load off pending,
    // and it is not in_transit or completed either. This is exactly the drift
    // that made every Musan carga invisible.
    expect(
      pickupTabForManifest({ status: 'pending', receptionStatus: null, routed: true }),
    ).toBe('none');
  });

  it('reads status=completed as the completed tab', () => {
    expect(
      pickupTabForManifest({ status: 'completed', receptionStatus: 'received', routed: false }),
    ).toBe('completed');
  });

  it('reads a non-completed manifest with a reception status as in_transit', () => {
    expect(
      pickupTabForManifest({
        status: 'in_progress',
        receptionStatus: 'awaiting_reception',
        routed: false,
      }),
    ).toBe('in_transit');
  });

  it('keeps an in_progress manifest with no reception status on pending', () => {
    expect(
      pickupTabForManifest({ status: 'in_progress', receptionStatus: null, routed: false }),
    ).toBe('pending');
  });
});

describe('stage lands on the intended tab', () => {
  const expected: Record<(typeof CARGA_STAGES)[number], string> = {
    pending: 'pending',
    scanning: 'pending',
    in_transit: 'in_transit',
    completed: 'completed',
  };

  for (const stage of CARGA_STAGES) {
    it(`${stage} -> ${expected[stage]}`, () => {
      const state = manifestStateForStage(stage);
      // After convergence the seed always clears pickup_route_id.
      const row = state.createWhenMissing
        ? { status: state.status, receptionStatus: state.receptionStatus, routed: false }
        : null;
      expect(pickupTabForManifest(row)).toBe(expected[stage]);
    });
  }
});
