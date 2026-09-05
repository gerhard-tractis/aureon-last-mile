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

interface Call { table: string; select: string; filters: [string, unknown][]; order: [string, unknown] | null }

function buildClient(responses: { data: unknown; error: { message: string } | null }[]) {
  const calls: Call[] = [];
  let i = 0;
  const from = vi.fn((table: string) => {
    const call: Call = { table, select: '', filters: [], order: null };
    calls.push(call);
    const response = responses[i++] ?? { data: [], error: null };
    const chain = {
      select: vi.fn((s: string) => { call.select = s; return chain; }),
      eq: vi.fn((col: string, val: unknown) => { call.filters.push([col, val]); return chain; }),
      is: vi.fn(() => chain),
      // spec-74 phase 2 review item 5 — records the ordering the order-number
      // fallback applies, so a test can assert on it directly.
      order: vi.fn((col: string, opts: unknown) => { call.order = [col, opts]; return chain; }),
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

  /**
   * spec-74 phase 2 review item 2 — `loaded_at`/`load_inferred` were
   * stripped from BOTH select strings by a mutation and 56/56 tests still
   * passed: nothing asserted the query actually fetched the columns the
   * ALREADY_STAGED gate reads. In production `found.loaded_at` would be
   * `undefined` there, the gate would never fire, and a box could be
   * scanned repeatedly. Covers both the label lookup AND the order-number
   * fallback — see this suite's mutation proof in the PR/task notes.
   */
  it('selects loaded_at and load_inferred in the label lookup', async () => {
    const { client, calls } = buildClient([{ data: [], error: null }, { data: [], error: null }]);
    await validateScan(client, input);
    expect(calls[0].select).toContain('loaded_at');
    expect(calls[0].select).toContain('load_inferred');
  });

  it('selects loaded_at and load_inferred in the order-number fallback lookup', async () => {
    const { client, calls } = buildClient([
      { data: [], error: null },
      { data: [], error: null },
    ]);
    await validateScan(client, { ...input, code: 'CARGA-PARIS-001-ORD-106' });
    expect(calls[1].table).toBe('packages');
    expect(calls[1].select).toContain('loaded_at');
    expect(calls[1].select).toContain('load_inferred');
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

  /**
   * spec-76 task 3 review, escalated decision. `en_bodega` used to be in
   * `DISPATCHABLE_STATUSES` (accepted); this is a deliberate reversal, not
   * a fix-forward from a passing state — migration 20260817000003's own
   * analysis notes `dock_zone_id IS NOT NULL AND status = 'en_bodega'` are
   * "very nearly mutually exclusive" (the trigger that writes
   * `dock_zone_id` also sets `status = 'sectorizado'` in the same UPDATE),
   * so a package still `en_bodega` genuinely never reached the andén.
   */
  it('rejects en_bodega with its own reason — NOT_ON_DOCK, not the generic WRONG_STATUS', async () => {
    const { client } = buildClient([
      { data: [{ id: 'p1', status: 'en_bodega', order_id: 'o1', orders: ORDER_ROW }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_ON_DOCK');
      expect(result.message).toMatch(/no pasó por andén/i);
    }
  });

  it('en_bodega is no longer in DISPATCHABLE_STATUSES', () => {
    expect((DISPATCHABLE_STATUSES as readonly string[]).includes('en_bodega')).toBe(false);
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

  /**
   * spec-74 phase 2 review item 5 — an order number matches every bulto of
   * that order, not just one. `.limit(1)` with no ordering always returned
   * the SAME row, so scanning an order number twice could never reach the
   * second box. Ordered so an unloaded row sorts first.
   */
  it('orders the order-number fallback by loaded_at, unloaded first', async () => {
    const { client, calls } = buildClient([
      { data: [], error: null },
      { data: [{ id: 'p1', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW }], error: null },
      { data: [], error: null },
    ]);
    await validateScan(client, { ...input, code: 'CARGA-PARIS-001-ORD-106' });
    expect(calls[1].order).toEqual(['loaded_at', { ascending: true, nullsFirst: true }]);
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
    if (!result.ok) {
      expect(result.code).toBe('ALREADY_IN_ROUTE');
      // spec-76 phase 4 (2f) — 2f names the conflicting route ("Ya está en
      // otra ruta · RUT-...") and offers to view it; that needs its id.
      expect(result.conflictingRouteId).toBe('route-2');
    }
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
    if (result.ok) expect(result.action).toEqual({ kind: 'stage', dispatchId: 'd1', currentStage: 'planned' });
  });

  it('adopts a package that was never planned onto this route', async () => {
    const { client } = buildClient([PKG, { data: [], error: null }]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toEqual({ kind: 'adopt' });
  });

  /**
   * spec-74 phase 2. This used to be `onThisRoute.stage !== 'planned'` — a
   * per-DISPATCH (order-level) check. That refused every remaining bulto of
   * a multi-bulto order once the first one flipped the order's single
   * dispatch row to `staged`, with no operator remedy (spec-74's "Why it
   * happens" #3). The gate is now per-PACKAGE: it reads THIS box's own
   * `loaded_at`, not its order's dispatch stage.
   */
  it('refuses a second scan of the SAME package once it is itself loaded', async () => {
    const { client } = buildClient([
      { data: [{ id: 'p1', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW, loaded_at: '2026-08-31T10:00:00Z' }], error: null },
      { data: [{ id: 'd1', route_id: 'route-1', stage: 'staged', route: { status: 'loading' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ALREADY_STAGED');
      expect(result.message).toBe('Paquete ya cargado en esta ruta');
    }
  });

  /**
   * spec-74 phase 2's whole point: the exact QA repro. A 2-bulto order's
   * first box was scanned (its order's one `dispatches` row is now
   * `staged` — see stage-dispatch.ts's documented over-claim), but the
   * SECOND, still-unscanned box (`loaded_at` NULL) must be accepted, not
   * refused as ALREADY_STAGED or WRONG_STATUS.
   */
  it('accepts the second, not-yet-loaded bulto of an order whose dispatch is already staged', async () => {
    const { client } = buildClient([
      { data: [{ id: 'p2', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW, loaded_at: null }], error: null },
      { data: [{ id: 'd1', route_id: 'route-1', stage: 'staged', route: { status: 'loading' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toEqual({ kind: 'stage', dispatchId: 'd1', currentStage: 'staged' });
  });

  /**
   * spec-74 phase 2 review item 1 — the HIGH finding. Phase 1's backfill set
   * `loaded_at`/`load_inferred = true` on every live package of every
   * pre-existing `staged`/`adopted` dispatch, so gating on `loaded_at`
   * alone (the phase-2-as-written behaviour) re-refused every one of those
   * boxes — including the exact box physically on the andén in spec-74's QA
   * repro. An inferred row is an assumption, not evidence of a scan, so it
   * must remain re-scannable.
   */
  it('accepts a re-scan of a package whose loaded_at is only inferred (phase-1 backfill)', async () => {
    const { client } = buildClient([
      {
        data: [{
          id: 'p1', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW,
          loaded_at: '2026-08-31T00:00:00Z', load_inferred: true,
        }],
        error: null,
      },
      { data: [{ id: 'd1', route_id: 'route-1', stage: 'staged', route: { status: 'loading' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toEqual({ kind: 'stage', dispatchId: 'd1', currentStage: 'staged' });
  });

  /**
   * The mirror case: a GENUINE scan (loaded_at set, load_inferred false)
   * must still refuse a second scan of the same box — the fix above must
   * not become "loaded_at is never checked again".
   */
  it('still refuses a re-scan of a package whose loaded_at is a real scan (load_inferred false)', async () => {
    const { client } = buildClient([
      {
        data: [{
          id: 'p1', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW,
          loaded_at: '2026-08-31T10:00:00Z', load_inferred: false,
        }],
        error: null,
      },
      { data: [{ id: 'd1', route_id: 'route-1', stage: 'staged', route: { status: 'loading' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ALREADY_STAGED');
  });

  /**
   * spec-74 phase 2 review item 3 — the dispatch row's CURRENT stage is
   * surfaced on the action so `stageDispatch` can decide whether to write
   * `staged` or preserve `adopted`. An `adopted` dispatch (a sibling bulto
   * scanned after the order was already adopted) must not be silently
   * relabelled `staged` — the "never planned onto this route" fact would
   * then survive only in `adopted_reason`.
   */
  it('surfaces currentStage: adopted for a sibling bulto of an already-adopted order', async () => {
    const { client } = buildClient([
      PKG,
      { data: [{ id: 'd1', route_id: 'route-1', stage: 'adopted', route: { status: 'loading' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toEqual({ kind: 'stage', dispatchId: 'd1', currentStage: 'adopted' });
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
   * spec-77 phase 1b. A `force_split` dispatch row is never deleted — part
   * of the order genuinely travelled with that (now `loaded`) route — but it
   * must NOT keep blocking the released half from being scanned onto a
   * DIFFERENT route. Without this, `force-seal-split.ts`'s whole point
   * ("available to another route") would be false: the box would be
   * released on paper but permanently unscannable everywhere, since the
   * old route's dispatch row is alive and `loaded` is an ACTIVE_ROUTE_STATUS.
   */
  it('lets a force_split order be re-routed — the released half must not stay stuck on the old route', async () => {
    const { client } = buildClient([
      PKG,
      { data: [{ id: 'd-split', route_id: 'route-old', stage: 'force_split', route: { status: 'loaded' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toEqual({ kind: 'adopt' });
  });

  /**
   * spec-77 review (MEDIUM). `ownsTheOrder` treats a `force_split` row as
   * settled for the WHOLE order, but only half of it is settled: the box
   * that already travelled on the old (now `loaded`) route still carries
   * its own genuine `loaded_at` (set, not inferred). Scanning THAT SAME
   * box onto a different route must refuse — same per-package fact the
   * `onThisRoute` branch already reads via ALREADY_STAGED, now also
   * checked on the `adopt` path this scan would otherwise take. Without
   * this, `routes/[id]/scan/route.ts` inserts a live `dispatches` row on
   * the new route and then `advancePackagesToEnCarga` matches nothing
   * (the package's own `loaded_at`/`load_inferred` do not satisfy its
   * `.or('loaded_at.is.null,load_inferred.eq.true')`), throws, and leaves
   * an orphaned `adopted` dispatch behind — a 500 instead of the clean
   * ALREADY_IN_ROUTE this used to return pre-force_split.
   */
  it('refuses (not adopt) when the SAME box of a force_split order already travelled', async () => {
    const { client } = buildClient([
      {
        data: [{
          id: 'p1', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW,
          loaded_at: '2026-09-04T10:00:00Z', load_inferred: false,
        }],
        error: null,
      },
      { data: [{ id: 'd-split', route_id: 'route-old', stage: 'force_split', route: { status: 'loaded' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ALREADY_IN_ROUTE');
      expect(result.conflictingRouteId).toBe('route-old');
    }
  });

  /** The mirror case: the RELEASED box of the same force_split order (its
   * own loaded_at never set) must still adopt cleanly — the fix above must
   * not re-block the very case spec-77 phase 1b exists to unblock. */
  it('still adopts the RELEASED box of a force_split order (its own loaded_at is null)', async () => {
    const { client } = buildClient([
      {
        data: [{
          id: 'p2', status: 'sectorizado', order_id: 'o1', orders: ORDER_ROW,
          loaded_at: null, load_inferred: false,
        }],
        error: null,
      },
      { data: [{ id: 'd-split', route_id: 'route-old', stage: 'force_split', route: { status: 'loaded' } }], error: null },
    ]);
    const result = await validateScan(client, input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.action).toEqual({ kind: 'adopt' });
  });

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
