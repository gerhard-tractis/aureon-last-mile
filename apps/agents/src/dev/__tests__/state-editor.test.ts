// src/dev/__tests__/state-editor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { editTestOrderState } from '../state-editor';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOrderRow(order_number = 'TEST-abc-123') {
  return {
    id: 'ord-uuid-1',
    order_number,
    customer_name: 'Test Customer',
    customer_phone: '+56912345678',
    delivery_date: '2026-04-25',
    status: 'confirmed',
    operator_id: 'op-1',
  };
}

function makeAssignmentRow() {
  return { id: 'assign-uuid-1', order_id: 'ord-uuid-1', status: 'pending' };
}

function makeDispatchRow() {
  return { id: 'dispatch-uuid-1', order_id: 'ord-uuid-1', status: 'pending', estimated_at: null };
}

function makeSessionRow() {
  return { id: 'session-uuid-1', order_id: 'ord-uuid-1', status: 'active', deleted_at: null };
}

/**
 * Creates a self-referential chain that resolves at any terminal method.
 * Supports: eq, is, order, limit, like → return chain
 *           single, maybeSingle → resolve with resolved value
 *           (as Promise) → resolve with listResolved value
 */
function makeChain(opts: {
  singleResolved?: unknown;
  maybeSingleResolved?: unknown;
  listResolved?: unknown[];
} = {}) {
  const chain: Record<string, unknown> = {};
  const selfFn = vi.fn().mockReturnValue(chain);
  chain.eq = selfFn;
  chain.is = selfFn;
  chain.order = selfFn;
  chain.limit = selfFn;
  chain.like = selfFn;
  chain.single = vi.fn().mockResolvedValue({ data: opts.singleResolved ?? null, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: opts.maybeSingleResolved ?? null, error: null });
  // Make chain itself thenable (for cases where result used as Promise directly)
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: opts.listResolved ?? [], error: null }).then(resolve),
  );
  return chain;
}

/**
 * Creates an update chain: .update({}).eq().eq() → resolves { error: null }
 */
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

function makeDb(options: {
  orderExtId?: string | null;
  hasSession?: boolean;
} = {}) {
  const orderRow = options.orderExtId !== undefined
    ? (options.orderExtId ? makeOrderRow(options.orderExtId) : null)
    : makeOrderRow();
  const assignRow = makeAssignmentRow();
  const dispatchRow = makeDispatchRow();
  const sessionRow = options.hasSession ? makeSessionRow() : null;

  const fromCalls: string[] = [];

  return {
    _fromCalls: fromCalls,
    from: vi.fn((table: string) => {
      fromCalls.push(table);

      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnValue(
            makeChain({ singleResolved: orderRow }),
          ),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'assignments') {
        return {
          select: vi.fn().mockReturnValue(
            makeChain({ singleResolved: assignRow, maybeSingleResolved: assignRow }),
          ),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'dispatches') {
        return {
          select: vi.fn().mockReturnValue(
            makeChain({ singleResolved: dispatchRow, maybeSingleResolved: dispatchRow }),
          ),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'customer_sessions') {
        return {
          select: vi.fn().mockReturnValue(
            makeChain({ maybeSingleResolved: sessionRow }),
          ),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'customer_session_messages') {
        return {
          select: vi.fn().mockReturnValue(makeChain({ listResolved: [] })),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'order_reschedules') {
        return {
          select: vi.fn().mockReturnValue(makeChain({ listResolved: [] })),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
        };
      }

      if (table === 'agent_events') {
        return {
          select: vi.fn().mockReturnValue(makeChain({ listResolved: [] })),
        };
      }

      if (table === 'wismo_notifications') {
        return {
          select: vi.fn().mockReturnValue(makeChain({ listResolved: [] })),
          update: vi.fn().mockReturnValue(makeUpdateChain()),
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

describe('editTestOrderState — safety guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws if order is not a test order (order_number does not start with TEST-)', async () => {
    const db = makeDb({ orderExtId: 'ORD-regular-123' });
    await expect(
      editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
        table: 'orders',
        fields: { delivery_date: '2026-04-26' },
      }),
    ).rejects.toThrow(/not a test order/i);
  });

  it('throws if order is not found', async () => {
    const db = makeDb({ orderExtId: null });
    await expect(
      editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
        table: 'orders',
        fields: { delivery_date: '2026-04-26' },
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('editTestOrderState — orders table', () => {
  it('allows updating delivery_date', async () => {
    const db = makeDb();
    const result = await editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
      table: 'orders',
      fields: { delivery_date: '2026-04-26' },
    });
    expect(result).toHaveProperty('snapshot');
  });

  it('allows updating delivery_window_start and delivery_window_end', async () => {
    const db = makeDb();
    const result = await editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
      table: 'orders',
      fields: { delivery_window_start: '09:00', delivery_window_end: '12:00' },
    });
    expect(result).toHaveProperty('snapshot');
  });

  it('allows updating customer_name and customer_phone', async () => {
    const db = makeDb();
    const result = await editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
      table: 'orders',
      fields: { customer_name: 'New Name', customer_phone: '+56911111111' },
    });
    expect(result).toHaveProperty('snapshot');
  });

  it('rejects disallowed order fields', async () => {
    const db = makeDb();
    await expect(
      editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
        table: 'orders',
        fields: { status: 'delivered', operator_id: 'hacker' },
      }),
    ).rejects.toThrow(/not allowed/i);
  });

  it('rejects empty fields object for orders', async () => {
    const db = makeDb();
    await expect(
      editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
        table: 'orders',
        fields: {},
      }),
    ).rejects.toThrow(/no valid fields/i);
  });
});

