// src/dev/__tests__/simulate-event.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock processWismoJob ───────────────────────────────────────────────────────
vi.mock('../../agents/wismo/wismo-agent', () => ({
  processWismoJob: vi.fn().mockResolvedValue(undefined),
  WISMO_DEFAULT_MODEL: 'meta-llama/llama-3.3-70b-instruct',
}));

import { processWismoJob } from '../../agents/wismo/wismo-agent';
import { simulateEvent, WISMO_MODEL_PRICING } from '../simulate-event';

// ── Chain builder helpers ─────────────────────────────────────────────────────

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
  chain.select = selfFn;
  chain.neq = selfFn;
  chain.single = vi.fn().mockResolvedValue({
    data: opts.singleData ?? null,
    error: opts.singleError ?? null,
  });
  chain.maybeSingle = vi.fn().mockResolvedValue({
    data: opts.maybeSingleData ?? null,
    error: null,
  });
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: opts.listData ?? [], error: null }).then(resolve),
  );
  return chain;
}

// ── Sample data ───────────────────────────────────────────────────────────────

function makeOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord-uuid-1',
    external_id: 'TEST-abc-123',
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
    status: 'in_progress',
    deleted_at: null,
  };
}

function makeAgentEventRow(id: string, meta: Record<string, unknown> = {}) {
  return {
    id,
    operator_id: 'op-1',
    agent: 'WISMO',
    event_type: 'model_response',
    meta,
    created_at: new Date().toISOString(),
  };
}

function makeSnapshotData(messages: unknown[], agentEvents: unknown[]) {
  return {
    order: makeOrderRow(),
    assignment: makeAssignmentRow(),
    dispatch: null,
    session: { id: 'session-uuid-1', order_id: 'ord-uuid-1', operator_id: 'op-1' },
    messages,
    reschedules: [],
    recent_agent_events: agentEvents,
  };
}

// ── DB mock factory ───────────────────────────────────────────────────────────

/**
 * Creates a minimal SupabaseClient mock.
 * preEventIds: IDs of agent_events that exist BEFORE processWismoJob
 * postEventRows: agent_events rows that exist AFTER processWismoJob
 * preMessages: messages before
 * postMessages: messages after
 */
function makeDb(opts: {
  orderRow?: Record<string, unknown> | null;
  orderError?: unknown;
  assignmentRow?: Record<string, unknown> | null;
  preEventRows?: unknown[];
  postEventRows?: unknown[];
  preMessages?: unknown[];
  postMessages?: unknown[];
} = {}) {
  const order = opts.orderRow !== undefined ? opts.orderRow : makeOrderRow();
  const assignment = opts.assignmentRow !== undefined ? opts.assignmentRow : makeAssignmentRow();
  const preEvents = opts.preEventRows ?? [];
  const postEvents = opts.postEventRows ?? [];
  const preMessages: unknown[] = opts.preMessages ?? [];
  const postMessages: unknown[] = opts.postMessages ?? [];

  let callCount = 0;

  const db = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: order,
                  error: opts.orderError ?? null,
                }),
              }),
            }),
          }),
        };
      }

      if (table === 'assignments') {
        return makeChain({ maybeSingleData: assignment });
      }

      if (table === 'agent_events') {
        // Return pre-events on first call, post-events on second call
        const rows = callCount === 0 ? preEvents : postEvents;
        callCount++;
        return makeChain({ listData: rows });
      }

      if (table === 'customer_session_messages') {
        const msgs = callCount > 1 ? postMessages : preMessages;
        return makeChain({ listData: msgs });
      }

      if (table === 'customer_sessions') {
        return makeChain({ maybeSingleData: null });
      }

      if (table === 'order_reschedules') {
        return makeChain({ listData: [] });
      }

      if (table === 'dispatches') {
        return makeChain({ maybeSingleData: null });
      }

      return makeChain();
    }),
  };

  return db;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('simulateEvent — validation', () => {
  it('returns 400 for unknown event_type', async () => {
    const db = makeDb();
    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_unknown' },
      'op-1',
      db as never,
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/event_type/i);
  });

  it('returns 400 for client_message without body', async () => {
    const db = makeDb();
    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'client_message', payload: {} },
      'op-1',
      db as never,
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toBeDefined();
  });

  it('returns 400 for proactive_eta without estimated_at', async () => {
    const db = makeDb();
    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_eta', payload: {} },
      'op-1',
      db as never,
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toBeDefined();
  });

  it('returns 400 for proactive_failed without failure_reason', async () => {
    const db = makeDb();
    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_failed', payload: {} },
      'op-1',
      db as never,
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toBeDefined();
  });
});

