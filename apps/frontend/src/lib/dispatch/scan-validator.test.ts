import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateScan, DISPATCHABLE_STATUSES } from './scan-validator';

/**
 * These tests assert the actual table and column names the queries use, not
 * only the branch taken. The previous suite mocked the client wholesale and
 * passed while every query in the file was invalid against the real schema:
 * `packages.barcode` and `orders.contact_*` do not exist (42703), so each
 * lookup 400ed, the error was discarded, and every scan read as
 * "Código no encontrado".
 */

interface Call { table: string; select: string; filters: [string, unknown][] }

function buildClient(responses: { data: unknown; error: { message: string } | null }[]) {
  const calls: Call[] = [];
  let i = 0;
  const from = vi.fn((table: string) => {
    const call: Call = { table, select: '', filters: [] };
    calls.push(call);
    const response = responses[i++] ?? { data: [], error: null };
    const chain = {
      select: vi.fn((s: string) => { call.select = s; return chain; }),
      eq: vi.fn((col: string, val: unknown) => { call.filters.push([col, val]); return chain; }),
      is: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(response)),
    };
    return chain;
  });
  // Only `.from` is exercised; the cast keeps the test free of the full client type.
  return { client: { from } as never, calls };
}

const ORDER_ROW = {
  order_number: 'CARGA-PARIS-001-ORD-106',
  customer_name: 'Mario',
  delivery_address: 'Av Principal 1',
  customer_phone: '+56912345678',
};

const input = { code: 'CARGA-PARIS-001-ORD-106-CTN-1', routeId: 'route-1', operatorId: 'op-1' };

