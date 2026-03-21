// src/tools/supabase/orders.test.ts
import { describe, it, expect, vi } from 'vitest';
import { upsertOrder, updateOrderStatus } from './orders';

function makeDb(returnData: unknown = null, error: unknown = null) {
  const chain = {
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: returnData, error }),
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

describe('upsertOrder', () => {
  it('inserts into orders table', async () => {
    const returned = { id: 'ord-1', status: 'pending' };
    const db = makeDb(returned);
    await upsertOrder(db as never, {
      operator_id: 'op-1',
      intake_submission_id: 'sub-1',
      customer_name: 'Easy SpA',
      delivery_address: 'Av. Las Condes 123',
    });
    expect(db.from).toHaveBeenCalledWith('orders');
  });

  it('returns the created order row', async () => {
    const returned = { id: 'ord-1', customer_name: 'Easy SpA' };
    const db = makeDb(returned);
    const result = await upsertOrder(db as never, {
      operator_id: 'op-1',
      intake_submission_id: 'sub-1',
      customer_name: 'Easy SpA',
      delivery_address: 'Calle Falsa 456',
    });
    expect(result).toMatchObject({ id: 'ord-1' });
  });

  it('includes operator_id on every insert', async () => {
    const db = makeDb({ id: 'ord-2' });
    await upsertOrder(db as never, {
      operator_id: 'op-42',
      intake_submission_id: 'sub-1',
      customer_name: 'Test',
      delivery_address: 'Somewhere',
    });
    const upsertCall = db.from('orders').upsert;
    const payload = upsertCall.mock.calls[0][0];
    expect(payload.operator_id).toBe('op-42');
  });

  it('throws on Supabase error', async () => {
    const db = makeDb(null, { message: 'constraint violation' });
    await expect(
      upsertOrder(db as never, {
        operator_id: 'op-1',
        intake_submission_id: 'sub-1',
        customer_name: 'X',
        delivery_address: 'Y',
      }),
    ).rejects.toThrow('constraint violation');
  });
});

describe('updateOrderStatus', () => {
  it('updates status for given order id', async () => {
    const db = makeDb({ id: 'ord-1', status: 'in_transit' });
    await updateOrderStatus(db as never, 'ord-1', 'op-1', 'in_transit');
    expect(db.from).toHaveBeenCalledWith('orders');
  });

  it('throws on Supabase error', async () => {
    const db = makeDb(null, { message: 'not found' });
    await expect(updateOrderStatus(db as never, 'ord-x', 'op-1', 'delivered')).rejects.toThrow(
      'not found',
    );
  });
});
