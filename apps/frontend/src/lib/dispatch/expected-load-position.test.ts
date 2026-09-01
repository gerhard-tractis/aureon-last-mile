import { describe, it, expect, vi } from 'vitest';
import { pickOccupiedPosition, findExpectedLoadPosition } from './expected-load-position';

const LIVE_POSITION = { id: 'lp-1', code: 'POS-04', label: 'Zona frente a Andén 4', deleted_at: null };
const OCCUPIED_ROUTE = {
  id: 'route-1',
  load_position_id: 'lp-1',
  load_position_released_at: null,
  deleted_at: null,
  load_positions: LIVE_POSITION,
};

describe('pickOccupiedPosition', () => {
  it('returns the position for a planned dispatch whose route occupies one', () => {
    const result = pickOccupiedPosition([{ id: 'd1', route_id: 'route-1', routes: OCCUPIED_ROUTE }]);
    expect(result).toEqual({
      dispatchId: 'd1',
      routeId: 'route-1',
      positionId: 'lp-1',
      positionCode: 'POS-04',
      positionLabel: 'Zona frente a Andén 4',
    });
  });

  it('unwraps an embedded route/position returned as a one-element array (PostgREST embed shape)', () => {
    const result = pickOccupiedPosition([{ id: 'd1', route_id: 'route-1', routes: [{ ...OCCUPIED_ROUTE, load_positions: [LIVE_POSITION] }] }]);
    expect(result?.positionId).toBe('lp-1');
  });

  it('skips a route with no position assigned yet (Decision 8 best-effort)', () => {
    const result = pickOccupiedPosition([
      { id: 'd1', route_id: 'route-1', routes: { ...OCCUPIED_ROUTE, load_position_id: null, load_positions: null } },
    ]);
    expect(result).toBeNull();
  });

  it('skips a route whose position was released (Decision 4 occupancy predicate)', () => {
    const result = pickOccupiedPosition([
      { id: 'd1', route_id: 'route-1', routes: { ...OCCUPIED_ROUTE, load_position_released_at: '2026-08-27T00:00:00Z' } },
    ]);
    expect(result).toBeNull();
  });

  it('skips a soft-deleted route', () => {
    const result = pickOccupiedPosition([
      { id: 'd1', route_id: 'route-1', routes: { ...OCCUPIED_ROUTE, deleted_at: '2026-08-27T00:00:00Z' } },
    ]);
    expect(result).toBeNull();
  });

  it('skips a soft-deleted position (dangling occupancy)', () => {
    const result = pickOccupiedPosition([
      { id: 'd1', route_id: 'route-1', routes: { ...OCCUPIED_ROUTE, load_positions: { ...LIVE_POSITION, deleted_at: '2026-08-27T00:00:00Z' } } },
    ]);
    expect(result).toBeNull();
  });

  it('returns null with no rows', () => {
    expect(pickOccupiedPosition([])).toBeNull();
  });

  it('falls through to the next row when the first is not occupied', () => {
    const result = pickOccupiedPosition([
      { id: 'd0', route_id: 'route-0', routes: null },
      { id: 'd1', route_id: 'route-1', routes: OCCUPIED_ROUTE },
    ]);
    expect(result?.dispatchId).toBe('d1');
  });
});

describe('findExpectedLoadPosition', () => {
  function buildClient(response: { data: unknown; error: { message: string } | null }) {
    const calls: { table: string; filters: [string, unknown][] }[] = [];
    const from = vi.fn((table: string) => {
      const call = { table, filters: [] as [string, unknown][] };
      calls.push(call);
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((c: string, v: unknown) => { call.filters.push([c, v]); return chain; }),
        in: vi.fn((c: string, v: unknown) => { call.filters.push([c, v]); return chain; }),
        // Review item 4 — this used to be `vi.fn(() => chain)`, which
        // never recorded the call, so deleting `.is('deleted_at', null)`
        // from the query left this whole suite green.
        is: vi.fn((c: string, v: unknown) => { call.filters.push([c, v]); return chain; }),
        limit: vi.fn(() => Promise.resolve(response)),
      };
      return chain;
    });
    return { client: { from } as never, calls };
  }

  it('queries dispatches scoped to the operator and order, planned or staged', async () => {
    const { client, calls } = buildClient({ data: [{ id: 'd1', route_id: 'route-1', routes: OCCUPIED_ROUTE }], error: null });
    const result = await findExpectedLoadPosition(client, { operatorId: 'op-1', orderId: 'o1' });
    expect(calls[0].table).toBe('dispatches');
    expect(calls[0].filters).toContainEqual(['operator_id', 'op-1']);
    expect(calls[0].filters).toContainEqual(['order_id', 'o1']);
    // spec-74 phase 2 — widened from `.eq('stage', 'planned')` so the
    // second bulto's position scan still resolves once the first bulto has
    // already flipped the order's dispatch to `staged` (see
    // expected-load-position.ts's header comment for why).
    //
    // spec-74 phase 2 review item 6 — `adopted` added too: a multi-bulto
    // order adopted at the desktop and continued on mobile found no row
    // without it, refused with the same NO_POSITION_ASSIGNED even though
    // the route-level scan itself would accept the box.
    //
    // spec-74 phase 3 — `partially_staged` added: it is now what a 2-bulto
    // order's dispatch actually holds after its first scan, and without it
    // here the second bulto's lookup found no row at all.
    expect(calls[0].filters).toContainEqual(['stage', ['planned', 'partially_staged', 'staged', 'adopted']]);
    expect(calls[0].filters).toContainEqual(['deleted_at', null]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.position.positionCode).toBe('POS-04');
  });

  it('reports NO_POSITION_ASSIGNED when nothing occupied is found', async () => {
    const { client } = buildClient({ data: [], error: null });
    const result = await findExpectedLoadPosition(client, { operatorId: 'op-1', orderId: 'o1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NO_POSITION_ASSIGNED');
  });

  it('surfaces a failed query rather than reporting NO_POSITION_ASSIGNED', async () => {
    const { client } = buildClient({ data: null, error: { message: 'boom' } });
    const result = await findExpectedLoadPosition(client, { operatorId: 'op-1', orderId: 'o1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('QUERY_FAILED');
  });
});
