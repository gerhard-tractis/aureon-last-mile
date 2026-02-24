import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('./db', () => ({
  pool: { query: mockQuery },
}));

vi.mock('./logger', () => ({
  log: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

const mockSchedule = vi.fn();
vi.mock('node-cron', () => ({
  default: { schedule: mockSchedule },
}));

describe('cron', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockSchedule.mockReset();
  });

  it('registers a cron schedule for 06:00 America/Santiago', async () => {
    const { startCron } = await import('./cron');
    startCron();
    expect(mockSchedule).toHaveBeenCalledWith(
      '0 6 * * *',
      expect.any(Function),
      { timezone: 'America/Santiago' },
    );
  });

  it('creates jobs for active browser clients with no existing jobs today', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'client-paris', operator_id: 'op-musan' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // No existing jobs
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT

    const { createDailyBrowserJobs } = await import('./cron');
    await createDailyBrowserJobs();

    expect(mockQuery).toHaveBeenCalledTimes(3);
    // Dedup query uses DB timezone, only 1 param (client_id)
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('America/Santiago'),
      ['client-paris'],
    );
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO jobs'),
      ['op-musan', 'client-paris'],
    );
  });

  it('skips clients that already have a job today', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'client-paris', operator_id: 'op-musan' }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-job' }] });

    const { createDailyBrowserJobs } = await import('./cron');
    await createDailyBrowserJobs();

    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('handles no active browser clients', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { createDailyBrowserJobs } = await import('./cron');
    await createDailyBrowserJobs();

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('logs error on query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));
    const { log } = await import('./logger');

    const { createDailyBrowserJobs } = await import('./cron');
    await createDailyBrowserJobs();

    expect(log).toHaveBeenCalledWith('error', 'cron_daily_jobs_error', expect.any(Object));
  });
});
