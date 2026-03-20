// src/orchestration/flow-producer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const capturedFlowProducers: Array<{ opts: Record<string, unknown> }> = [];
const mockFlowProducerClose = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    close = vi.fn();
    constructor() {}
  },
  Worker: class MockWorker {
    close = vi.fn();
    constructor() {}
  },
  FlowProducer: class MockFlowProducer {
    opts: Record<string, unknown>;
    close = mockFlowProducerClose;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      capturedFlowProducers.push({ opts });
    }
  },
}));

describe('createFlowProducer', () => {
  beforeEach(() => {
    capturedFlowProducers.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates a FlowProducer with the provided redis url', async () => {
    const { createFlowProducer } = await import('./flow-producer');
    createFlowProducer('redis://localhost:6379');

    expect(capturedFlowProducers).toHaveLength(1);
    const conn = capturedFlowProducers[0].opts.connection as Record<string, unknown>;
    expect(conn.url).toBe('redis://localhost:6379');
  });

  it('returns the FlowProducer instance', async () => {
    const { createFlowProducer } = await import('./flow-producer');
    const fp = createFlowProducer('redis://localhost:6379');
    expect(fp).toBeDefined();
    expect(typeof fp.close).toBe('function');
  });
});

describe('getFlowProducer', () => {
  beforeEach(() => {
    capturedFlowProducers.length = 0;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('throws if called before createFlowProducer', async () => {
    const { getFlowProducer } = await import('./flow-producer');
    expect(() => getFlowProducer()).toThrow('FlowProducer not initialized');
  });

  it('returns the same instance as createFlowProducer', async () => {
    const { createFlowProducer, getFlowProducer } = await import('./flow-producer');
    const fp = createFlowProducer('redis://localhost:6379');
    expect(getFlowProducer()).toBe(fp);
  });
});
