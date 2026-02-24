import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, sleep } from './logger';

describe('logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('emits structured JSON with level, ts, and event', () => {
    log('info', 'test_event');
    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.level).toBe('info');
    expect(output.event).toBe('test_event');
    expect(output.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes metadata fields in output', () => {
    log('error', 'job_failed', { jobId: 'abc', retryCount: 3 });
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.jobId).toBe('abc');
    expect(output.retryCount).toBe(3);
  });

  it('supports all log levels', () => {
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      log(level, 'test');
    }
    expect(consoleSpy).toHaveBeenCalledTimes(4);
  });
});

describe('sleep', () => {
  it('resolves after the specified delay', async () => {
    const start = Date.now();
    await sleep(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});
