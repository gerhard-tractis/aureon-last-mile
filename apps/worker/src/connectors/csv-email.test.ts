import { describe, it, expect, vi } from 'vitest';
import { executeCsvEmail } from './csv-email';
import type { JobRecord } from './types';

vi.mock('../logger', () => ({
  log: vi.fn(),
}));

const mockJob: JobRecord = {
  id: 'test-uuid',
  job_type: 'csv_email',
  client_id: 'client-1',
  operator_id: 'op-1',
  retry_count: 0,
  max_retries: 3,
  priority: 5,
  scheduled_at: new Date().toISOString(),
};

describe('executeCsvEmail', () => {
  it('returns success with acknowledgment note', async () => {
    const result = await executeCsvEmail(mockJob);
    expect(result.success).toBe(true);
    expect(result.result?.note).toContain('n8n is the actual executor');
  });
});