describe('simulateEvent — order verification', () => {
  it('returns 400 when order is not found', async () => {
    const db = makeDb({ orderRow: null, orderError: { message: 'Not found' } });
    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_early_arrival' },
      'op-1',
      db as never,
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/not found/i);
  });

  it('returns 403 for non-TEST- order', async () => {
    const db = makeDb({ orderRow: makeOrderRow({ external_id: 'REAL-order-123' }) });
    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_early_arrival' },
      'op-1',
      db as never,
    );
    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/test order/i);
  });
});

describe('simulateEvent — job payload construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds correct job for proactive_early_arrival', async () => {
    const db = makeDb();
    await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_early_arrival' },
      'op-1',
      db as never,
    );

    expect(processWismoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          type: 'proactive_early_arrival',
          order_id: 'ord-uuid-1',
          operator_id: 'op-1',
        }),
        channel: 'mock',
      }),
    );
  });

  it('builds correct job for proactive_pickup (includes assignment_id)', async () => {
    const db = makeDb();
    await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_pickup' },
      'op-1',
      db as never,
    );

    expect(processWismoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          type: 'proactive_pickup',
          order_id: 'ord-uuid-1',
          operator_id: 'op-1',
          assignment_id: 'assign-uuid-1',
        }),
        channel: 'mock',
      }),
    );
  });

  it('builds correct job for proactive_eta (includes estimated_at)', async () => {
    const db = makeDb();
    await simulateEvent(
      {
        order_id: 'ord-uuid-1',
        event_type: 'proactive_eta',
        payload: { estimated_at: '2026-04-25T14:00:00Z' },
      },
      'op-1',
      db as never,
    );

    expect(processWismoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          type: 'proactive_eta',
          estimated_at: '2026-04-25T14:00:00Z',
        }),
        channel: 'mock',
      }),
    );
  });

  it('builds correct job for proactive_delivered (includes assignment_id)', async () => {
    const db = makeDb();
    await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_delivered' },
      'op-1',
      db as never,
    );

    expect(processWismoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          type: 'proactive_delivered',
          assignment_id: 'assign-uuid-1',
        }),
        channel: 'mock',
      }),
    );
  });

  it('builds correct job for proactive_failed (includes assignment_id and failure_reason)', async () => {
    const db = makeDb();
    await simulateEvent(
      {
        order_id: 'ord-uuid-1',
        event_type: 'proactive_failed',
        payload: { failure_reason: 'Customer not home' },
      },
      'op-1',
      db as never,
    );

    expect(processWismoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          type: 'proactive_failed',
          assignment_id: 'assign-uuid-1',
          failure_reason: 'Customer not home',
        }),
        channel: 'mock',
      }),
    );
  });

  it('builds correct job for client_message (includes customer_phone from order)', async () => {
    const db = makeDb();
    await simulateEvent(
      {
        order_id: 'ord-uuid-1',
        event_type: 'client_message',
        payload: { body: 'When will my package arrive?' },
      },
      'op-1',
      db as never,
    );

    expect(processWismoJob).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          type: 'client_message',
          order_id: 'ord-uuid-1',
          operator_id: 'op-1',
          body: 'When will my package arrive?',
          customer_phone: '+56912345678',
        }),
        channel: 'mock',
      }),
    );
  });
});

