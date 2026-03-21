// src/agents/intake/intake-worker.ts — BullMQ job handler factory for intake.ingest queue
import type { Job } from 'bullmq';
import type { IntakeAgent } from './intake-agent';

export function createIntakeHandler(
  agent: IntakeAgent,
): (job: Job) => Promise<void> {
  return async (job: Job): Promise<void> => {
    const { submission_id, image_url, operator_id } = job.data as Record<string, unknown>;

    if (typeof submission_id !== 'string' || !submission_id) {
      throw new Error('intake job missing submission_id');
    }
    if (typeof operator_id !== 'string' || !operator_id) {
      throw new Error('intake job missing operator_id');
    }

    await agent.run(
      { submission_id, image_url: (image_url as string) ?? '' },
      { operator_id, job_id: job.id ?? 'unknown' },
    );
  };
}
