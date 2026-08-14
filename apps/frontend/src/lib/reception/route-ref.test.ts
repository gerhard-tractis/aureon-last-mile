import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLimit = vi.fn();
const chain = {
  eq: vi.fn(() => chain),
  is: vi.fn(() => chain),
  limit: vi.fn((...args: unknown[]) => mockLimit(...args)),
};
const mockSelect = vi.fn(() => chain);
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockRpc = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom, rpc: mockRpc }),
}));

import { resolveRouteId } from './route-ref';

describe('resolveRouteId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('looks the route up by code, scoped to the operator, without side effects', async () => {
    mockLimit.mockResolvedValue({ data: [{ id: 'r1' }], error: null });

    const id = await resolveRouteId('op-1', 'PR-2026-0001');

    expect(id).toBe('r1');
    expect(mockFrom).toHaveBeenCalledWith('pickup_routes');
    expect(chain.eq).toHaveBeenCalledWith('operator_id', 'op-1');
    expect(chain.eq).toHaveBeenCalledWith('code', 'PR-2026-0001');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns null when nothing matches', async () => {
    mockLimit.mockResolvedValue({ data: [], error: null });
    expect(await resolveRouteId('op-1', 'PR-X')).toBeNull();
  });

  it('returns null on error', async () => {
    mockLimit.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await resolveRouteId('op-1', 'PR-X')).toBeNull();
  });
});
