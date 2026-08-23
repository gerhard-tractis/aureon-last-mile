import type { DossierDispatch } from '@/hooks/useOrderDossier';

/**
 * Shared fixture for `DossierDispatch` (spec-65 Task 7/9).
 *
 * WHY THIS FILE EXISTS. Six tests across the branch each hand-rolled their
 * own `dispatch()`/`dispatchRow()` object literal with the full field list.
 * When Task 9 added `external_dispatch_id` to the type, every one of those
 * six literals silently became a type error `tsconfig.json` never surfaces
 * (it excludes `*.test.tsx`) — the next field added to `DossierDispatch`
 * would repeat that exact drift, six times over, invisibly. One fixture
 * means one place to update.
 *
 * Deliberately plain defaults (nulls/empty), not a "realistic" dispatch —
 * each call site overrides only the fields its test cares about.
 */
export function dossierDispatchFixture(overrides: Partial<DossierDispatch> = {}): DossierDispatch {
  return {
    id: 'd-1',
    substatus: null,
    substatus_code: null,
    status: 'en_ruta',
    external_dispatch_id: null,
    completed_at: null,
    arrived_at: null,
    estimated_at: null,
    failure_reason: null,
    latitude: null,
    longitude: null,
    raw_data: {},
    is_pickup: false,
    external_route_id: null,
    driver_name: null,
    route_id: null,
    ...overrides,
  };
}
