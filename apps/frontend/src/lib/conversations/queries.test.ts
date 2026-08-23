import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchSessionsForOrder } from './queries';

let queryResponse: { data: unknown[] | null; error: unknown };

function createChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockImplementation(() => Promise.resolve(queryResponse));
  return chain;
}

const fromSpy = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: (...args: unknown[]) => fromSpy(...args) }),
}));

describe('fetchSessionsForOrder', () => {
  beforeEach(() => {
    queryResponse = { data: [], error: null };
    fromSpy.mockReset();
    fromSpy.mockImplementation(() => createChain());
  });

  it('scopes the query to both operator_id and order_id', async () => {
    const chain = createChain();
    fromSpy.mockReturnValue(chain);
    await fetchSessionsForOrder('op-1', 'order-1');

    expect(fromSpy).toHaveBeenCalledWith('customer_sessions');
    expect(chain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(chain.eq).toHaveBeenCalledWith('order_id', 'order-1');
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('maps the joined order_number the same way fetchSessions does', async () => {
    queryResponse = {
      data: [{ id: 's-1', customer_name: 'Ana', orders: { order_number: 'ORD-1' } }],
      error: null,
    };
    fromSpy.mockReturnValue(createChain());

    const result = await fetchSessionsForOrder('op-1', 'order-1');
    expect(result).toEqual([
      { id: 's-1', customer_name: 'Ana', orders: { order_number: 'ORD-1' }, order_number: 'ORD-1' },
    ]);
  });

  it('throws when the query errors', async () => {
    queryResponse = { data: null, error: new Error('boom') };
    fromSpy.mockReturnValue(createChain());

    await expect(fetchSessionsForOrder('op-1', 'order-1')).rejects.toThrow('boom');
  });
});
