// src/tools/supabase/packages.test.ts
import { describe, it, expect, vi } from 'vitest';
import { upsertPackage } from './packages';

function makeDb(returnData: unknown = null, error: unknown = null) {
  const chain = {
    upsert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: returnData, error }),
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

describe('upsertPackage', () => {
  it('inserts into packages table', async () => {
    const db = makeDb({ id: 'pkg-1' });
    await upsertPackage(db as never, { operator_id: 'op-1', order_id: 'ord-1', description: 'Box A' });
    expect(db.from).toHaveBeenCalledWith('packages');
  });

  it('returns the created package row', async () => {
    const db = makeDb({ id: 'pkg-1', description: 'Box A' });
    const result = await upsertPackage(db as never, {
      operator_id: 'op-1',
      order_id: 'ord-1',
      description: 'Box A',
    });
    expect(result).toMatchObject({ id: 'pkg-1' });
  });

  it('includes operator_id in payload', async () => {
    const db = makeDb({ id: 'pkg-2' });
    await upsertPackage(db as never, { operator_id: 'op-99', order_id: 'ord-1', description: 'Caja' });
    const payload = db.from('packages').upsert.mock.calls[0][0];
    expect(payload.operator_id).toBe('op-99');
  });

  it('throws on Supabase error', async () => {
    const db = makeDb(null, { message: 'FK violation' });
    await expect(
      upsertPackage(db as never, { operator_id: 'op-1', order_id: 'bad-id', description: 'X' }),
    ).rejects.toThrow('FK violation');
  });
});
