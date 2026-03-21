// src/orchestration/workers-handlers.test.ts — Tests handler injection into createWorkers
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track which handler was registered per queue name
const registeredHandlers: Record<string, unknown> = {};

vi.mock('bullmq', () => ({
  Queue: class {
    close = vi.fn();
    constructor() {}
  },
  Worker: class {
    close = vi.fn().mockResolvedValue(undefined);
    constructor(name: string, handler: unknown) {
      registeredHandlers[name] = handler;
    }
  },
  FlowProducer: class {
    close = vi.fn();
    constructor() {}
  },
}));

describe('createWorkers with handlers', () => {
  beforeEach(() => {
    Object.keys(registeredHandlers).forEach((k) => delete registeredHandlers[k]);
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('uses provided handler for intake.ingest queue', async () => {
    const { createWorkers } = await import('./workers');
    const customHandler = vi.fn().mockResolvedValue(undefined);
    createWorkers('redis://localhost:6379', { 'intake.ingest': customHandler });

    const handler = registeredHandlers['intake.ingest'] as (job: unknown) => Promise<void>;
    const fakeJob = { id: 'j-1', name: 'photo_parse', data: {} };
    await handler(fakeJob);

    expect(customHandler).toHaveBeenCalledWith(fakeJob);
  });

  it('uses stub handler for queues without provided handler', async () => {
    const { createWorkers } = await import('./workers');
    const intakeHandler = vi.fn().mockResolvedValue(undefined);
    createWorkers('redis://localhost:6379', { 'intake.ingest': intakeHandler });

    // assignment.optimize has no handler provided → stub (does not call intakeHandler)
    const handler = registeredHandlers['assignment.optimize'] as (job: unknown) => Promise<void>;
    const fakeJob = { id: 'j-2', name: 'batch_assign', data: {} };
    await handler(fakeJob);
    expect(intakeHandler).not.toHaveBeenCalled();
  });
});
