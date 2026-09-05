import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/dispatchtrack-api', () => ({ createDTRoute: vi.fn() }));
vi.mock('@/lib/dispatch/dispatch-retry-precheck', () => ({ decidePrecheck: vi.fn() }));

import { createDTRoute } from '@/lib/dispatchtrack-api';
import { decidePrecheck } from '@/lib/dispatch/dispatch-retry-precheck';
import { resolveExternalRouteIdForDispatch } from '@/lib/dispatch/dispatch-resolve-external-route-id';
import type { DispatchRow } from '@/lib/dispatch/dispatch-dt-payload';

/**
 * spec-79 Fase 4: extracted from route.ts (which was pushing past the
 * 300-line cap) — the first-attempt-only validation chain
 * (MISSING_ORDER_NUMBER, EMPTY_MANIFEST, token) plus the precheck-gated
 * decision between reusing an already-created DT route and calling
 * `createDTRoute` for real. Only reached when the route is NOT already a
 * confirmed retry (route.ts's own `isConfirmedExternalRouteId` check).
 */
function loadedPkg(id: string, routeId = 'r1') {
  return {
    id, label: `CTN-${id}`, sku_items: [], status: 'en_carga', deleted_at: null,
    loaded_at: '2026-09-05T00:00:00Z', load_inferred: false, loaded_route_id: routeId,
  };
}

function dispatchRow(orderNumber: string, pkgIds: string[]): DispatchRow {
  return {
    id: `d-${orderNumber}`,
    order_id: `o-${orderNumber}`,
    orders: {
      order_number: orderNumber,
      customer_name: 'Mario',
      delivery_address: 'Av 1',
      customer_phone: null,
      packages: pkgIds.map((id) => loadedPkg(id)),
    },
  };
}

const baseParams = {
  routeId: 'r1',
  routeDate: '2026-03-24',
  truckIdentifier: 'ZALDUENDO',
  driverIdentifier: null as string | null,
  wasStale: false,
  apiToken: 'test-token',
};

describe('resolveExternalRouteIdForDispatch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('refuses MISSING_ORDER_NUMBER before ever calling the precheck or DT', async () => {
    const result = await resolveExternalRouteIdForDispatch({
      ...baseParams,
      dispatchRows: [dispatchRow('   ', ['p1'])],
    });
    expect(result).toMatchObject({ ok: false, code: 'MISSING_ORDER_NUMBER', status: 422, count: 1 });
    expect(decidePrecheck).not.toHaveBeenCalled();
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('refuses EMPTY_MANIFEST before ever calling the precheck or DT', async () => {
    const result = await resolveExternalRouteIdForDispatch({
      ...baseParams,
      dispatchRows: [dispatchRow('4821', [])],
    });
    expect(result).toMatchObject({ ok: false, code: 'EMPTY_MANIFEST', status: 422, count: 1 });
    expect(decidePrecheck).not.toHaveBeenCalled();
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('creates the route via DT when the precheck decides "create"', async () => {
    (decidePrecheck as ReturnType<typeof vi.fn>).mockResolvedValue({ action: 'create' });
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '999' });

    const result = await resolveExternalRouteIdForDispatch({
      ...baseParams,
      dispatchRows: [dispatchRow('4821', ['p1'])],
    });

    expect(result).toEqual({ ok: true, externalRouteId: '999', isRetry: false });
    expect(createDTRoute).toHaveBeenCalledWith(
      expect.objectContaining({ truck_identifier: 'ZALDUENDO', route_date: '2026-03-24' }),
      'test-token',
    );
  });

  it('reuses the pre-check match and marks it a retry — never calls createDTRoute', async () => {
    (decidePrecheck as ReturnType<typeof vi.fn>).mockResolvedValue({ action: 'reuse', externalRouteId: '222' });

    const result = await resolveExternalRouteIdForDispatch({
      ...baseParams,
      wasStale: true,
      dispatchRows: [dispatchRow('4821', ['p1'])],
    });

    expect(result).toEqual({ ok: true, externalRouteId: '222', isRetry: true });
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('refuses RECONCILIATION_REQUIRED without releasing the claim when the pre-check is ambiguous/failed', async () => {
    (decidePrecheck as ReturnType<typeof vi.fn>).mockResolvedValue({ action: 'refuse' });

    const result = await resolveExternalRouteIdForDispatch({
      ...baseParams,
      wasStale: true,
      dispatchRows: [dispatchRow('4821', ['p1'])],
    });

    expect(result).toMatchObject({ ok: false, code: 'RECONCILIATION_REQUIRED', status: 409, release: false });
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  it('passes wasStale through to decidePrecheck unchanged', async () => {
    (decidePrecheck as ReturnType<typeof vi.fn>).mockResolvedValue({ action: 'create' });
    (createDTRoute as ReturnType<typeof vi.fn>).mockResolvedValue({ external_route_id: '1' });

    await resolveExternalRouteIdForDispatch({
      ...baseParams,
      wasStale: true,
      dispatchRows: [dispatchRow('4821', ['p1'])],
    });

    expect(decidePrecheck).toHaveBeenCalledWith(
      expect.objectContaining({ wasStale: true, routeDate: '2026-03-24', apiToken: 'test-token' }),
    );
  });
});
