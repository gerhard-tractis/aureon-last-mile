// src/lib/logger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('logger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('emits structured JSON with level, ts, and event', async () => {
    const { log } = await import('./logger');
    log('info', 'test_event');
    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.level).toBe('info');
    expect(output.event).toBe('test_event');
    expect(output.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('ts is a valid ISO 8601 date', async () => {
    const { log } = await import('./logger');
    log('debug', 'ts_check');
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(() => new Date(output.ts).toISOString()).not.toThrow();
    expect(new Date(output.ts).toISOString()).toBe(output.ts);
  });

  it('includes generic meta fields in output', async () => {
    const { log } = await import('./logger');
    log('error', 'job_failed', { jobId: 'abc', retryCount: 3 });
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.jobId).toBe('abc');
    expect(output.retryCount).toBe(3);
  });

  it('includes agent-specific extra fields: agent, tool, operator_id, job_id, request_id', async () => {
    const { log } = await import('./logger');
    log('info', 'agent_step', {
      agent: 'route-optimizer',
      tool: 'fetch_stops',
      operator_id: 'op-123',
      job_id: 'job-456',
      request_id: 'req-789',
    });
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.agent).toBe('route-optimizer');
    expect(output.tool).toBe('fetch_stops');
    expect(output.operator_id).toBe('op-123');
    expect(output.job_id).toBe('job-456');
    expect(output.request_id).toBe('req-789');
  });

  it('supports all log levels', async () => {
    const { log } = await import('./logger');
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      log(level, 'test');
    }
    expect(consoleSpy).toHaveBeenCalledTimes(4);
    const levels = consoleSpy.mock.calls.map((c: unknown[]) => JSON.parse(c[0] as string).level);
    expect(levels).toEqual(['debug', 'info', 'warn', 'error']);
  });

  it('works without meta argument', async () => {
    const { log } = await import('./logger');
    expect(() => log('warn', 'no_meta')).not.toThrow();
    const output = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(output.event).toBe('no_meta');
  });
});
