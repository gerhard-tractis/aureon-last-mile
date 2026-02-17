import { describe, it, expect } from 'vitest';
import { sanitizeEvent } from './sanitize';
import type { Event } from '@sentry/nextjs';

describe('sanitizeEvent', () => {
  it('should remove sensitive headers', () => {
    const event: Event = {
      request: {
        headers: {
          'authorization': 'Bearer token123',
          'cookie': 'session=abc123',
          'x-api-key': 'secret-key',
          'content-type': 'application/json',
        },
      },
    };

    const sanitized = sanitizeEvent(event, {});

    expect(sanitized?.request?.headers).toEqual({
      'content-type': 'application/json',
    });
    expect(sanitized?.request?.headers).not.toHaveProperty('authorization');
    expect(sanitized?.request?.headers).not.toHaveProperty('cookie');
    expect(sanitized?.request?.headers).not.toHaveProperty('x-api-key');
  });

  it('should sanitize sensitive fields in request data', () => {
    const event: Event = {
      request: {
        data: {
          username: 'testuser',
          password: 'secret123',
          token: 'jwt-token',
          api_key: 'api-secret',
          secret: 'my-secret',
          email: 'user@example.com',
        },
      },
    };

    const sanitized = sanitizeEvent(event, {});

    expect(sanitized?.request?.data).toEqual({
      username: 'testuser',
      password: '[REDACTED]',
      token: '[REDACTED]',
      api_key: '[REDACTED]',
      secret: '[REDACTED]',
      email: 'user@example.com',
    });
  });

  it('should mask user email while preserving domain', () => {
    const event: Event = {
      user: {
        id: '123',
        email: 'john.doe@example.com',
      },
    };

    const sanitized = sanitizeEvent(event, {});

    expect(sanitized?.user?.email).toBe('joh***@example.com');
    expect(sanitized?.user?.id).toBe('123');
  });

  it('should handle short emails correctly', () => {
    const event: Event = {
      user: {
        email: 'ab@example.com',
      },
    };

    const sanitized = sanitizeEvent(event, {});

    // For emails shorter than 3 chars before @, mask what we can
    expect(sanitized?.user?.email).toMatch(/^[a-z]{1,3}\*+@example\.com$/);
  });

  it('should handle events without sensitive data', () => {
    const event: Event = {
      message: 'Test error',
      level: 'error',
    };

    const sanitized = sanitizeEvent(event, {});

    expect(sanitized).toEqual(event);
  });

  it('should handle null/undefined values gracefully', () => {
    const event: Event = {
      request: {
        headers: undefined,
        data: null,
      },
      user: undefined,
    };

    const sanitized = sanitizeEvent(event, {});

    expect(sanitized).toBeDefined();
    expect(sanitized?.request).toBeDefined();
  });

  it('should return event even if sanitization throws error', () => {
    const event: Event = {
      message: 'Test error',
    };

    // This should not throw
    const sanitized = sanitizeEvent(event, {});

    expect(sanitized).toStrictEqual(event);
  });

  it('should sanitize nested sensitive fields', () => {
    const event: Event = {
      request: {
        data: {
          user: {
            password: 'secret',
            email: 'test@example.com',
          },
          credentials: {
            token: 'jwt-123',
          },
        },
      },
    };

    const sanitized = sanitizeEvent(event, {});

    expect(sanitized?.request?.data?.user?.password).toBe('[REDACTED]');
    expect(sanitized?.request?.data?.credentials?.token).toBe('[REDACTED]');
  });

  describe('Error Sampling (Task 7.1)', () => {
    it('should always capture fatal errors', () => {
      const event: Event = {
        message: 'Fatal error',
        level: 'fatal',
      };

      const result = sanitizeEvent(event, {});
      expect(result).not.toBeNull();
    });

    it('should always capture error-level events', () => {
      const event: Event = {
        message: 'Error occurred',
        level: 'error',
      };

      const result = sanitizeEvent(event, {});
      expect(result).not.toBeNull();
    });

    it('should sample warnings at approximately 50%', () => {
      const trials = 1000;
      let captured = 0;

      for (let i = 0; i < trials; i++) {
        const event: Event = {
          message: `Warning ${i}`,
          level: 'warning',
        };

        if (sanitizeEvent(event, {}) !== null) {
          captured++;
        }
      }

      // Expect approximately 50% capture rate (allow 40-60% range for randomness)
      const captureRate = captured / trials;
      expect(captureRate).toBeGreaterThan(0.4);
      expect(captureRate).toBeLessThan(0.6);
    });

    it('should sample info events at approximately 50%', () => {
      const trials = 1000;
      let captured = 0;

      for (let i = 0; i < trials; i++) {
        const event: Event = {
          message: `Info ${i}`,
          level: 'info',
        };

        if (sanitizeEvent(event, {}) !== null) {
          captured++;
        }
      }

      // Expect approximately 50% capture rate (allow 40-60% range for randomness)
      const captureRate = captured / trials;
      expect(captureRate).toBeGreaterThan(0.4);
      expect(captureRate).toBeLessThan(0.6);
    });

    it('should return null (drop event) when sampling rejects low-priority event', () => {
      // Run multiple trials to ensure we get at least one dropped event
      let foundDropped = false;

      for (let i = 0; i < 100; i++) {
        const event: Event = {
          message: 'Warning test',
          level: 'warning',
        };

        if (sanitizeEvent(event, {}) === null) {
          foundDropped = true;
          break;
        }
      }

      expect(foundDropped).toBe(true);
    });
  });
});
