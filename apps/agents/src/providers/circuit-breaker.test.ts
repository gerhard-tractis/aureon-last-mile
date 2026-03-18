import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in closed state', () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const cb = new CircuitBreaker(fn, { failureThreshold: 3, recoveryTimeout: 1000 });
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
  });

  it('passes through successful calls when closed', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const cb = new CircuitBreaker(fn, { failureThreshold: 3, recoveryTimeout: 1000 });
    const result = await cb.execute('arg1');
    expect(result).toBe('result');
    expect(fn).toHaveBeenCalledWith('arg1');
    expect(cb.getState()).toBe('closed');
  });

  it('opens after reaching failure threshold', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const cb = new CircuitBreaker(fn, { failureThreshold: 3, recoveryTimeout: 1000 });

    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('closed');
    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('closed');
    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');
    expect(cb.getFailureCount()).toBe(3);
  });

  it('blocks calls when open', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const cb = new CircuitBreaker(fn, { failureThreshold: 2, recoveryTimeout: 1000 });

    await expect(cb.execute()).rejects.toThrow('fail');
    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');

    // Now calls should be blocked
    await expect(cb.execute()).rejects.toThrow('Circuit breaker is open');
    expect(fn).toHaveBeenCalledTimes(2); // fn not called again
  });

  it('transitions to half-open after recovery timeout', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const cb = new CircuitBreaker(fn, { failureThreshold: 2, recoveryTimeout: 5000 });

    await expect(cb.execute()).rejects.toThrow('fail');
    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(5000);
    expect(cb.getState()).toBe('half-open');
  });

  it('does not transition to half-open before recovery timeout', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const cb = new CircuitBreaker(fn, { failureThreshold: 2, recoveryTimeout: 5000 });

    await expect(cb.execute()).rejects.toThrow('fail');
    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(4999);
    expect(cb.getState()).toBe('open');
  });

  it('closes on success in half-open state', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const cb = new CircuitBreaker(fn, { failureThreshold: 2, recoveryTimeout: 5000 });

    await expect(cb.execute()).rejects.toThrow('fail');
    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(5000);
    expect(cb.getState()).toBe('half-open');

    const result = await cb.execute();
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
  });

  it('re-opens on failure in half-open state', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const cb = new CircuitBreaker(fn, { failureThreshold: 2, recoveryTimeout: 5000 });

    await expect(cb.execute()).rejects.toThrow('fail');
    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(5000);
    expect(cb.getState()).toBe('half-open');

    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');
  });

  it('uses default options when none provided', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const cb = new CircuitBreaker(fn);

    // Default threshold is 5
    for (let i = 0; i < 4; i++) {
      await expect(cb.execute()).rejects.toThrow('fail');
      expect(cb.getState()).toBe('closed');
    }
    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getState()).toBe('open');
  });

  it('resets failure count after successful call', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    const cb = new CircuitBreaker(fn, { failureThreshold: 5, recoveryTimeout: 1000 });

    await expect(cb.execute()).rejects.toThrow('fail');
    expect(cb.getFailureCount()).toBe(1);

    await cb.execute();
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.getState()).toBe('closed');
  });
});
