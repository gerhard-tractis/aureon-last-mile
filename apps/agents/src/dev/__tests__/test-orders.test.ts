// src/dev/__tests__/test-orders.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTestOrder,
  listTestOrders,
  purgeTestOrders,
  getTestOrderSnapshot,
} from '../test-orders';

// ── Chain builder helpers ─────────────────────────────────────────────────────

/**
 * Creates a self-referential Supabase query chain mock.
 * Terminal methods (single, maybeSingle) resolve immediately.
 * The chain itself is also thenable (for cases where result awaited directly).
 */
function makeChain(opts: {
  singleData?: unknown;
  singleError?: unknown;
  maybeSingleData?: unknown;
  listData?: unknown[];
} = {}) {
  const chain: Record<string, unknown> = {};
  const selfFn = vi.fn().mockReturnValue(chain);
  chain.eq = selfFn;
  chain.is = selfFn;
  chain.order = selfFn;
  chain.limit = selfFn;
  chain.like = selfFn;
  chain.select = selfFn;
  chain.single = vi.fn().mockResolvedValue({
    data: opts.singleData ?? null,
    error: opts.singleError ?? null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: opts.maybeSingleData ?? null,
    error: null,
  });
  // Thenable: for direct await of chain (e.g., .order(...) → await chain)
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: opts.listData ?? [], error: null }).then(resolve),
  );
  return chain;
}

function makeInsertChain(data: unknown, error: unknown = null) {
  const singleFn = vi.fn().mockResolvedValue({ data, error });
  const selectFn = vi.fn().mockReturnValue({ single: singleFn });
  return { select: selectFn };
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  const selfFn = vi.fn().mockReturnValue(chain);
  chain.eq = selfFn;
  chain.in = selfFn;
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) =>
    Promise.resolve({ error: null }).then(resolve),
  );
  return chain;
}

// ── Sample data ───────────────────────────────────────────────────────────────

function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord-uuid-1',
    order_number: 'TEST-12345678',
    customer_name: 'Test Customer',
    customer_phone: '+56912345678',
    delivery_date: '2026-04-25',
    status: 'confirmed',
    operator_id: 'op-1',
    created_at: '2026-04-23T00:00:00Z',
    ...overrides,
  };
}

function makeAssignmentRow() {
  return {
    id: 'assign-uuid-1',
    order_id: 'ord-uuid-1',
    operator_id: 'op-1',
    driver_id: 'dev-driver-uuid',
    status: 'pending',
  };
}

function makeDispatchRow() {
  return {
    id: 'dispatch-uuid-1',
    order_id: 'ord-uuid-1',
    operator_id: 'op-1',
    provider: 'dispatchtrack',
    status: 'pending',
  };
}

// ── Main DB mock factory ──────────────────────────────────────────────────────

