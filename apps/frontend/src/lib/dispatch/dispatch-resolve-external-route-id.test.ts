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

  /**
   * spec-79 M-3 (round 8 mediums). Scenario: attempt 1 reached DT and
   * crashed before anything local was written; a box was damaged/withdrawn
   * before the retry, so the LOCAL manifest is now empty. Under the old
   * order, EMPTY_MANIFEST refused (422, release: true) before the precheck
   * ever ran — stranding DT's own real route with no local record of it.
   * The precheck must run first on the stale path and, on `reuse`, must
   * short-circuit before EMPTY_MANIFEST is even evaluated.
   */
  it('M-3: on the stale-reclaim path, an empty LOCAL manifest does not block the precheck — reuses DT\'s route if it already has one', async () => {
    (decidePrecheck as ReturnType<typeof vi.fn>).mockResolvedValue({ action: 'reuse', externalRouteId: '555' });

    const result = await resolveExternalRouteIdForDispatch({
      ...baseParams,
      wasStale: true,
      dispatchRows: [dispatchRow('4821', [])], // no packages — manifest is empty
    });

    expect(result).toEqual({ ok: true, externalRouteId: '555', isRetry: true });
    expect(decidePrecheck).toHaveBeenCalledTimes(1);
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  /**
   * spec-79 M-3: the reverse of the above — the precheck ran FIRST, ruled
   * out DT already holding the route (`create`), and only THEN does the
   * (still genuinely empty) local manifest refuse with EMPTY_MANIFEST. The
   * precheck must have been called before this refusal, not skipped.
   */
  it('M-3: on the stale-reclaim path, EMPTY_MANIFEST still refuses, but only after the precheck ran and confirmed DT does not already have the route', async () => {
    (decidePrecheck as ReturnType<typeof vi.fn>).mockResolvedValue({ action: 'create' });

    const result = await resolveExternalRouteIdForDispatch({
      ...baseParams,
      wasStale: true,
      dispatchRows: [dispatchRow('4821', [])],
    });

    expect(result).toMatchObject({ ok: false, code: 'EMPTY_MANIFEST', status: 422, count: 1 });
    expect(decidePrecheck).toHaveBeenCalledTimes(1);
    expect(createDTRoute).not.toHaveBeenCalled();
  });

  /**
   * spec-79 M-3: on a genuine first attempt (not stale), the precheck must
   * never run at all — not before EMPTY_MANIFEST, not after. Nothing earlier
   * reached DT, so there is nothing to reconcile, and calling DT here would
   * both cost a needless round trip and violate its rate limit.
   */
  it('M-3: on a fresh (non-stale) claim, the precheck is never called even when the manifest is empty', async () => {
    const result = await resolveExternalRouteIdForDispatch({
      ...baseParams,
      wasStale: false,
      dispatchRows: [dispatchRow('4821', [])],
    });

    expect(result).toMatchObject({ ok: false, code: 'EMPTY_MANIFEST', status: 422, count: 1 });
    expect(decidePrecheck).not.toHaveBeenCalled();
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
