// src/tools/supabase/customers.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getCustomersByOperator } from './customers';

function makeSupabase(rows: unknown[], error: unknown = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

describe('getCustomersByOperator', () => {
  it('queries tenant_clients filtered by operator_id', async () => {
    const db = makeSupabase([]);
    await getCustomersByOperator(db as never, 'op-1');
    expect(db.from).toHaveBeenCalledWith('tenant_clients');
  });

  it('returns array of customers with id, name, rut, phone', async () => {
    const rows = [
      { id: 'c-1', name: 'Easy SpA', rut: '76543210-1', phone: '+56912345678' },
      { id: 'c-2', name: 'Falabella SA', rut: '12345678-9', phone: null },
    ];
    const db = makeSupabase(rows);
    const result = await getCustomersByOperator(db as never, 'op-1');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'c-1', name: 'Easy SpA', rut: '76543210-1' });
  });

  it('returns empty array when no customers found', async () => {
    const db = makeSupabase([]);
    const result = await getCustomersByOperator(db as never, 'op-1');
    expect(result).toEqual([]);
  });

  it('throws on Supabase error', async () => {
    const db = makeSupabase([], { message: 'DB error' });
    await expect(getCustomersByOperator(db as never, 'op-1')).rejects.toThrow('DB error');
  });
});
