// src/orchestration/intake-listener.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startIntakeListener } from './intake-listener';

function makeQueue() {
  return { add: vi.fn().mockResolvedValue(undefined) };
}

function makeSupabase(pendingRows: { id: string; operator_id: string }[] = []) {
  let insertHandler: ((payload: { new: Record<string, unknown> }) => void) | null = null;

  const channel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn>; unsubscribe: ReturnType<typeof vi.fn> } = {
    on: vi.fn().mockImplementation((_event: unknown, _filter: unknown, handler: typeof insertHandler) => {
      insertHandler = handler;
      return channel;
    }),
    subscribe: vi.fn().mockImplementation(() => channel),
    unsubscribe: vi.fn(),
  };

  const supabase = {
    channel: vi.fn().mockReturnValue(channel),
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: pendingRows, error: null }),
    }),
    _trigger: (row: Record<string, unknown>) => insertHandler?.({ new: row }),
  };

  return supabase;
}

describe('startIntakeListener', () => {
  beforeEach(() => vi.clearAllMocks());

  it('subscribes to intake_submissions inserts', () => {
    const supabase = makeSupabase();
    const queue = makeQueue();
    startIntakeListener(supabase as never, queue as never);
    expect(supabase.channel).toHaveBeenCalledWith('intake_submissions_listener');
  });

  it('enqueues job when status is received', async () => {
    const supabase = makeSupabase();
    const queue = makeQueue();
    startIntakeListener(supabase as never, queue as never);

    supabase._trigger({ id: 'sub-1', operator_id: 'op-1', status: 'received' });
    await vi.runAllTimersAsync().catch(() => {});
    await new Promise((r) => setTimeout(r, 0));

    expect(queue.add).toHaveBeenCalledWith(
      'process_intake',
      { submission_id: 'sub-1', operator_id: 'op-1' },
      expect.objectContaining({ removeOnComplete: 100 }),
    );
  });

  it('does not enqueue when status is not received', async () => {
    const supabase = makeSupabase();
    const queue = makeQueue();
    startIntakeListener(supabase as never, queue as never);

    supabase._trigger({ id: 'sub-2', operator_id: 'op-1', status: 'parsed' });
    await new Promise((r) => setTimeout(r, 0));

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('recovers pending submissions on startup', async () => {
    const supabase = makeSupabase([
      { id: 'sub-3', operator_id: 'op-1' },
      { id: 'sub-4', operator_id: 'op-2' },
    ]);
    const queue = makeQueue();
    startIntakeListener(supabase as never, queue as never);

    await new Promise((r) => setTimeout(r, 10));

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith('process_intake', { submission_id: 'sub-3', operator_id: 'op-1' }, expect.anything());
    expect(queue.add).toHaveBeenCalledWith('process_intake', { submission_id: 'sub-4', operator_id: 'op-2' }, expect.anything());
  });

  it('returns a stop function that unsubscribes', () => {
    const supabase = makeSupabase();
    const queue = makeQueue();
    const stop = startIntakeListener(supabase as never, queue as never);

    const channel = supabase.channel.mock.results[0].value;
    stop();
    expect(channel.unsubscribe).toHaveBeenCalled();
  });
});
