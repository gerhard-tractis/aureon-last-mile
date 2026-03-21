// src/agents/intake/intake-worker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createIntakeHandler } from './intake-worker';
import type { IntakeAgent } from './intake-agent';

function makeAgent(content = 'OK') {
  return {
    run: vi.fn().mockResolvedValue({ content, steps: 2, toolCallsMade: [] }),
  } as unknown as IntakeAgent;
}

function makeJob(data: Record<string, unknown>, id = 'job-1') {
  return { id, data } as unknown as import('bullmq').Job;
}

describe('createIntakeHandler', () => {
  it('returns a function', () => {
    const handler = createIntakeHandler(makeAgent());
    expect(typeof handler).toBe('function');
  });

  it('calls agent.run with submission_id, image_url and operator_id', async () => {
    const agent = makeAgent();
    const handler = createIntakeHandler(agent);
    await handler(
      makeJob({ submission_id: 'sub-1', image_url: 'manifests/photo.jpg', operator_id: 'op-1' }),
    );
    expect(agent.run).toHaveBeenCalledWith(
      { submission_id: 'sub-1', image_url: 'manifests/photo.jpg' },
      { operator_id: 'op-1', job_id: 'job-1' },
    );
  });

  it('throws when submission_id is missing from job data', async () => {
    const agent = makeAgent();
    const handler = createIntakeHandler(agent);
    await expect(
      handler(makeJob({ image_url: 'manifests/photo.jpg', operator_id: 'op-1' })),
    ).rejects.toThrow('submission_id');
  });

  it('throws when operator_id is missing from job data', async () => {
    const agent = makeAgent();
    const handler = createIntakeHandler(agent);
    await expect(
      handler(makeJob({ submission_id: 'sub-1', image_url: 'manifests/photo.jpg' })),
    ).rejects.toThrow('operator_id');
  });
});
