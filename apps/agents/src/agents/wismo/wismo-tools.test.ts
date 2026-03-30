import { describe, it, expect, vi } from 'vitest';
import { roundEtaToWindow, createWismoTools } from './wismo-tools';
import type { AgentContext } from '../base-agent';

// ── roundEtaToWindow ──────────────────────────────────────────────────────────

describe('roundEtaToWindow', () => {
  it('rounds 14:37 → window 13:30–15:30', () => {
    expect(roundEtaToWindow('14:37')).toBe('entre las 13:30 y 15:30');
  });

  it('rounds 14:00 → window 13:00–15:00', () => {
    expect(roundEtaToWindow('14:00')).toBe('entre las 13:00 y 15:00');
  });

  it('rounds 08:20 → window 07:30–09:30', () => {
    expect(roundEtaToWindow('08:20')).toBe('entre las 07:30 y 09:30');
  });

  it('handles ISO datetime string', () => {
    const result = roundEtaToWindow('2026-03-30T14:37:00Z');
    expect(result).toBe('entre las 13:30 y 15:30');
  });

  it('rounds 00:10 → 00:00 → window 23:00–01:00', () => {
    const result = roundEtaToWindow('00:10');
    expect(result).toContain('entre las');
  });
});

// ── Tool definitions ──────────────────────────────────────────────────────────

const ctx: AgentContext = { operator_id: 'op-1', job_id: 'job-1' };

function makeDbWithSession(session = { id: 'sess-1', operator_id: 'op-1', order_id: 'ord-1', customer_phone: '+56912345678', customer_name: null, status: 'active', escalated_at: null, closed_at: null, created_at: '2026-03-30T00:00:00Z', updated_at: '2026-03-30T00:00:00Z' }) {
  const singleFn = vi.fn().mockResolvedValue({ data: session, error: null });
  const maybeSingleFn = vi.fn().mockResolvedValue({ data: null, error: null });
  const chain: Record<string, unknown> = {};
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = maybeSingleFn;
  chain.insert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleFn }) });
  chain.select = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) });
  chain.order = vi.fn().mockResolvedValue({ data: [], error: null });

  const eventsChain: Record<string, unknown> = {};
  eventsChain.insert = vi.fn().mockResolvedValue({ error: null });

  const orderChain: Record<string, unknown> = {};
  orderChain.eq = vi.fn().mockReturnValue(orderChain);
  orderChain.maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'ord-1', status: 'active' }, error: null });

  const msgChain: Record<string, unknown> = {};
  msgChain.eq = vi.fn().mockReturnValue(msgChain);
  msgChain.is = vi.fn().mockReturnValue(msgChain);
  msgChain.order = vi.fn().mockResolvedValue({ data: [], error: null });
  msgChain.insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'msg-1', body: 'hi', role: 'system' }, error: null }),
    }),
  });

  const rescheduleChain: Record<string, unknown> = {};
  rescheduleChain.insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 're-1', reason: 'not_home' }, error: null }),
    }),
  });

  return {
    from: vi.fn((table: string) => {
      if (table === 'agent_events') return eventsChain;
      if (table === 'orders') return orderChain;
      if (table === 'customer_session_messages') return msgChain;
      if (table === 'order_reschedules') return rescheduleChain;
      return chain; // customer_sessions
    }),
  };
}

function makeFetch(wamid = 'wamid.x') {
  return vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ messages: [{ id: wamid }] }),
  });
}

describe('createWismoTools', () => {
  it('returns 6 named tools', () => {
    const db = makeDbWithSession();
    const tools = createWismoTools({ db: db as never, waPhoneNumberId: 'pn-1', waAccessToken: 'tok-1' });
    expect(tools).toHaveLength(6);
    const names = tools.map((t) => t.name);
    expect(names).toContain('create_or_get_session');
    expect(names).toContain('get_session_history');
    expect(names).toContain('get_order_status');
    expect(names).toContain('send_customer_message');
    expect(names).toContain('capture_reschedule');
    expect(names).toContain('escalate_to_human');
  });

  it('create_or_get_session executes without error', async () => {
    const db = makeDbWithSession();
    const tools = createWismoTools({ db: db as never, waPhoneNumberId: 'pn-1', waAccessToken: 'tok-1' });
    const tool = tools.find((t) => t.name === 'create_or_get_session')!;
    const result = await tool.execute({ order_id: 'ord-1', customer_phone: '+56912345678' }, ctx);
    expect(result).toHaveProperty('id');
  });

  it('send_customer_message sends WA message and logs to session', async () => {
    vi.stubGlobal('fetch', makeFetch());
    const db = makeDbWithSession();
    const tools = createWismoTools({ db: db as never, waPhoneNumberId: 'pn-1', waAccessToken: 'tok-1' });
    const tool = tools.find((t) => t.name === 'send_customer_message')!;
    const result = await tool.execute(
      { session_id: 'sess-1', customer_phone: '+56912345678', body: 'Tu pedido fue recogido.', action_taken: 'pickup_notified' },
      ctx,
    ) as Record<string, unknown>;
    expect(result.external_message_id).toBe('wamid.x');
    vi.unstubAllGlobals();
  });

  it('capture_reschedule inserts reschedule row', async () => {
    const db = makeDbWithSession();
    const tools = createWismoTools({ db: db as never, waPhoneNumberId: 'pn-1', waAccessToken: 'tok-1' });
    const tool = tools.find((t) => t.name === 'capture_reschedule')!;
    const result = await tool.execute(
      { order_id: 'ord-1', reason: 'not_home', requested_date: '2026-04-02' },
      ctx,
    ) as Record<string, unknown>;
    expect(result.id).toBe('re-1');
  });

  it('escalate_to_human updates session status', async () => {
    const db = makeDbWithSession();
    const tools = createWismoTools({ db: db as never, waPhoneNumberId: 'pn-1', waAccessToken: 'tok-1' });
    const tool = tools.find((t) => t.name === 'escalate_to_human')!;
    const result = await tool.execute({ session_id: 'sess-1', reason: 'address_change' }, ctx) as Record<string, unknown>;
    expect(result.escalated).toBe(true);
  });

  it('all tools have required parameters schema', () => {
    const db = makeDbWithSession();
    const tools = createWismoTools({ db: db as never, waPhoneNumberId: 'pn-1', waAccessToken: 'tok-1' });
    for (const tool of tools) {
      expect(tool.parameters).toHaveProperty('type', 'object');
      expect(tool.parameters).toHaveProperty('required');
    }
  });
});
