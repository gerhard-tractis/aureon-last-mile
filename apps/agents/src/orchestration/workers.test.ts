// src/orchestration/workers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const capturedWorkers: Array<{ name: string; opts: Record<string, unknown> }> = [];
const mockWorkerClose = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    close = vi.fn();
    constructor() {}
  },
  Worker: class MockWorker {
    name: string;
    opts: Record<string, unknown>;
    close = mockWorkerClose;
    constructor(name: string, _handler: unknown, opts: Record<string, unknown>) {
      this.name = name;
      this.opts = opts;
      capturedWorkers.push({ name, opts });
    }
  },
  FlowProducer: class MockFlowProducer {
    close = vi.fn();
    constructor() {}
  },
}));

describe('createWorkers', () => {
  beforeEach(() => {
    capturedWorkers.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('registers workers for all 8 queues', async () => {
    const { createWorkers } = await import('./workers');
    createWorkers('redis://localhost:6379');

    const names = capturedWorkers.map((w) => w.name);
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

  it('intake.ingest worker has concurrency 3', async () => {
    const { createWorkers } = await import('./workers');
    createWorkers('redis://localhost:6379');

    const w = capturedWorkers.find((w) => w.name === 'intake.ingest')!;
    expect(w.opts.concurrency).toBe(3);
  });

  it('assignment.optimize worker has concurrency 1', async () => {
    const { createWorkers } = await import('./workers');
    createWorkers('redis://localhost:6379');

    const w = capturedWorkers.find((w) => w.name === 'assignment.optimize')!;
    expect(w.opts.concurrency).toBe(1);
  });

  it('coord.lifecycle worker has concurrency 5', async () => {
    const { createWorkers } = await import('./workers');
    createWorkers('redis://localhost:6379');

    const w = capturedWorkers.find((w) => w.name === 'coord.lifecycle')!;
    expect(w.opts.concurrency).toBe(5);
  });

  it('whatsapp.outbound worker has concurrency 10 and rate limiter 60/min', async () => {
    const { createWorkers } = await import('./workers');
    createWorkers('redis://localhost:6379');

    const w = capturedWorkers.find((w) => w.name === 'whatsapp.outbound')!;
    expect(w.opts.concurrency).toBe(10);
    expect((w.opts.limiter as Record<string, unknown>).max).toBe(60);
    expect((w.opts.limiter as Record<string, unknown>).duration).toBe(60_000);
  });

  it('legacy.worker has concurrency 1', async () => {
    const { createWorkers } = await import('./workers');
    createWorkers('redis://localhost:6379');

    const w = capturedWorkers.find((w) => w.name === 'legacy.worker')!;
    expect(w.opts.concurrency).toBe(1);
  });

  it('all workers use the provided redis url', async () => {
    const { createWorkers } = await import('./workers');
    createWorkers('redis://test-host:6379');

    for (const w of capturedWorkers) {
      const conn = w.opts.connection as Record<string, unknown>;
      expect(conn.url).toBe('redis://test-host:6379');
    }
  });
});

describe('closeWorkers', () => {
  beforeEach(() => {
    capturedWorkers.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('closes all 8 worker instances', async () => {
    const { createWorkers, closeWorkers } = await import('./workers');
    const workers = createWorkers('redis://localhost:6379');
    await closeWorkers(workers);
    expect(mockWorkerClose).toHaveBeenCalledTimes(8);
  });
});