describe('editTestOrderState — assignments table', () => {
  it('allows updating assignment status', async () => {
    const db = makeDb();
    const result = await editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
      table: 'assignments',
      fields: { status: 'delivered' },
    });
    expect(result).toHaveProperty('snapshot');
    expect(db._fromCalls).toContain('assignments');
  });

  it('rejects disallowed assignment fields', async () => {
    const db = makeDb();
    await expect(
      editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
        table: 'assignments',
        fields: { driver_id: 'hacker-uuid' },
      }),
    ).rejects.toThrow(/not allowed/i);
  });
});

describe('editTestOrderState — dispatches table', () => {
  it('allows updating dispatch estimated_at', async () => {
    const db = makeDb();
    const result = await editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
      table: 'dispatches',
      fields: { estimated_at: '14:30' },
    });
    expect(result).toHaveProperty('snapshot');
    expect(db._fromCalls).toContain('dispatches');
  });

  it('allows updating dispatch status', async () => {
    const db = makeDb();
    const result = await editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
      table: 'dispatches',
      fields: { status: 'en_route' },
    });
    expect(result).toHaveProperty('snapshot');
  });
});

describe('editTestOrderState — reset_session', () => {
  it('soft-deletes active session and messages when session exists', async () => {
    const db = makeDb({ hasSession: true });
    const result = await editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
      table: 'reset_session',
      fields: {},
    });
    expect(result).toHaveProperty('snapshot');
    expect(db._fromCalls).toContain('customer_sessions');
    expect(db._fromCalls).toContain('customer_session_messages');
  });

  it('succeeds gracefully when no active session exists', async () => {
    const db = makeDb({ hasSession: false });
    const result = await editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
      table: 'reset_session',
      fields: {},
    });
    expect(result).toHaveProperty('snapshot');
  });
});

describe('editTestOrderState — unknown table', () => {
  it('throws for unknown table name', async () => {
    const db = makeDb();
    await expect(
      editTestOrderState(db as never, 'op-1', 'ord-uuid-1', {
        table: 'unknown_table' as never,
        fields: {},
      }),
    ).rejects.toThrow(/unknown table/i);
  });
});
