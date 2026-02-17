import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { withSentry } from './middleware';

// Mock Sentry
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

describe('withSentry middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute handler successfully without capturing errors', async () => {
    const mockHandler = vi.fn(async () => {
      return NextResponse.json({ success: true });
    });

    const wrappedHandler = withSentry(mockHandler);
    const mockRequest = new NextRequest('http://localhost/api/test', {
      method: 'POST',
      body: JSON.stringify({ test: 'data' }),
    });

    const response = await wrappedHandler(mockRequest);

    expect(mockHandler).toHaveBeenCalledWith(mockRequest);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('should capture exception and include request context', async () => {
    const testError = new Error('API route failed');
    const mockHandler = vi.fn(async () => {
      throw testError;
    });

    const wrappedHandler = withSentry(mockHandler);
    const mockRequest = new NextRequest('http://localhost/api/users', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
      },
    });

    await expect(wrappedHandler(mockRequest)).rejects.toThrow('API route failed');

    expect(Sentry.captureException).toHaveBeenCalledWith(
      testError,
      expect.objectContaining({
        contexts: expect.objectContaining({
          request: expect.objectContaining({
            method: 'POST',
            url: 'http://localhost/api/users',
          }),
        }),
      })
    );
  });

  it('should sanitize sensitive headers before sending to Sentry', async () => {
    const testError = new Error('Test error');
    const mockHandler = vi.fn(async () => {
      throw testError;
    });

    const wrappedHandler = withSentry(mockHandler);
    const mockRequest = new NextRequest('http://localhost/api/test', {
      method: 'GET',
      headers: {
        'authorization': 'Bearer secret-token',
        'cookie': 'session=abc123',
        'content-type': 'application/json',
      },
    });

    await expect(wrappedHandler(mockRequest)).rejects.toThrow();

    const captureCall = (Sentry.captureException as any).mock.calls[0];
    const context = captureCall[1];

    // Authorization and Cookie should be removed by sanitization
    expect(context.contexts.request.headers).not.toHaveProperty('authorization');
    expect(context.contexts.request.headers).not.toHaveProperty('cookie');
    expect(context.contexts.request.headers).toHaveProperty('content-type');
  });

  it('should handle GET requests with query params', async () => {
    const testError = new Error('Query error');
    const mockHandler = vi.fn(async () => {
      throw testError;
    });

    const wrappedHandler = withSentry(mockHandler);
    const mockRequest = new NextRequest('http://localhost/api/users?page=1&limit=10', {
      method: 'GET',
    });

    await expect(wrappedHandler(mockRequest)).rejects.toThrow();

    expect(Sentry.captureException).toHaveBeenCalledWith(
      testError,
      expect.objectContaining({
        contexts: expect.objectContaining({
          request: expect.objectContaining({
            method: 'GET',
            url: 'http://localhost/api/users?page=1&limit=10',
          }),
        }),
      })
    );
  });
});
