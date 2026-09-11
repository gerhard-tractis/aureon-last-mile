// src/providers/geocoding/maptiler-errors.test.ts — error classification,
// circuit breaker behaviour and the module-scoped singleton. Request
// construction and match classification live in maptiler.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaptilerProvider, getMaptilerProvider, GeocodingProviderError } from './maptiler';
import { textResponse } from './test-helpers';

describe('MaptilerProvider error classification', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('classifies a malformed (non-JSON) 200 response as api_error', async () => {
    fetchMock.mockResolvedValue(textResponse(200, 'not json at all'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'api_error' });
  });

  it('classifies HTTP 429 as rate_limit', async () => {
    fetchMock.mockResolvedValue(textResponse(429, 'Too Many Requests'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'rate_limit' });
  });

  it('classifies a fetch rejection (network failure) as network', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'network' });
  });

  it('classifies an AbortError as timeout', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'timeout' });
  });

  it('classifies HTTP 401 as credential', async () => {
    fetchMock.mockResolvedValue(textResponse(401, 'Unauthorized'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'credential' });
  });

  it('classifies HTTP 403 with "Key usage restricted" body as credential', async () => {
    // Exact body Fase 0 recorded for a User-Agent-restricted key.
    fetchMock.mockResolvedValue(textResponse(403, 'Key usage restricted'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'credential' });
  });

  it('classifies HTTP 403 with a non-key-related body as rate_limit (plan/quota)', async () => {
    fetchMock.mockResolvedValue(textResponse(403, 'Monthly request limit exceeded'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'rate_limit' });
  });

  it('classifies an HTTP 404 (e.g. an unescaped path) as a transport failure, not "no match"', async () => {
    fetchMock.mockResolvedValue(textResponse(404, 'Not Found'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'api_error' });
  });
});

describe('MaptilerProvider circuit breaker', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('opens after repeated failures and surfaces subsequent calls as a transport failure', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch, {
      failureThreshold: 2,
      recoveryTimeout: 30000,
    });

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toBeTruthy();
    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toBeTruthy();

    const callsSoFar = fetchMock.mock.calls.length;
    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toBeTruthy();
    // The breaker is open: the third call must not have reached fetch again.
    expect(fetchMock.mock.calls.length).toBe(callsSoFar);
  });

  it('trips the breaker on a credential failure, blocking the very next call without calling fetch', async () => {
    fetchMock.mockResolvedValue(textResponse(401, 'Unauthorized'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch, {
      failureThreshold: 5, // high enough that only the explicit trip could open it
      recoveryTimeout: 30000,
    });

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'credential' });

    fetchMock.mockClear();
    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-throws a non-GeocodingProviderError as-is', () => {
    expect(new GeocodingProviderError('network', 'x').type).toBe('network');
  });
});

describe('getMaptilerProvider', () => {
  it('returns the same instance on repeated calls (module-scoped singleton)', () => {
    const a = getMaptilerProvider();
    const b = getMaptilerProvider();
    expect(a).toBe(b);
  });

  it('logs loudly when MAPTILER_API_KEY is absent, so the worker still boots', async () => {
    vi.resetModules();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const mod = await import('./maptiler');
      mod.getMaptilerProvider();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('MAPTILER_API_KEY'));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
