// src/agents/intake/intake-worker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createIntakeHandler } from './intake-worker';

vi.mock('./intake-agent', () => ({
  processIntakeSubmission: vi.fn().mockResolvedValue({ ordersCreated: 1, status: 'parsed' }),
}));

import { processIntakeSubmission } from './intake-agent';
const mockProcess = vi.mocked(processIntakeSubmission);

function makeDb() {
  return {} as never;
}

function makeJob(data: Record<string, unknown>, id = 'job-1') {
  return { id, data } as unknown as import('bullmq').Job;
}

describe('createIntakeHandler', () => {
  it('returns a function', () => {
    const handler = createIntakeHandler(makeDb(), 'api-key');
    expect(typeof handler).toBe('function');
  });

  it('calls processIntakeSubmission with submission_id and operator_id', async () => {
    const db = makeDb();
    const handler = createIntakeHandler(db, 'api-key-123');
    await handler(makeJob({ submission_id: 'sub-1', operator_id: 'op-1' }));
    expect(mockProcess).toHaveBeenCalledWith(db, 'api-key-123', {
      submission_id: 'sub-1',
      operator_id: 'op-1',
    });
  });

  it('throws when submission_id is missing from job data', async () => {
    const handler = createIntakeHandler(makeDb(), 'api-key');
    await expect(
      handler(makeJob({ operator_id: 'op-1' })),
    ).rejects.toThrow('submission_id');
  });

  it('throws when operator_id is missing from job data', async () => {
    const handler = createIntakeHandler(makeDb(), 'api-key');
    await expect(
      handler(makeJob({ submission_id: 'sub-1' })),
    ).rejects.toThrow('operator_id');
  });
});
