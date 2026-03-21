// src/orchestration/queues.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shared mock state — must be declared before vi.mock() factory runs
const capturedQueues: Array<{ name: string; opts: Record<string, unknown> }> = [];
const mockClose = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    name: string;
    opts: Record<string, unknown>;
    close = mockClose;
    constructor(name: string, opts: Record<string, unknown>) {
      this.name = name;
      this.opts = opts;
      capturedQueues.push({ name, opts });
    }
  },
  Worker: class MockWorker {
    close = vi.fn();
    constructor() {}
  },
  FlowProducer: class MockFlowProducer {
    close = vi.fn();
    constructor() {}
  },
}));

describe('createQueues', () => {
  beforeEach(() => {
    capturedQueues.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates all 8 queues with correct names', async () => {
    const { createQueues } = await import('./queues');
    createQueues('redis://localhost:6379');

    const names = capturedQueues.map((q) => q.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'intake.ingest',
        'assignment.optimize',
        'coord.lifecycle',
        'wismo.client',
        'settle.reconcile',
        'whatsapp.outbound',
        'exception.handle',
        'legacy.worker',
      ]),
    );
    expect(names).toHaveLength(8);
  });

  it('intake.ingest: 3 attempts, exponential backoff 60s', async () => {
    const { createQueues } = await import('./queues');
    createQueues('redis://localhost:6379');

    const q = capturedQueues.find((q) => q.name === 'intake.ingest')!;
    const djo = q.opts.defaultJobOptions as Record<string, unknown>;
    expect(djo.attempts).toBe(3);
    expect((djo.backoff as Record<string, unknown>).type).toBe('exponential');
    expect((djo.backoff as Record<string, unknown>).delay).toBe(60_000);
  });

  it('assignment.optimize: 2 attempts, 120s backoff', async () => {
    const { createQueues } = await import('./queues');
    createQueues('redis://localhost:6379');

    const q = capturedQueues.find((q) => q.name === 'assignment.optimize')!;
    const djo = q.opts.defaultJobOptions as Record<string, unknown>;
    expect(djo.attempts).toBe(2);
    expect((djo.backoff as Record<string, unknown>).delay).toBe(120_000);
  });

  it('settle.reconcile: 3 attempts, 5m backoff', async () => {
    const { createQueues } = await import('./queues');
    createQueues('redis://localhost:6379');

    const q = capturedQueues.find((q) => q.name === 'settle.reconcile')!;
    const djo = q.opts.defaultJobOptions as Record<string, unknown>;
    expect(djo.attempts).toBe(3);
    expect((djo.backoff as Record<string, unknown>).delay).toBe(300_000);
  });

  it('whatsapp.outbound: 3 attempts, 10s backoff', async () => {
    const { createQueues } = await import('./queues');
    createQueues('redis://localhost:6379');

    const q = capturedQueues.find((q) => q.name === 'whatsapp.outbound')!;
    const djo = q.opts.defaultJobOptions as Record<string, unknown>;
    expect(djo.attempts).toBe(3);
    expect((djo.backoff as Record<string, unknown>).delay).toBe(10_000);
  });

  it('all queues use the provided redis url', async () => {
    const { createQueues } = await import('./queues');
    createQueues('redis://test-host:6379');

    for (const q of capturedQueues) {
      const conn = q.opts.connection as Record<string, unknown>;
      expect(conn.url).toBe('redis://test-host:6379');
    }
  });
});

describe('closeQueues', () => {
  beforeEach(() => {
    capturedQueues.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('closes all 8 queue instances', async () => {
    const { createQueues, closeQueues } = await import('./queues');
    createQueues('redis://localhost:6379');
    await closeQueues();
    expect(mockClose).toHaveBeenCalledTimes(8);
  });

  it('is a no-op when called before createQueues', async () => {
    const { closeQueues } = await import('./queues');
    await expect(closeQueues()).resolves.toBeUndefined();
  });
});
