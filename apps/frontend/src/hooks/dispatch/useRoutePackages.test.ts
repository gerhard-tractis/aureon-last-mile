import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRoutePackages } from './useRoutePackages';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  Wrapper.displayName = 'TestWrapper';
  return Wrapper;
}

function chainResolving(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data, error }),
  };
}

/**
 * spec-74 phase 4. `useRoutePackages` now issues two queries: `dispatches`
 * (unchanged) and a second `packages` query for the per-box `loaded_at`
 * fact (packages has no direct FK to dispatches — both point at `orders` —
 * so PostgREST cannot embed it in one round trip). `mockFrom` is routed by
 * table name so each test can control both independently; tests that don't
 * care about box counts just get an empty `packages` result by default.
 */
function mockTables(opts: {
  dispatches: unknown;
  dispatchesError?: unknown;
  packages?: unknown;
  packagesError?: unknown;
}) {
  const dispatchesChain = chainResolving(opts.dispatches, opts.dispatchesError ?? null);
  const packagesChain = chainResolving(opts.packages ?? [], opts.packagesError ?? null);
  mockFrom.mockImplementation((table: string) => (table === 'packages' ? packagesChain : dispatchesChain));
  return { dispatchesChain, packagesChain };
}

describe('useRoutePackages', () => {
  beforeEach(() => mockFrom.mockReset());

  it('is idle when routeId is null', () => {
    const { result } = renderHook(() => useRoutePackages(null, 'op-1'), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when operatorId is null', () => {
    const { result } = renderHook(() => useRoutePackages('route-1', null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('is idle when both ids are null', () => {
    const { result } = renderHook(() => useRoutePackages(null, null), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns mapped RoutePackage array on success', async () => {
    const rawRow = {
      id: 'dispatch-1',
      order_id: 'order-1',
      status: 'pending',
      stage: 'staged',
      orders: { order_number: 'ORD-001', customer_name: 'Alice', delivery_address: '123 St', customer_phone: '+56911' },
    };
    mockTables({ dispatches: [rawRow] });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]).toMatchObject({
      dispatch_id: 'dispatch-1',
      order_id: 'order-1',
      order_number: 'ORD-001',
      contact_name: 'Alice',
      contact_address: '123 St',
      contact_phone: '+56911',
      status: 'pending',
      stage: 'staged',
    });
  });

  /** decision 4 depends on this: RouteBuilder cannot tell planned from staged without it. */
  it('returns the row stage (planned/staged/adopted), not just status', async () => {
    const rawRow = {
      id: 'dispatch-3',
      order_id: 'order-3',
      status: 'pending',
      stage: 'planned',
      orders: { order_number: 'ORD-003', customer_name: 'Cara', delivery_address: '789 Rd', customer_phone: null },
    };
    mockTables({ dispatches: [rawRow] });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].stage).toBe('planned');
  });

  /**
   * spec-70 phase 4, breakage #8: the row is `dispatches.status`
   * (dispatch_status_enum), which takes `'partial'` — a value that is not in
   * `PackageStatus` at all. The old field name/type (`package_status:
   * PackageStatus`) could never honestly hold this; `status: DispatchStatus`
   * can.
   */
  it('carries a dispatch-only status value (partial) through untouched', async () => {
    const rawRow = {
      id: 'dispatch-4',
      order_id: 'order-4',
      status: 'partial',
      stage: 'staged',
      orders: { order_number: 'ORD-004', customer_name: 'Dana', delivery_address: '1 Rd', customer_phone: null },
    };
    mockTables({ dispatches: [rawRow] });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].status).toBe('partial');
    expect(result.current.data?.[0]).not.toHaveProperty('package_status');
  });

  it('handles orders as array (takes first element)', async () => {
    const rawRow = {
      id: 'dispatch-2',
      order_id: 'order-2',
      status: 'delivered',
      orders: [{ order_number: 'ORD-002', customer_name: 'Bob', delivery_address: '456 Ave', customer_phone: null }],
    };
    mockTables({ dispatches: [rawRow] });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].order_number).toBe('ORD-002');
    expect(result.current.data?.[0].contact_phone).toBeNull();
  });

  it('returns empty array when no dispatches found', async () => {
    mockTables({ dispatches: [] });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('exposes isError on Supabase failure', async () => {
    mockTables({ dispatches: null, dispatchesError: new Error('DB error') });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  /**
   * spec-74 phase 4. dispatches.stage is per-ORDER; the per-BOX fact lives
   * on packages.loaded_at (phase 1). RouteBuilder/PackageRow need both
   * counts per order to render "1 of 3 bultos loaded" instead of treating
   * a multi-bulto order as one all-or-nothing stop.
   */
  it('aggregates packages.loaded_at into boxesTotal/boxesLoaded per order', async () => {
    const rawRow = {
      id: 'dispatch-5',
      order_id: 'order-5',
      status: 'pending',
      stage: 'partially_staged',
      orders: { order_number: 'ORD-005', customer_name: 'Eve', delivery_address: '5 Rd', customer_phone: null },
    };
    const { packagesChain } = mockTables({
      dispatches: [rawRow],
      packages: [
        { order_id: 'order-5', loaded_at: '2026-08-31T10:00:00Z', status: 'en_carga' },
        // spec-76 task 3 review, escalated decision — this row was
        // `en_bodega` and counted toward boxesTotal (3, not 2). That
        // encoded the pre-fix bug: `en_bodega` came OUT of
        // DISPATCHABLE_STATUSES (it never reached the andén, so the
        // scanner now refuses it — NOT_ON_DOCK), and this hook's own
        // "excludes an en_bodega, never-loaded package too" test now
        // covers that exclusion directly. `sectorizado` is what's
        // genuinely still dispatchable here, preserving this test's
        // original intent (three DIFFERENT live states aggregating
        // correctly) without relying on the wrong one.
        { order_id: 'order-5', loaded_at: null, status: 'sectorizado' },
        { order_id: 'order-5', loaded_at: null, status: 'asignado' },
      ],
    });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].boxesTotal).toBe(3);
    expect(result.current.data?.[0].boxesLoaded).toBe(1);

    // operator_id scoping and soft-delete filter must survive the widening.
    expect(packagesChain.in).toHaveBeenCalledWith('order_id', ['order-5']);
    expect(packagesChain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(packagesChain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  /**
   * spec-74 phase 4 review item 2 (BLOCKER). This used to assert 0/0 as
   * correct — a `planned` order with no live packages (planned before
   * `expand_carton` minted them, or all its packages later soft-deleted)
   * then contributed 0 to RouteBuilder's pendingCount, hiding a route the
   * seal still refuses: seal-route.ts's first gate is purely
   * `pending_stops + partially_staged_stops > 0`, keyed off
   * `dispatches.stage` alone, with no regard for package counts at all.
   * Floored at 1 whenever the order is not `staged` and has no countable
   * live package — never wrong (a non-staged order can never be assumed
   * complete), even though it cannot show a real box count.
   */
  it('floors a non-staged order with no live packages at 1 outstanding box, rather than 0/0', async () => {
    const rawRow = {
      id: 'dispatch-6',
      order_id: 'order-6',
      status: 'pending',
      stage: 'planned',
      orders: { order_number: 'ORD-006', customer_name: 'Fay', delivery_address: '6 Rd', customer_phone: null },
    };
    mockTables({ dispatches: [rawRow], packages: [] });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].boxesTotal).toBe(1);
    expect(result.current.data?.[0].boxesLoaded).toBe(0);
  });

  it('does NOT floor a staged order with no live packages — 0/0 is a legitimate empty-order fact for it', async () => {
    const rawRow = {
      id: 'dispatch-7',
      order_id: 'order-7',
      status: 'pending',
      stage: 'staged',
      orders: { order_number: 'ORD-007', customer_name: 'Gus', delivery_address: '7 Rd', customer_phone: null },
    };
    mockTables({ dispatches: [rawRow], packages: [] });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].boxesTotal).toBe(0);
    expect(result.current.data?.[0].boxesLoaded).toBe(0);
  });

  /**
   * spec-74 phase 4 review item 3 (MAJOR). The seal (seal-route.ts) only
   * ever treats a package as outstanding when it is BOTH unloaded AND in
   * DISPATCHABLE_STATUSES. Before this, boxesTotal/boxesLoaded were
   * status-agnostic: a `dañado` box inflated the outstanding count above
   * what the seal refuses over, AND permanently capped the row below
   * "N of N" since nothing can ever load a dañado box.
   */
  it('excludes a non-dispatchable, never-loaded package from both boxesTotal and boxesLoaded', async () => {
    const rawRow = {
      id: 'dispatch-8',
      order_id: 'order-8',
      status: 'pending',
      stage: 'partially_staged',
      orders: { order_number: 'ORD-008', customer_name: 'Hal', delivery_address: '8 Rd', customer_phone: null },
    };
    mockTables({
      dispatches: [rawRow],
      packages: [
        { order_id: 'order-8', loaded_at: '2026-08-31T10:00:00Z', status: 'en_carga' }, // loaded
        { order_id: 'order-8', loaded_at: null, status: 'dañado' }, // stuck, never loaded — excluded
        // spec-76 task 3 review, escalated decision — this row used to be
        // `en_bodega` ("outstanding, dispatchable"), which was the bug: it
        // encoded `en_bodega` counting toward boxesTotal, the exact thing
        // this test exists to disprove for a status that can never be
        // loaded. `sectorizado` is what's genuinely still dispatchable and
        // unloaded here; `en_bodega`'s own exclusion gets its own test
        // below ("...never having been sorted...").
        { order_id: 'order-8', loaded_at: null, status: 'sectorizado' }, // outstanding, dispatchable
      ],
    });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 2, not 3: the dañado box is excluded entirely, so the row CAN reach
    // "N of N" once the remaining dispatchable box is scanned.
    expect(result.current.data?.[0].boxesTotal).toBe(2);
    expect(result.current.data?.[0].boxesLoaded).toBe(1);
  });

  /**
   * spec-76 task 3 review, escalated decision. `en_bodega` came OUT of
   * `DISPATCHABLE_STATUSES` (scan-validator.ts) — it genuinely means "never
   * sorted to an andén", so the scanner now refuses it (NOT_ON_DOCK). This
   * hook shares that same constant, so an `en_bodega` box must stop
   * inflating `boxesTotal` the same way a `dañado` one already didn't:
   * before this decision, an outstanding `en_bodega` box would show as
   * "pending" on the desktop pending count forever, even though the
   * scanner refuses to let it be loaded — the exact seal-vs-screen
   * disagreement `DISPATCHABLE_STATUSES` exists to prevent (see this
   * file's other test, item 3, for the `dañado` precedent).
   */
  it('excludes an en_bodega, never-loaded package too — it can no longer be scanned in', async () => {
    const rawRow = {
      id: 'dispatch-8b',
      order_id: 'order-8b',
      status: 'pending',
      stage: 'partially_staged',
      orders: { order_number: 'ORD-008B', customer_name: 'Ike', delivery_address: '8B Rd', customer_phone: null },
    };
    mockTables({
      dispatches: [rawRow],
      packages: [
        { order_id: 'order-8b', loaded_at: '2026-08-31T10:00:00Z', status: 'en_carga' }, // loaded
        { order_id: 'order-8b', loaded_at: null, status: 'en_bodega' }, // never sorted, excluded
      ],
    });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].boxesTotal).toBe(1);
    expect(result.current.data?.[0].boxesLoaded).toBe(1);
  });

  it('keeps a loaded package in the total even though its post-load status (en_carga) is not in DISPATCHABLE_STATUSES', async () => {
    const rawRow = {
      id: 'dispatch-9',
      order_id: 'order-9',
      status: 'pending',
      stage: 'staged',
      orders: { order_number: 'ORD-009', customer_name: 'Ida', delivery_address: '9 Rd', customer_phone: null },
    };
    mockTables({
      dispatches: [rawRow],
      packages: [{ order_id: 'order-9', loaded_at: '2026-08-31T10:00:00Z', status: 'en_carga' }],
    });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0].boxesTotal).toBe(1);
    expect(result.current.data?.[0].boxesLoaded).toBe(1);
  });

  /**
   * spec-74 phase 4 review item 5, mutation M7. Deleting
   * `if (pkgError) throw pkgError;` fails NOTHING in the pre-existing
   * suite: no test ever passed `packagesError`. Left unthrown, every order
   * in the affected chunk would silently render 0 (or, post item-2, the
   * floored 1) live packages instead of surfacing the failure — hiding a
   * route the seal still refuses, the same failure shape as item 2 reached
   * a different way.
   */
  it('propagates an error from the packages query instead of silently returning zero boxes', async () => {
    const rawRow = {
      id: 'dispatch-10',
      order_id: 'order-10',
      status: 'pending',
      stage: 'planned',
      orders: { order_number: 'ORD-010', customer_name: 'Jan', delivery_address: '10 Rd', customer_phone: null },
    };
    mockTables({ dispatches: [rawRow], packages: null, packagesError: new Error('packages query failed') });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  /**
   * spec-74 phase 4 review item 6 (MEDIUM). `.in('order_id', orderIds)`
   * puts one UUID per order straight into the query string — a route with
   * ~200+ orders approaches the ~8k header/URL ceiling, which fails the
   * WHOLE packages query (414) and blanks the entire package list, not
   * just the counts. `orderIds` are now chunked (100 per request) and
   * merged; this pins the boundary — 101 distinct order ids must produce
   * two `packages` requests, not one.
   */
  it('chunks the packages query across multiple requests once past the chunk size', async () => {
    const orderIds = Array.from({ length: 101 }, (_, i) => `order-${i}`);
    const dispatches = orderIds.map((orderId, i) => ({
      id: `dispatch-${i}`,
      order_id: orderId,
      status: 'pending',
      stage: 'staged',
      orders: { order_number: `ORD-${i}`, customer_name: null, delivery_address: null, customer_phone: null },
    }));
    mockTables({ dispatches, packages: [] });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const packagesCalls = mockFrom.mock.calls.filter(([table]) => table === 'packages');
    expect(packagesCalls).toHaveLength(2);
  });

  it('does not query packages at all when there are no dispatches', async () => {
    mockTables({ dispatches: [] });

    const { result } = renderHook(() => useRoutePackages('route-1', 'op-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockFrom).not.toHaveBeenCalledWith('packages');
  });
});
