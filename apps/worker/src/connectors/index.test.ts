import { describe, it, expect } from 'vitest';
import { connectors } from './index';

describe('connectors registry', () => {
  it('has csv_email connector', () => {
    expect(connectors.csv_email).toBeDefined();
    expect(typeof connectors.csv_email).toBe('function');
  });

  it('has browser connector stub that throws', async () => {
    await expect(
      connectors.browser({
        id: 'x',
        job_type: 'browser',
        client_id: 'c',
        operator_id: 'o',
        retry_count: 0,
        max_retries: 3,
        priority: 5,
        scheduled_at: new Date().toISOString(),
      }),
    ).rejects.toThrow('Browser connector not implemented');
  });
});
