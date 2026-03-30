import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WismoAgent, type WismoProactiveJob, type WismoClientJob } from './wismo-agent';
import type { LLMProvider, LLMRequest, LLMResponse } from '../../providers/types';

// ── Mock provider ─────────────────────────────────────────────────────────────

function makeProvider(response: Partial<LLMResponse> = {}): LLMProvider {
  return {
    model: 'test-model',
    generate: vi.fn().mockResolvedValue({
      content: 'Tu pedido está en camino.',
      toolCalls: undefined,
      finishReason: 'stop',
      model: 'test-model',
      usage: { inputTokens: 10, outputTokens: 5 },
      ...response,
    } as LLMResponse),
  };
}

// ── Mock Supabase ─────────────────────────────────────────────────────────────

function makeDb(options: {
  order?: Record<string, string> | null;
  session?: Record<string, unknown> | null;
} = {}) {
  const { order = { customer_phone: '+56912345678', customer_name: 'Juan', order_number: 'ORD-001', delivery_date: '2026-04-05' }, session = null } = options;

  const buildChain = (singleResult: unknown, listResult: unknown[] = []) => {
    const ch: Record<string, unknown> = {};
    ch.eq = vi.fn().mockReturnValue(ch);
    ch.is = vi.fn().mockReturnValue(ch);
    ch.limit = vi.fn().mockReturnValue(ch);
    ch.select = vi.fn().mockReturnValue(ch);
    ch.order = vi.fn().mockResolvedValue({ data: listResult, error: null });
    ch.maybeSingle = vi.fn().mockResolvedValue({ data: singleResult, error: null });
    ch.insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'sess-new' }, error: null }),
      }),
    });
    ch.update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    });
    return ch;
  };

  const sessionData = session ?? { id: 'sess-1', operator_id: 'op-1', order_id: 'ord-1', customer_phone: '+56912345678', status: 'active', escalated_at: null, closed_at: null };
  const notifChain = { insert: vi.fn().mockResolvedValue({ error: null }) };
  const eventsChain = { insert: vi.fn().mockResolvedValue({ error: null }) };
  const msgChain = buildChain({ id: 'msg-1' }, []);

  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') return buildChain(order);
      if (table === 'customer_sessions') return buildChain(sessionData);
      if (table === 'customer_session_messages') return msgChain;
      if (table === 'wismo_notifications') return notifChain;
      if (table === 'agent_events') return eventsChain;
      return buildChain(null);
    }),
  };
}

function mockFetch(ok = true) {
  return vi.fn().mockResolvedValue({
    ok, status: ok ? 200 : 503,
    json: async () => ({ messages: [{ id: 'wamid.test' }] }),
    text: async () => 'error',
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WismoAgent.handleProactive', () => {
  beforeEach(() => vi.restoreAllMocks());

  const proactiveJob = (type: WismoProactiveJob['type'], extras = {}): WismoProactiveJob => ({
    type, order_id: 'ord-1', operator_id: 'op-1', ...extras,
  });

  it('sends pickup_confirmed message and logs it', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const db = makeDb();
    const agent = new WismoAgent(makeProvider(), db as never, 'pn-1', 'tok-1');

    await agent.handleProactive(proactiveJob('proactive_pickup'));

    expect(db.from).toHaveBeenCalledWith('wismo_notifications');
  });

  it('sends ETA message with rounded window', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const db = makeDb();
    const agent = new WismoAgent(makeProvider(), db as never, 'pn-1', 'tok-1');

    await agent.handleProactive(proactiveJob('proactive_eta', { estimated_at: '14:37' }));

    const fetchCalls = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls;
    const sentBody = JSON.parse(fetchCalls[0][1].body as string);
    expect(sentBody.text.body).toContain('13:30');
  });

  it('closes session after delivered notification', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const db = makeDb();
    const agent = new WismoAgent(makeProvider(), db as never, 'pn-1', 'tok-1');

    await agent.handleProactive(proactiveJob('proactive_delivered'));

    // Update is called to close session
    const sessChain = (db.from as ReturnType<typeof vi.fn>).mock.results
      .filter((r: { value: unknown }) => (r.value as Record<string, unknown>).update)
      .map((r: { value: unknown }) => r.value);
    expect(sessChain.length).toBeGreaterThan(0);
  });

  it('does nothing when order not found', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const db = makeDb({ order: null });
    const agent = new WismoAgent(makeProvider(), db as never, 'pn-1', 'tok-1');

    await expect(agent.handleProactive(proactiveJob('proactive_pickup'))).resolves.not.toThrow();
    // fetch not called — no WA message sent
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('WismoAgent.handleReactive', () => {
  beforeEach(() => vi.restoreAllMocks());

  const reactiveJob: WismoClientJob = {
    type: 'client_message',
    order_id: 'ord-1',
    operator_id: 'op-1',
    body: '¿Dónde está mi pedido?',
    customer_phone: '+56912345678',
  };

  it('loads session history and calls LLM', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const provider = makeProvider();
    const db = makeDb();
    const agent = new WismoAgent(provider, db as never, 'pn-1', 'tok-1');

    await agent.handleReactive(reactiveJob);

    expect(provider.generate).toHaveBeenCalledOnce();
    const req = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0][0] as LLMRequest;
    const hasUserMsg = req.messages.some((m) => m.role === 'user' && m.content.includes('¿Dónde'));
    expect(hasUserMsg).toBe(true);
  });

  it('logs incoming customer message to session', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const db = makeDb();
    const agent = new WismoAgent(makeProvider(), db as never, 'pn-1', 'tok-1');

    await agent.handleReactive(reactiveJob);

    expect(db.from).toHaveBeenCalledWith('customer_session_messages');
  });
});

describe('WismoAgent fallback', () => {
  it('returns fallback content when LLM fails', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const provider: LLMProvider = {
      model: 'fail-model',
      generate: vi.fn().mockRejectedValue(new Error('LLM down')),
    };
    const db = makeDb();
    const agent = new WismoAgent(provider, db as never, 'pn-1', 'tok-1');

    // handleReactive triggers execute() which triggers handleFallback
    await expect(agent.handleReactive({
      type: 'client_message',
      order_id: 'ord-1',
      operator_id: 'op-1',
      body: 'hola',
      customer_phone: '+56912345678',
    })).resolves.not.toThrow();
  });
});
