import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mockQuery;
    end = mockEnd;
    on = vi.fn();
  },
}));

vi.mock('./logger', () => ({
  log: vi.fn(),
  sleep: vi.fn().mockResolvedValue(undefined),
}));

describe('db', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
    mockEnd.mockReset();
  });

  it('connects successfully on first attempt', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const { initDb } = await import('./db');
    await initDb();
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
  });

  it('retries on connection failure and succeeds', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const { initDb } = await import('./db');
    await initDb();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('throws after 5 failed attempts', async () => {
    mockQuery.mockRejectedValue(new Error('ECONNREFUSED'));
    const { initDb } = await import('./db');
    await expect(initDb()).rejects.toThrow('DB connection failed after 5 attempts');
    expect(mockQuery).toHaveBeenCalledTimes(5);
  });

  it('closeDb ends the pool', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const { initDb, closeDb } = await import('./db');
    await initDb();
    await closeDb();
    expect(mockEnd).toHaveBeenCalled();
  });

  // TLS was hardcoded on, which is right for Supabase Cloud and fatal against
  // the self-hosted QA Postgres — it rejects the handshake outright with
  // "server does not support SSL, but SSL was required". The QA worker
  // crash-looped 1503 times before this was noticed.
  describe('sslConfig', () => {
    const original = process.env.SUPABASE_DB_SSL;
    afterEach(() => {
      if (original === undefined) delete process.env.SUPABASE_DB_SSL;
      else process.env.SUPABASE_DB_SSL = original;
    });

    it('defaults to TLS when the flag is unset, so production is unchanged', async () => {
      delete process.env.SUPABASE_DB_SSL;
      const { sslConfig } = await import('./db');
      expect(sslConfig()).toEqual({ rejectUnauthorized: false });
    });

    it('disables TLS only for the exact string "false"', async () => {
      process.env.SUPABASE_DB_SSL = 'false';
      const { sslConfig } = await import('./db');
      expect(sslConfig()).toBe(false);
    });

    // Anything ambiguous must keep TLS on — failing closed beats silently
    // dropping encryption against a cloud database.
    it.each(['true', 'False', '0', '', 'no', 'off'])(
      'keeps TLS on for %o',
      async (value) => {
        process.env.SUPABASE_DB_SSL = value;
        const { sslConfig } = await import('./db');
        expect(sslConfig()).toEqual({ rejectUnauthorized: false });
      },
    );
  });

  it('reports why a connection attempt failed, not just that it did', async () => {
    // The original catch block discarded the error, so the logs said
    // "db_connect_retry attempt 4" and never named the cause.
    const { log } = await import('./logger');
    // The logger mock is not reset by beforeEach, so it still holds calls from
    // earlier tests — clear it or we assert against the wrong failure.
    vi.mocked(log).mockClear();

    mockQuery.mockRejectedValue(new Error('server does not support SSL'));
    const { initDb } = await import('./db');
    await expect(initDb()).rejects.toThrow();

    const retryCalls = vi.mocked(log).mock.calls.filter((c) => c[1] === 'db_connect_retry');
    expect(retryCalls.length).toBeGreaterThan(0);
    expect(retryCalls[0][2]).toMatchObject({ error: expect.stringContaining('SSL') });
  });
});
