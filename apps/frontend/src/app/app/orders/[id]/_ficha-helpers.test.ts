import { describe, it, expect } from 'vitest';
import { breadcrumbHref, lastWebhookTimestamp, deliveryDispatch } from './_ficha-helpers';
import type { DossierDispatch } from '@/hooks/useOrderDossier';

// The Todo/Aureon/DispatchTrack source-filter helpers that used to live
// here (`filterAuditLogsBySource`/`filterDispatchesBySource`) moved into
// `UnifiedEventLog` itself — see that component's `sourceFilter` prop and
// `_ficha-helpers.ts`'s own note.

function dispatch(overrides: Partial<DossierDispatch> = {}): DossierDispatch {
  return {
    id: 'd-1',
    substatus: null,
    substatus_code: null,
    status: 'en_ruta',
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
    external_dispatch_id: null,
    ...overrides,
  };
}

describe('breadcrumbHref', () => {
  it('returns the plain orders path when the query string is empty', () => {
    expect(breadcrumbHref('')).toBe('/app/orders');
  });

  it('appends a non-empty query string so the incoming view is preserved', () => {
    expect(breadcrumbHref('vista=sla-en-riesgo&pagina=2')).toBe(
      '/app/orders?vista=sla-en-riesgo&pagina=2',
    );
  });
});

describe('lastWebhookTimestamp', () => {
  it('returns null when there are no dispatches', () => {
    expect(lastWebhookTimestamp([])).toBeNull();
  });

  it('returns null when no dispatch carries any timestamp field', () => {
    expect(lastWebhookTimestamp([dispatch()])).toBeNull();
  });

  it("prefers a dispatch's completed_at, then arrived_at, then estimated_at", () => {
    expect(lastWebhookTimestamp([dispatch({ estimated_at: '2026-08-13T09:00:00' })])).toBe(
      '2026-08-13T09:00:00',
    );
    expect(
      lastWebhookTimestamp([
        dispatch({ arrived_at: '2026-08-13T10:00:00', estimated_at: '2026-08-13T09:00:00' }),
      ]),
    ).toBe('2026-08-13T10:00:00');
    expect(
      lastWebhookTimestamp([
        dispatch({
          completed_at: '2026-08-13T12:41:08',
          arrived_at: '2026-08-13T10:00:00',
        }),
      ]),
    ).toBe('2026-08-13T12:41:08');
  });

  it('picks the newest timestamp across multiple dispatch rows', () => {
    const dispatches = [
      dispatch({ id: 'd-1', completed_at: '2026-08-13T06:55:14' }),
      dispatch({ id: 'd-2', completed_at: '2026-08-13T12:41:08' }),
    ];
    expect(lastWebhookTimestamp(dispatches)).toBe('2026-08-13T12:41:08');
  });
});

describe('deliveryDispatch', () => {
  it('returns null when there are no dispatches', () => {
    expect(deliveryDispatch([])).toBeNull();
  });

  it('returns null when every dispatch is a pickup leg', () => {
    expect(deliveryDispatch([dispatch({ is_pickup: true })])).toBeNull();
  });

  it('returns the first non-pickup dispatch, respecting the dossier hook\'s own ordering', () => {
    const pickup = dispatch({ id: 'pickup-1', is_pickup: true });
    const delivery = dispatch({ id: 'delivery-1', is_pickup: false });
    expect(deliveryDispatch([pickup, delivery])).toBe(delivery);
  });
});
