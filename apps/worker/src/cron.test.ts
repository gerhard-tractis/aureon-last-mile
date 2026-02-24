import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('./db', () => ({
  pool: { query: mockQuery },
}));

vi.mock('./logger', () => ({
  log: vi.fn(),
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
    // Active browser clients
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'client-paris', operator_id: 'op-musan' }],
    });
    // No existing jobs today
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { createDailyBrowserJobs } = await import('./cron');
    await createDailyBrowserJobs();

    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO jobs'),
      expect.arrayContaining(['op-musan', 'client-paris']),
    );
  });

  it('skips clients that already have a job today', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'client-paris', operator_id: 'op-musan' }],
    });
    // Existing job found
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-job' }] });

    const { createDailyBrowserJobs } = await import('./cron');
    await createDailyBrowserJobs();

    // Only 2 queries: SELECT clients + SELECT existing — no INSERT
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
