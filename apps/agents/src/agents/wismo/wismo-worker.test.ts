import { describe, it, expect, vi } from 'vitest';
import { createWismoHandler } from './wismo-worker';

// Mock processWismoJob so worker tests don't need a real LLM provider or WhatsApp creds
vi.mock('./wismo-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wismo-agent')>();
  return {
    ...actual,
    processWismoJob: vi.fn().mockResolvedValue(undefined),
  };
});

function makeDb() {
  return {} as never;
}

function makeJob(data: Record<string, unknown>) {
  return { id: 'job-1', name: 'wismo', data } as never;
}

describe('createWismoHandler', () => {
  it('throws if type is missing', async () => {
    const handler = createWismoHandler(makeDb());
    await expect(handler(makeJob({ operator_id: 'op-1', order_id: 'ord-1' })))
      .rejects.toMatchObject({ message: expect.stringContaining('missing type') });
  });

  it('throws if operator_id is missing', async () => {
    const handler = createWismoHandler(makeDb());
    await expect(handler(makeJob({ type: 'proactive_pickup', order_id: 'ord-1' })))
      .rejects.toMatchObject({ message: expect.stringContaining('missing operator_id') });
  });

  it('throws if order_id is missing', async () => {
    const handler = createWismoHandler(makeDb());
    await expect(handler(makeJob({ type: 'proactive_pickup', operator_id: 'op-1' })))
      .rejects.toMatchObject({ message: expect.stringContaining('missing order_id') });
  });

  it('throws if client_message is missing customer_phone', async () => {
    const handler = createWismoHandler(makeDb());
    await expect(handler(makeJob({ type: 'client_message', operator_id: 'op-1', order_id: 'ord-1', body: 'hi' })))
      .rejects.toMatchObject({ message: expect.stringContaining('missing customer_phone') });
  });

  it('handles proactive_pickup without throwing', async () => {
    const handler = createWismoHandler(makeDb());
    await expect(handler(makeJob({
      type: 'proactive_pickup', operator_id: 'op-1', order_id: 'ord-1',
    }))).resolves.not.toThrow();
  });

  it('handles client_message reactive flow without throwing', async () => {
    const handler = createWismoHandler(makeDb());
    await expect(handler(makeJob({
      type: 'client_message', operator_id: 'op-1', order_id: 'ord-1',
      customer_phone: '+56912345678', body: '¿Dónde está mi pedido?',
    }))).resolves.not.toThrow();
  });
});
