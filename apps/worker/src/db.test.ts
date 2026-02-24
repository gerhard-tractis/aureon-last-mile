import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mockQuery;
    end = mockEnd;
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
});
