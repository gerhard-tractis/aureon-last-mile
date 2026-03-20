// src/orchestration/command-listener.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Queue } from 'bullmq';

// --- Supabase Realtime mock ---
type InsertCallback = (payload: { new: Record<string, unknown> }) => void;
let capturedInsertCallback: InsertCallback | null = null;

const mockSubscribe = vi.fn().mockReturnValue({ unsubscribe: vi.fn() });
const mockOn = vi.fn().mockImplementation((_event, _filter, cb: InsertCallback) => {
  capturedInsertCallback = cb;
  return { subscribe: mockSubscribe };
});
const mockChannel = vi.fn().mockReturnValue({ on: mockOn });
const mockFrom = vi.fn().mockReturnValue({
  update: vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }),
});

function makeSupabase(): SupabaseClient {
  return {
    channel: mockChannel,
    from: mockFrom,
  } as unknown as SupabaseClient;
}

// --- BullMQ Queue mock ---
function makeQueues(): Record<string, Queue> {
  const makeQ = () => ({ add: vi.fn().mockResolvedValue({ id: 'job-1' }) });
  return {
    'intake.ingest': makeQ() as unknown as Queue,
    'assignment.optimize': makeQ() as unknown as Queue,
    'coord.lifecycle': makeQ() as unknown as Queue,
    'wismo.client': makeQ() as unknown as Queue,
    'settle.reconcile': makeQ() as unknown as Queue,
    'whatsapp.outbound': makeQ() as unknown as Queue,
    'exception.handle': makeQ() as unknown as Queue,
    'legacy.worker': makeQ() as unknown as Queue,
  };
}

describe('startCommandListener', () => {
  beforeEach(() => {
    capturedInsertCallback = null;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('subscribes to INSERT events on agent_commands', async () => {
    const { startCommandListener } = await import('./command-listener');
    const queues = makeQueues();
    startCommandListener(makeSupabase(), queues);

    expect(mockChannel).toHaveBeenCalledWith('agent_commands');
    expect(mockOn).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({ event: 'INSERT', table: 'agent_commands' }),
      expect.any(Function),
    );
    expect(mockSubscribe).toHaveBeenCalled();
  });

  it('routes reassign_driver to coord.lifecycle with priority 10', async () => {
    const { startCommandListener } = await import('./command-listener');
    const queues = makeQueues();
    const supabase = makeSupabase();
    startCommandListener(supabase, queues);

    await capturedInsertCallback!({
      new: { id: 'cmd-1', command_type: 'reassign_driver', payload: { order_id: 'o-1' }, operator_id: 'op-1' },
    });

    const addMock = (queues['coord.lifecycle'] as unknown as { add: ReturnType<typeof vi.fn> }).add;
    expect(addMock).toHaveBeenCalledWith(
      'reassign_driver',
      expect.objectContaining({ commandId: 'cmd-1', operatorId: 'op-1' }),
      expect.objectContaining({ priority: 10 }),
    );
  });

  it('routes cancel_order to coord.lifecycle with priority 10', async () => {
    const { startCommandListener } = await import('./command-listener');
    const queues = makeQueues();
    startCommandListener(makeSupabase(), queues);

    await capturedInsertCallback!({
      new: { id: 'cmd-2', command_type: 'cancel_order', payload: {}, operator_id: 'op-1' },
    });

    const addMock = (queues['coord.lifecycle'] as unknown as { add: ReturnType<typeof vi.fn> }).add;
    expect(addMock).toHaveBeenCalledWith(
      'cancel_order',
      expect.any(Object),
      expect.objectContaining({ priority: 10 }),
    );
  });

  it('routes retry_intake to intake.ingest with priority 10', async () => {
    const { startCommandListener } = await import('./command-listener');
    const queues = makeQueues();
    startCommandListener(makeSupabase(), queues);

    await capturedInsertCallback!({
      new: { id: 'cmd-3', command_type: 'retry_intake', payload: {}, operator_id: 'op-1' },
    });

    const addMock = (queues['intake.ingest'] as unknown as { add: ReturnType<typeof vi.fn> }).add;
    expect(addMock).toHaveBeenCalledWith(
      'retry_intake',
      expect.any(Object),
      expect.objectContaining({ priority: 10 }),
    );
  });

  it('routes send_manual_wa to whatsapp.outbound with priority 10', async () => {
    const { startCommandListener } = await import('./command-listener');
    const queues = makeQueues();
    startCommandListener(makeSupabase(), queues);

    await capturedInsertCallback!({
      new: { id: 'cmd-4', command_type: 'send_manual_wa', payload: {}, operator_id: 'op-1' },
    });

    const addMock = (queues['whatsapp.outbound'] as unknown as { add: ReturnType<typeof vi.fn> }).add;
    expect(addMock).toHaveBeenCalledWith(
      'send_manual_wa',
      expect.any(Object),
      expect.objectContaining({ priority: 10 }),
    );
  });

  it('marks command as processed after enqueueing', async () => {
    const { startCommandListener } = await import('./command-listener');
    const queues = makeQueues();
    const supabase = makeSupabase();
    startCommandListener(supabase, queues);

    await capturedInsertCallback!({
      new: { id: 'cmd-5', command_type: 'reassign_driver', payload: {}, operator_id: 'op-1' },
    });

    expect(mockFrom).toHaveBeenCalledWith('agent_commands');
    const updateChain = mockFrom.mock.results[0].value;
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processed' }),
    );
  });
});