describe('validateScan — query shape', () => {
  beforeEach(() => vi.clearAllMocks());

  it('looks the package up by label, the column that exists', async () => {
    const { client, calls } = buildClient([{ data: [], error: null }, { data: [], error: null }]);
    await validateScan(client, input);
    expect(calls[0].table).toBe('packages');
    expect(calls[0].filters).toContainEqual(['label', input.code]);
    expect(calls[0].filters.map((f) => f[0])).not.toContain('barcode');
  });

  it('embeds the order columns that exist', async () => {
    const { client, calls } = buildClient([{ data: [], error: null }, { data: [], error: null }]);
    await validateScan(client, input);
    expect(calls[0].select).toContain('customer_name');
    expect(calls[0].select).toContain('delivery_address');
    expect(calls[0].select).toContain('customer_phone');
    expect(calls[0].select).not.toContain('contact_name');
  });

  it('surfaces a failing query instead of reporting it as not found', async () => {
    const { client } = buildClient([
      { data: null, error: { message: 'column packages.barcode does not exist' } },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('QUERY_FAILED');
      expect(result.message).toContain('barcode');
    }
  });
});

describe('validateScan — status gate', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * trg_dock_scan_advance_package_status writes 'sectorizado' when a package is
   * sorted onto a delivery andén, so that — not 'asignado' — is the state a
   * package is actually in when it reaches Despacho. Same cohort correction
   * migration 20260817000003 made for the Pre-Ruta board.
   */
  it('accepts a package staged on an andén (sectorizado)', async () => {
    const { client } = buildClient([
      { data: [{ id: 'p1', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW }], error: null },
      { data: [], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.package.order_number).toBe('CARGA-PARIS-001-ORD-106');
      expect(result.package.contact_name).toBe('Mario');
      expect(result.package.contact_address).toBe('Av Principal 1');
      expect(result.package.contact_phone).toBe('+56912345678');
    }
  });

  it.each(DISPATCHABLE_STATUSES)('accepts %s', async (status) => {
    const { client } = buildClient([
      { data: [{ id: 'p1', status, order_id: 'o1', orders: ORDER_ROW }], error: null },
      { data: [], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(true);
  });

  /** A consolidation package has to be re-sorted onto a real andén first. */
  it('rejects retenido with its own message', async () => {
    const { client } = buildClient([
      { data: [{ id: 'p1', status: 'retenido', order_id: 'o1', orders: ORDER_ROW }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('IN_CONSOLIDATION');
      expect(result.message).toMatch(/consolidaci/i);
    }
  });

  it('rejects a package already on the road', async () => {
    const { client } = buildClient([
      { data: [{ id: 'p1', status: 'en_ruta', order_id: 'o1', orders: ORDER_ROW }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_STATUS');
  });
});

describe('validateScan — membership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls back to the order number when no label matches', async () => {
    const { client, calls } = buildClient([
      { data: [], error: null },
      { data: [{ id: 'p1', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW }], error: null },
      { data: [], error: null },
    ]);
    const result = await validateScan(client, { ...input, code: 'CARGA-PARIS-001-ORD-106' });
    expect(calls[1].filters).toContainEqual(['orders.order_number', 'CARGA-PARIS-001-ORD-106']);
    expect(result.ok).toBe(true);
  });

  it('returns NOT_FOUND when neither lookup matches', async () => {
    const { client } = buildClient([{ data: [], error: null }, { data: [], error: null }]);
    const result = await validateScan(client, { ...input, code: 'UNKNOWN-999' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('returns ALREADY_IN_ROUTE when the order is on another route', async () => {
    const { client } = buildClient([
      { data: [{ id: 'p1', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW }], error: null },
      { data: [{ id: 'd1', route_id: 'route-2' }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ALREADY_IN_ROUTE');
  });
});

/**
 * spec-70 phase 2 — the plan/load axis.
 *
 * The membership check used to ask "does a dispatch row exist for this order?"
 * and refuse if so. Pre-ruta creates exactly such a row when it seeds a route,
 * so every scan of a pre-routed package was refused with "Paquete ya asignado a
 * otra ruta activa" — the plan made the load impossible. The question is now
 * "is this order planned on THIS route and not yet staged?".
 */
describe('validateScan — spec-70 stage decisions', () => {
  beforeEach(() => vi.clearAllMocks());

  const PKG = { data: [{ id: 'p1', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW }], error: null };

  it('stages the row Pre-ruta seeded on THIS route — the regression test for the block', async () => {
    const { client } = buildClient([
      PKG,
      { data: [{ id: 'd1', route_id: 'route-1', stage: 'planned', route: { status: 'planned' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toEqual({ kind: 'stage', dispatchId: 'd1' });
  });

  it('adopts a package that was never planned onto this route', async () => {
    const { client } = buildClient([PKG, { data: [], error: null }]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toEqual({ kind: 'adopt' });
  });

  it('refuses a second scan of a stop already staged on this route', async () => {
    const { client } = buildClient([
      PKG,
      { data: [{ id: 'd1', route_id: 'route-1', stage: 'staged', route: { status: 'loading' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ALREADY_STAGED');
  });

  it('refuses an order planned on a different, still-active route', async () => {
    const { client } = buildClient([
      PKG,
      { data: [{ id: 'd9', route_id: 'route-2', stage: 'planned', route: { status: 'loading' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ALREADY_IN_ROUTE');
  });

  /**
   * spec-43 sends a failed delivery back to the hub at `en_bodega` "so the
   * pipeline restarts", but the dispatch row on the old route is never deleted.
   * Under the old rule that row blocked the re-scan permanently, so a returned
   * package could never go out again.
   */
  it.each(['completed', 'cancelled'])(
    'lets an order be re-routed when its only history is a %s route',
    async (status) => {
      const { client } = buildClient([
        PKG,
        { data: [{ id: 'd-old', route_id: 'route-old', stage: 'staged', route: { status } }], error: null },
      ]);
      const result = await validateScan(client, input);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.action).toEqual({ kind: 'adopt' });
    },
  );

  /**
   * A row whose route cannot be resolved is treated as blocking. Guessing the
   * permissive way here would re-open double-routing, which is the more
   * expensive mistake: a package on two trucks is a lost package.
   */
  it('treats a dispatch row with an unresolvable route as blocking', async () => {
    const { client } = buildClient([
      PKG,
      { data: [{ id: 'd9', route_id: 'route-2', stage: 'planned', route: null }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ALREADY_IN_ROUTE');
  });

  it('queries dispatches with the stage column and the route status it needs', async () => {
    const { client, calls } = buildClient([PKG, { data: [], error: null }]);
    await validateScan(client, input);
    const dispatchCall = calls.find((c) => c.table === 'dispatches');
    expect(dispatchCall?.select).toContain('stage');
    expect(dispatchCall?.select).toContain('route_id');
    expect(dispatchCall?.select).toMatch(/routes/);
    expect(dispatchCall?.filters).toContainEqual(['order_id', 'o1']);
    expect(dispatchCall?.filters).toContainEqual(['operator_id', 'op-1']);
  });
});
