import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockClientQuery,
  release: mockRelease,
});

vi.mock('./db', () => ({
  pool: {
    connect: mockConnect,
    query: mockQuery,
  },
}));

vi.mock('./logger', () => ({
  log: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
  withScope: vi.fn((cb) => cb({ setContext: vi.fn() })),
}));

vi.mock('./connectors', () => ({
  connectors: {
    csv_email: vi.fn().mockResolvedValue({ success: true, result: { note: 'ack' } }),
    browser: vi.fn().mockRejectedValue(new Error('not implemented')),
  },
}));

describe('poller', () => {
  beforeEach(() => {
    mockClientQuery.mockReset();
    mockQuery.mockReset();
    mockRelease.mockReset();
  });

  it('rolls back and returns when no jobs found', async () => {
    mockClientQuery.mockResolvedValueOnce(undefined); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // POLL_QUERY
    mockClientQuery.mockResolvedValueOnce(undefined); // ROLLBACK

    const { pollOnce } = await import('./poller');
    await pollOnce();

    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockRelease).toHaveBeenCalled();
  });

  it('claims and executes a csv_email job successfully', async () => {
    const job = {
      id: 'j1',
      job_type: 'csv_email',
      client_id: 'c1',
      operator_id: 'o1',
      retry_count: 0,
      max_retries: 3,
      priority: 5,
      scheduled_at: new Date().toISOString(),
    };

    mockClientQuery.mockResolvedValueOnce(undefined); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [job] }); // POLL_QUERY
    mockClientQuery.mockResolvedValueOnce(undefined); // UPDATE running
    mockClientQuery.mockResolvedValueOnce(undefined); // COMMIT
    mockQuery.mockResolvedValueOnce(undefined); // UPDATE completed

    const { pollOnce } = await import('./poller');
    await pollOnce();

    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'completed'"),
      expect.arrayContaining(['j1']),
    );
  });

  it('marks unknown job_type as failed without retry', async () => {
    const job = {
      id: 'j2',
      job_type: 'unknown_test',
      client_id: 'c1',
      operator_id: 'o1',
      retry_count: 0,
      max_retries: 3,
      priority: 5,
      scheduled_at: new Date().toISOString(),
    };

    mockClientQuery.mockResolvedValueOnce(undefined); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [job] }); // POLL_QUERY
    mockClientQuery.mockResolvedValueOnce(undefined); // UPDATE running
    mockClientQuery.mockResolvedValueOnce(undefined); // COMMIT
    mockQuery.mockResolvedValueOnce(undefined); // UPDATE failed

    const { pollOnce } = await import('./poller');
    await pollOnce();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'failed'"),
      expect.arrayContaining(['Unknown job_type: unknown_test', 'j2']),
    );
  });

  it('retries a browser job that fails when retries remain', async () => {
    const job = {
      id: 'j3',
      job_type: 'browser',
      client_id: 'c1',
      operator_id: 'o1',
      retry_count: 0,
      max_retries: 3,
      priority: 5,
      scheduled_at: new Date().toISOString(),
    };

    mockClientQuery.mockResolvedValueOnce(undefined); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [job] }); // POLL_QUERY
    mockClientQuery.mockResolvedValueOnce(undefined); // UPDATE running
    mockClientQuery.mockResolvedValueOnce(undefined); // COMMIT
    mockQuery.mockResolvedValueOnce(undefined); // UPDATE retrying

    const { pollOnce } = await import('./poller');
    await pollOnce();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'retrying'"),
      expect.arrayContaining([1, expect.any(String), expect.any(Number), 'j3']),
    );
  });

  it('permanently fails a job when max retries exceeded', async () => {
    const job = {
      id: 'j4',
      job_type: 'browser',
      client_id: 'c1',
      operator_id: 'o1',
      retry_count: 3,
      max_retries: 3,
      priority: 5,
      scheduled_at: new Date().toISOString(),
    };

    mockClientQuery.mockResolvedValueOnce(undefined); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [job] }); // POLL_QUERY
    mockClientQuery.mockResolvedValueOnce(undefined); // UPDATE running
    mockClientQuery.mockResolvedValueOnce(undefined); // COMMIT
    mockQuery.mockResolvedValueOnce(undefined); // UPDATE failed

    const { pollOnce } = await import('./poller');
    await pollOnce();

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'failed'"),
      expect.arrayContaining([4, expect.any(String), 'j4']),
    );
  });

  it('sends heartbeat when URL is configured', async () => {
    const originalEnv = process.env.BETTERSTACK_HEARTBEAT_URL;
    process.env.BETTERSTACK_HEARTBEAT_URL = 'https://heartbeat.test/ping';
    const mockFetch = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', mockFetch);

    // Re-import to pick up new env value
    vi.resetModules();
    const { sendHeartbeat } = await import('./poller');
    await sendHeartbeat();

    expect(mockFetch).toHaveBeenCalledWith('https://heartbeat.test/ping');
    process.env.BETTERSTACK_HEARTBEAT_URL = originalEnv;
    vi.unstubAllGlobals();
  });

  it('rolls back and logs on poll error', async () => {
    mockClientQuery.mockRejectedValueOnce(new Error('DB error')); // BEGIN fails
    mockClientQuery.mockResolvedValueOnce(undefined); // ROLLBACK in catch

    const { pollOnce } = await import('./poller');
    await pollOnce();

    expect(mockRelease).toHaveBeenCalled();
  });
});
