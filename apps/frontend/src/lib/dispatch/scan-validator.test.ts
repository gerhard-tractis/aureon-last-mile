import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateScan } from './scan-validator';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({ from: mockFrom }),
}));

// Helper to build a chainable Supabase mock
function mockQuery(returnValue: { data: unknown; error: null | { message: string } }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(returnValue),
    single: vi.fn().mockResolvedValue(returnValue),
  };
  mockFrom.mockReturnValue(chain);
  return chain;
}

describe('validateScan', () => {
  beforeEach(() => mockFrom.mockReset());

  it('returns NOT_FOUND when no package or order matches', async () => {
    mockQuery({ data: [], error: null });
    const result = await validateScan({
      code: 'UNKNOWN-999',
      routeId: 'route-1',
      operatorId: 'op-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_FOUND');
  });

  it('returns WRONG_STATUS when package is not asignado', async () => {
    mockQuery({ data: [{ id: 'pkg-1', status: 'en_bodega', order_id: 'ord-1' }], error: null });
    const result = await validateScan({ code: 'BARCODE-1', routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_STATUS');
  });

  it('returns ok:true with package details when valid', async () => {
    mockFrom
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{
            id: 'pkg-1',
            status: 'asignado',
            order_id: 'ord-1',
            orders: {
              order_number: 'ORD-4821',
              contact_name: 'Mario',
              contact_address: 'Providencia',
              contact_phone: '+569',
            },
          }],
          error: null,
        }),
      })
      .mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

    const result = await validateScan({ code: 'BARCODE-1', routeId: 'route-1', operatorId: 'op-1' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.package.order_number).toBe('ORD-4821');
  });
});