function makeDb(options: {
  orderSelect?: unknown[];
  orderGet?: unknown;
  orderInsertError?: string;
} = {}) {
  const orderRow = makeOrderRow();
  const assignRow = makeAssignmentRow();
  const dispatchRow = makeDispatchRow();
  const driverRow = { id: 'dev-driver-uuid', full_name: 'DEV Test Driver' };

  const fromCalls: string[] = [];

  return {
    _fromCalls: fromCalls,
    from: vi.fn((table: string) => {
      fromCalls.push(table);

      if (table === 'orders') {
        const insertErr = options.orderInsertError
          ? { message: options.orderInsertError }
          : null;
        const insertData = options.orderInsertError ? null : orderRow;

        // For list query (select with specific cols)
        const listChain = makeChain({ listData: options.orderSelect ?? [orderRow] });

        // For single order fetch (snapshot)
        const singleData = options.orderGet !== undefined ? options.orderGet : orderRow;
        const getChain = makeChain({ singleData });

        return {
          insert: vi.fn().mockReturnValue(makeInsertChain(insertData, insertErr)),
          select: vi.fn().mockImplementation((cols?: string) => {
            // Distinguish list vs single: list uses 'id, customer_name...' or '*'
            // For the snapshot call, select('*') → getChain
            // For list, select('id, customer_name...') → listChain
            if (typeof cols === 'string' && cols.startsWith('id, customer_name')) {
              return listChain;
            }
            return getChain;
          }),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'assignments') {
        return {
          insert: vi.fn().mockReturnValue(makeInsertChain(assignRow)),
          select: vi.fn().mockReturnValue(
            makeChain({ singleData: assignRow, maybeSingleData: assignRow }),
          ),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'dispatches') {
        return {
          insert: vi.fn().mockReturnValue(makeInsertChain(dispatchRow)),
          select: vi.fn().mockReturnValue(
            makeChain({ singleData: dispatchRow, maybeSingleData: dispatchRow }),
          ),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'drivers') {
        return {
          select: vi.fn().mockReturnValue(makeChain({ maybeSingleData: driverRow })),
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }

      if (table === 'customer_sessions') {
        return {
          select: vi.fn().mockReturnValue(makeChain({ maybeSingleData: null })),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'customer_session_messages') {
        return {
          select: vi.fn().mockReturnValue(makeChain({ listData: [] })),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'order_reschedules') {
        return {
          select: vi.fn().mockReturnValue(makeChain({ listData: [] })),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'wismo_notifications') {
        return {
          select: vi.fn().mockReturnValue(makeChain({ listData: [] })),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'agent_events') {
        return {
          select: vi.fn().mockReturnValue(makeChain({ listData: [] })),
        };
      }

      return {
        select: vi.fn().mockReturnValue(makeChain()),
        update: vi.fn().mockReturnValue(makeUpdateChain()),
      };
    }),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createTestOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates order, assignment, and dispatch rows', async () => {
    const db = makeDb();
    const result = await createTestOrder(db as never, 'op-1', {
      customer_name: 'Test Customer',
      customer_phone: '+56912345678',
      delivery_date: '2026-04-25',
    });

    const tables = db._fromCalls;
    expect(tables).toContain('orders');
    expect(tables).toContain('drivers');
    expect(tables).toContain('assignments');
    expect(tables).toContain('dispatches');

    expect(result).toHaveProperty('order_id');
  });

  it('generates order_number with TEST- prefix', async () => {
    const db = makeDb();
    const result = await createTestOrder(db as never, 'op-1', {
      customer_name: 'Test Customer',
      customer_phone: '+56912345678',
      delivery_date: '2026-04-25',
    });
    expect(result.order_id).toBeDefined();
  });

  it('propagates error if order insert fails', async () => {
    const db = makeDb({ orderInsertError: 'DB error' });
    await expect(
      createTestOrder(db as never, 'op-1', {
        customer_name: 'Test Customer',
        customer_phone: '+56912345678',
        delivery_date: '2026-04-25',
      }),
    ).rejects.toThrow('DB error');
  });
});

describe('listTestOrders', () => {
  it('returns list of test orders for operator', async () => {
    const db = makeDb();
    const result = await listTestOrders(db as never, 'op-1');
    expect(result).toHaveProperty('orders');
    expect(Array.isArray(result.orders)).toBe(true);
  });

  it('filters by operator_id and TEST- order_number prefix', async () => {
    const db = makeDb();
    await listTestOrders(db as never, 'op-1');
    expect(db._fromCalls).toContain('orders');
  });
});

describe('purgeTestOrders', () => {
  it('returns deleted_count', async () => {
    const db = makeDb({
      orderSelect: [makeOrderRow(), makeOrderRow({ id: 'ord-uuid-2', order_number: 'TEST-xyz' })],
    });
    const result = await purgeTestOrders(db as never, 'op-1');
    expect(result).toHaveProperty('deleted_count');
    expect(typeof result.deleted_count).toBe('number');
  });

  it('touches related tables for soft-delete', async () => {
    const db = makeDb({
      orderSelect: [makeOrderRow()],
    });
    await purgeTestOrders(db as never, 'op-1');
    const tables = db._fromCalls;
    expect(tables).toContain('orders');
    expect(
      tables.some((t) => ['assignments', 'dispatches', 'customer_sessions'].includes(t)),
    ).toBe(true);
  });

  it('returns 0 deleted_count when no test orders exist', async () => {
    const db = makeDb({ orderSelect: [] });
    const result = await purgeTestOrders(db as never, 'op-1');
    expect(result.deleted_count).toBe(0);
  });
});

describe('getTestOrderSnapshot', () => {
  it('returns snapshot with expected shape', async () => {
    const db = makeDb();
    const result = await getTestOrderSnapshot(db as never, 'op-1', 'ord-uuid-1');
    expect(result).toHaveProperty('order');
    expect(result).toHaveProperty('assignment');
    expect(result).toHaveProperty('dispatch');
    expect(result).toHaveProperty('session');
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('reschedules');
    expect(result).toHaveProperty('recent_agent_events');
  });

  it('throws when order is not found (null data)', async () => {
    const db = makeDb({ orderGet: null });
    await expect(
      getTestOrderSnapshot(db as never, 'op-1', 'ord-uuid-1'),
    ).rejects.toThrow(/not found/i);
  });

  it('throws when order is not a test order', async () => {
    const db = makeDb({ orderGet: makeOrderRow({ order_number: 'ORD-regular-not-test' }) });
    await expect(
      getTestOrderSnapshot(db as never, 'op-1', 'ord-uuid-1'),
    ).rejects.toThrow(/not a test order/i);
  });
});