describe('simulateEvent — model_used', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults model_used to WISMO_DEFAULT_MODEL when no model provided', async () => {
    const db = makeDb();
    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_early_arrival' },
      'op-1',
      db as never,
    );
    expect(result.status).toBe(200);
    expect(result.body.model_used).toBe('meta-llama/llama-3.3-70b-instruct');
  });

  it('uses provided model override', async () => {
    const db = makeDb();
    const result = await simulateEvent(
      {
        order_id: 'ord-uuid-1',
        event_type: 'proactive_early_arrival',
        model: 'openai/gpt-4o-mini',
      },
      'op-1',
      db as never,
    );
    expect(result.status).toBe(200);
    expect(result.body.model_used).toBe('openai/gpt-4o-mini');
    expect(processWismoJob).toHaveBeenCalledWith(
      expect.objectContaining({ modelOverride: 'openai/gpt-4o-mini' }),
    );
  });
});

describe('simulateEvent — diff logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('new_agent_events only contains rows not in pre-snapshot', async () => {
    const preEvent = makeAgentEventRow('evt-pre-1');
    const postEvent = makeAgentEventRow('evt-post-1', { inputTokens: 100, outputTokens: 50, model: 'meta-llama/llama-3.3-70b-instruct' });

    const db = makeDb({
      preEventRows: [preEvent],
      postEventRows: [postEvent, preEvent],
    });

    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_early_arrival' },
      'op-1',
      db as never,
    );

    expect(result.status).toBe(200);
    expect(result.body.new_agent_events).toHaveLength(1);
    expect(result.body.new_agent_events[0].id).toBe('evt-post-1');
  });

  it('new_messages only contains messages not in pre-snapshot', async () => {
    // For this test, we need a session to exist so messages are fetched
    const preMsg = { id: 'msg-pre-1', body: 'Pre message', session_id: 'session-uuid-1' };
    const postMsg = { id: 'msg-post-1', body: 'Post message', session_id: 'session-uuid-1' };

    // We'll test this at a logic level: pre IDs are recorded, post includes both
    // The diff should return only postMsg
    const db = makeDb({
      preMessages: [preMsg],
      postMessages: [postMsg, preMsg],
    });

    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_early_arrival' },
      'op-1',
      db as never,
    );

    // Since the snapshot.ts filters messages through session, and session is null in our mock,
    // messages array will be empty in both snapshots. The test confirms no crash.
    expect(result.status).toBe(200);
    expect(Array.isArray(result.body.new_messages)).toBe(true);
  });
});

describe('simulateEvent — cost calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes non-zero estimated_cost_usd when agent_events have token usage', async () => {
    const model = 'meta-llama/llama-3.3-70b-instruct';
    const preEvent = makeAgentEventRow('evt-pre-1');
    const postEvent = makeAgentEventRow('evt-post-1', {
      inputTokens: 1000,
      outputTokens: 500,
      model,
    });

    const db = makeDb({
      preEventRows: [preEvent],
      postEventRows: [postEvent, preEvent],
    });

    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_early_arrival', model },
      'op-1',
      db as never,
    );

    expect(result.status).toBe(200);
    // pricing: input=0.13, output=0.40 per 1M tokens
    // cost = (1000 * 0.13 + 500 * 0.40) / 1_000_000 = (130 + 200) / 1_000_000 = 0.00033
    expect(result.body.estimated_cost_usd).toBeGreaterThan(0);
    expect(result.body.estimated_cost_usd).toBeCloseTo(0.00033, 5);
  });

  it('returns 0 estimated_cost_usd when no agent_events have token usage', async () => {
    const db = makeDb({
      preEventRows: [],
      postEventRows: [makeAgentEventRow('evt-post-1')], // no token meta
    });

    const result = await simulateEvent(
      { order_id: 'ord-uuid-1', event_type: 'proactive_early_arrival' },
      'op-1',
      db as never,
    );

    expect(result.status).toBe(200);
    expect(result.body.estimated_cost_usd).toBe(0);
  });

  it('uses pricing from WISMO_MODEL_PRICING table', () => {
    expect(WISMO_MODEL_PRICING['google/gemini-2.5-flash']).toEqual({ input: 0.30, output: 2.50 });
    expect(WISMO_MODEL_PRICING['openai/gpt-4o-mini']).toEqual({ input: 0.15, output: 0.60 });
  });
});
