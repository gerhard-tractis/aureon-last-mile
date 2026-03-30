import { describe, it, expect, vi } from 'vitest';
import { createWismoHandler } from './wismo-worker';
import type { LLMProvider } from '../../providers/types';

function makeProvider(): LLMProvider {
  return {
    model: 'test',
    generate: vi.fn().mockResolvedValue({
      content: 'ok', toolCalls: undefined, finishReason: 'stop',
      model: 'test', usage: { inputTokens: 5, outputTokens: 2 },
    }),
  };
}

function makeDb() {
  const session = { id: 'sess-1', operator_id: 'op-1', order_id: 'ord-1', customer_phone: '+56912345678', status: 'active', escalated_at: null, closed_at: null };
  const order = { customer_phone: '+56912345678', customer_name: 'Juan', order_number: 'ORD-001', delivery_date: '2026-04-05' };

  const ch: Record<string, unknown> = {};
  ch.eq = vi.fn().mockReturnValue(ch);
  ch.is = vi.fn().mockReturnValue(ch);
  ch.limit = vi.fn().mockReturnValue(ch);
  ch.select = vi.fn().mockReturnValue(ch);
  ch.order = vi.fn().mockResolvedValue({ data: [], error: null });
  ch.maybeSingle = vi.fn().mockResolvedValue({ data: session, error: null });
  ch.insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: session, error: null }),
    }),
  });
  ch.update = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  });

  const orderCh: Record<string, unknown> = {};
  orderCh.eq = vi.fn().mockReturnValue(orderCh);
  orderCh.select = vi.fn().mockReturnValue(orderCh);
  orderCh.maybeSingle = vi.fn().mockResolvedValue({ data: order, error: null });

  const notifCh = { insert: vi.fn().mockResolvedValue({ error: null }) };
  const eventsCh = { insert: vi.fn().mockResolvedValue({ error: null }) };

  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') return orderCh;
      if (table === 'wismo_notifications') return notifCh;
      if (table === 'agent_events') return eventsCh;
      return ch;
    }),
  };
}

function makeJob(data: Record<string, unknown>) {
  return { id: 'job-1', name: 'wismo', data } as never;
}

describe('createWismoHandler', () => {
  it('throws if type is missing', async () => {
    const handler = createWismoHandler(makeDb() as never, makeProvider(), 'pn', 'tok');
    await expect(handler(makeJob({ operator_id: 'op-1', order_id: 'ord-1' })))
      .rejects.toMatchObject({ message: expect.stringContaining('missing type') });
  });

  it('throws if operator_id is missing', async () => {
    const handler = createWismoHandler(makeDb() as never, makeProvider(), 'pn', 'tok');
    await expect(handler(makeJob({ type: 'proactive_pickup', order_id: 'ord-1' })))
      .rejects.toMatchObject({ message: expect.stringContaining('missing operator_id') });
  });

  it('throws if order_id is missing', async () => {
    const handler = createWismoHandler(makeDb() as never, makeProvider(), 'pn', 'tok');
    await expect(handler(makeJob({ type: 'proactive_pickup', operator_id: 'op-1' })))
      .rejects.toMatchObject({ message: expect.stringContaining('missing order_id') });
  });

  it('throws if client_message is missing customer_phone', async () => {
    const handler = createWismoHandler(makeDb() as never, makeProvider(), 'pn', 'tok');
    await expect(handler(makeJob({ type: 'client_message', operator_id: 'op-1', order_id: 'ord-1', body: 'hi' })))
      .rejects.toMatchObject({ message: expect.stringContaining('missing customer_phone') });
  });

  it('handles proactive_pickup without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ messages: [{ id: 'wamid.1' }] }),
    }));

    const handler = createWismoHandler(makeDb() as never, makeProvider(), 'pn', 'tok');
    await expect(handler(makeJob({
      type: 'proactive_pickup', operator_id: 'op-1', order_id: 'ord-1',
    }))).resolves.not.toThrow();

    vi.unstubAllGlobals();
  });

  it('handles client_message reactive flow without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ messages: [{ id: 'wamid.2' }] }),
    }));

    const handler = createWismoHandler(makeDb() as never, makeProvider(), 'pn', 'tok');
    await expect(handler(makeJob({
      type: 'client_message', operator_id: 'op-1', order_id: 'ord-1',
      customer_phone: '+56912345678', body: '¿Dónde está mi pedido?',
    }))).resolves.not.toThrow();

    vi.unstubAllGlobals();
  });
});
