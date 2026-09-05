import { describe, it, expect } from 'vitest';
import { isConfirmedExternalRouteId } from '@/lib/dispatch/dispatch-external-route-id';

/**
 * Coordinator finding, post-Fase-3: `routes.external_route_id` is NOT NULL
 * (20260306000001) and every route-creation path pre-fills it with a
 * `draft_<uuid>` placeholder before DispatchTrack has ever seen the route —
 * `create_seeded_route` (20260903000002) and `POST /api/dispatch/routes`
 * (route.ts:146) both do this. A bare `Boolean(route.external_route_id)`
 * reads that placeholder as "DT already confirmed this route", so the
 * dispatch handler's retry-skip branch fires on every real, never-dispatched
 * route: it never calls DT, persists the placeholder as if it were DT's own
 * id, transitions to `dispatched`, and answers 200 — DT never receives the
 * route.
 */
describe('isConfirmedExternalRouteId', () => {
  it('is false for null (never assigned)', () => {
    expect(isConfirmedExternalRouteId(null)).toBe(false);
  });

  it('is false for undefined', () => {
    expect(isConfirmedExternalRouteId(undefined)).toBe(false);
  });

  it('is false for the draft_ placeholder create_seeded_route and POST /routes both mint', () => {
    expect(isConfirmedExternalRouteId('draft_11111111-1111-1111-1111-111111111111')).toBe(false);
  });

  it('is true for a real DispatchTrack id (numeric-as-string)', () => {
    expect(isConfirmedExternalRouteId('99999')).toBe(true);
  });

  it('is true for a real DispatchTrack id that happens to be an opaque string', () => {
    expect(isConfirmedExternalRouteId('ext-already-accepted')).toBe(true);
  });
});
