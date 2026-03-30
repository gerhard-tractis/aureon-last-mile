import { describe, it, expect, vi } from 'vitest';
import { insertReschedule, getPendingReschedules } from './reschedules';

function makeReschedule(overrides = {}) {
  return {
    id: 're-1', operator_id: 'op-1', order_id: 'ord-1',
    reason: 'time_preference', status: 'pending',
    requested_date: null, requested_window_start: '14:00', requested_window_end: '16:00',
    requested_address: null, customer_note: 'Prefiero tarde',
    session_message_id: null, created_at: '2026-03-30T00:00:00Z',
    ...overrides,
  };
}

function makeInsertDb(result = makeReschedule(), error: { message: string } | null = null) {
  const single = vi.fn().mockResolvedValue({ data: result, error });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  return { from: vi.fn().mockReturnValue({ insert }) };
}

function makeSelectDb(results = [makeReschedule()], error: { message: string } | null = null) {
  const order = vi.fn().mockResolvedValue({ data: results, error });
  const is = vi.fn().mockReturnValue({ order });
  const eq2 = vi.fn().mockReturnValue({ is });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  return { from: vi.fn().mockReturnValue({ select }) };
}

describe('insertReschedule', () => {
  it('inserts a time-preference reschedule and returns it', async () => {
    const db = makeInsertDb();
    const result = await insertReschedule(db as never, {
      operator_id: 'op-1',
      order_id: 'ord-1',
      reason: 'time_preference',
      requested_window_start: '14:00',
      requested_window_end: '16:00',
      customer_note: 'Prefiero tarde',
    });
    expect(result.id).toBe('re-1');
    expect(result.reason).toBe('time_preference');
  });

  it('inserts a date reschedule', async () => {
    const r = makeReschedule({ reason: 'not_home', requested_date: '2026-04-02', requested_window_start: null, requested_window_end: null });
    const db = makeInsertDb(r);
    const result = await insertReschedule(db as never, {
      operator_id: 'op-1', order_id: 'ord-1',
      reason: 'not_home', requested_date: '2026-04-02',
    });
    expect(result.requested_date).toBe('2026-04-02');
  });

  it('throws on DB error', async () => {
    const db = makeInsertDb(makeReschedule(), { message: 'constraint violation' });
    await expect(insertReschedule(db as never, {
      operator_id: 'op-1', order_id: 'ord-1', reason: 'other', requested_address: 'Calle 1',
    })).rejects.toMatchObject({ message: expect.stringContaining('constraint violation') });
  });
});

describe('getPendingReschedules', () => {
  it('returns pending reschedules for operator', async () => {
    const db = makeSelectDb([makeReschedule(), makeReschedule({ id: 're-2' })]);
    const results = await getPendingReschedules(db as never, 'op-1');
    expect(results).toHaveLength(2);
  });

  it('returns empty array when none pending', async () => {
    const db = makeSelectDb([]);
    const results = await getPendingReschedules(db as never, 'op-1');
    expect(results).toEqual([]);
  });

  it('throws on DB error', async () => {
    const db = makeSelectDb([], { message: 'list error' });
    await expect(getPendingReschedules(db as never, 'op-1'))
      .rejects.toMatchObject({ message: expect.stringContaining('list error') });
  });
});
