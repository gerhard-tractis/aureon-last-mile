import { describe, it, expect, vi } from 'vitest';
import { findOrderIdsWithLiveDispatchOnOtherRoutes } from '@/lib/dispatch/dispatch-cross-route-orders';

/**
 * spec-79 BLOCKER (coordinator addendum). This function previously failed
 * OPEN on a query error — returning an empty set, indistinguishable from a
 * genuine "no cross-route orders exist" result — which is exactly the M-2
 * defect it exists to prevent, just moved one level up. First direct unit
 * test for this function; both call sites (packages/[pkgId]/route.ts,
 * routes/[id]/route.ts) previously only exercised it through a 6-deep mock
 * chain.
 */
function buildClient(opts: {
  siblingRows?: { order_id: string | null }[];
  siblingError?: { code: string; message: string } | null;
}) {
  const auditInsertSpy = vi.fn().mockReturnValue({ then: (resolve: (v: unknown) => void) => resolve(null) });
  const dispatchesSelectTail = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({
      data: opts.siblingError ? null : (opts.siblingRows ?? []),
      error: opts.siblingError ?? null,
    }),
  };
  const from = vi.fn((table: string) => {
    if (table === 'dispatches') return { select: vi.fn().mockReturnValue(dispatchesSelectTail) };
    if (table === 'audit_logs') return { insert: auditInsertSpy };
    throw new Error(`unexpected table ${table}`);
  });
  return { client: { from } as never, auditInsertSpy };
}

describe('findOrderIdsWithLiveDispatchOnOtherRoutes', () => {
  it('returns the orders that carry a live dispatch on another route', async () => {
    const { client } = buildClient({ siblingRows: [{ order_id: 'o1' }, { order_id: 'o2' }] });
    const result = await findOrderIdsWithLiveDispatchOnOtherRoutes(client, {
      operatorId: 'op-1',
      userId: 'u-1',
      orderIds: ['o1', 'o2', 'o3'],
      excludeRouteId: 'r1',
      logPrefix: 'test',
    });
    expect(result).toEqual(new Set(['o1', 'o2']));
  });

  it('returns an empty set immediately for an empty orderIds input, without querying', async () => {
    const { client } = buildClient({});
    const result = await findOrderIdsWithLiveDispatchOnOtherRoutes(client, {
      operatorId: 'op-1',
      userId: 'u-1',
      orderIds: [],
      excludeRouteId: 'r1',
      logPrefix: 'test',
    });
    expect(result).toEqual(new Set());
  });

  /**
   * spec-79 BLOCKER (coordinator addendum) — the corrected behaviour. A
   * query failure must not read as "no cross-route orders exist": every
   * requested orderId comes back, so the caller reverts none of them.
   */
  it('fails CLOSED on a query error: every requested orderId comes back, not an empty set', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = buildClient({ siblingError: { code: '08006', message: 'connection reset' } });
    const result = await findOrderIdsWithLiveDispatchOnOtherRoutes(client, {
      operatorId: 'op-1',
      userId: 'u-1',
      orderIds: ['o1', 'o2'],
      excludeRouteId: 'r1',
      logPrefix: 'test',
    });
    expect(result).toEqual(new Set(['o1', 'o2']));
    errorSpy.mockRestore();
  });

  it('records the failure with its own audit_logs row, not just console.error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client, auditInsertSpy } = buildClient({ siblingError: { code: '08006', message: 'connection reset' } });
    await findOrderIdsWithLiveDispatchOnOtherRoutes(client, {
      operatorId: 'op-1',
      userId: 'u-1',
      orderIds: ['o1'],
      excludeRouteId: 'r1',
      logPrefix: 'test',
    });
    expect(auditInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operator_id: 'op-1',
        user_id: 'u-1',
        action: 'cross_route_lookup_failed',
        resource_type: 'dispatches',
        resource_id: 'r1',
      }),
    );
    errorSpy.mockRestore();
  });

  it('logs loudly on a query error (not silently swallowed)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = buildClient({ siblingError: { code: '08006', message: 'connection reset' } });
    await findOrderIdsWithLiveDispatchOnOtherRoutes(client, {
      operatorId: 'op-1',
      userId: 'u-1',
      orderIds: ['o1'],
      excludeRouteId: 'r1',
      logPrefix: 'test',
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
