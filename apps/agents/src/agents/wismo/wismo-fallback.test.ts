import { describe, it, expect, vi, beforeEach } from 'vitest';
import { wismoFallback } from './wismo-fallback';

function makeDb(order: unknown = { order_number: 'ORD-001', status: 'in_transit' }) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: order, error: null });
  const eq2 = vi.fn().mockReturnValue({ maybeSingle });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });

  const msgInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: { id: 'msg-fb' }, error: null }),
    }),
  });

  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') return { select };
      return { insert: msgInsert };
    }),
  };
}

function mockFetch(ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    json: async () => ({ messages: [{ id: 'wamid.fb1' }] }),
    text: async () => 'error',
  });
}

const PARAMS = {
  operator_id: 'op-1',
  session_id: 'sess-1',
  customer_phone: '+56912345678',
  order_id: 'ord-1',
  error: new Error('LLM timeout'),
};

describe('wismoFallback', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends fallback message containing order number and status', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const db = makeDb({ order_number: 'ORD-001', status: 'in_transit' });

    const body = await wismoFallback(db as never, 'pn-1', 'tok-1', PARAMS);

    expect(body).toContain('ORD-001');
    expect(body).toContain('in_transit');
  });

  it('uses "desconocido" when order not found in DB', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const db = makeDb(null);

    const body = await wismoFallback(db as never, 'pn-1', 'tok-1', PARAMS);

    expect(body).toContain('desconocido');
  });

  it('does not throw if WA send fails', async () => {
    vi.stubGlobal('fetch', mockFetch(false));
    const db = makeDb();

    await expect(wismoFallback(db as never, 'pn-1', 'tok-1', PARAMS)).resolves.not.toThrow();
  });

  it('returns the fallback message string', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const db = makeDb({ order_number: 'ORD-123', status: 'pending' });

    const result = await wismoFallback(db as never, 'pn-1', 'tok-1', PARAMS);

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
