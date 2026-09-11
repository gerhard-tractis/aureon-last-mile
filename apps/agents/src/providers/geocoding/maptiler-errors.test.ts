// src/providers/geocoding/maptiler-errors.test.ts — error classification,
// circuit breaker behaviour and the module-scoped singleton. Request
// construction and match classification live in maptiler.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaptilerProvider, getMaptilerProvider } from './maptiler';
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

  it('classifies HTTP 403 with a body that positively names a quota/plan limit as rate_limit', async () => {
    fetchMock.mockResolvedValue(textResponse(403, 'Monthly request limit exceeded'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'rate_limit' });
  });

  it('classifies an unrecognised 403 body as credential, not rate_limit', async () => {
    // The default must favour `credential`: a quota-403 misread as credential
    // latches an hour and logs loudly (bounded, ~24 calls/day lost); a
    // key-refusal-403 misread as rate_limit re-arms every 30 minutes forever
    // with no error log — exactly the failure `credential` exists to catch.
    fetchMock.mockResolvedValue(textResponse(403, 'Forbidden'));
    const provider = new MaptilerProvider('test-key', fetchMock as unknown as typeof fetch);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'credential' });
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

    // Both of these fail via the network path (fetchMock rejects with a
    // plain Error) — genuinely a transport failure, before the breaker opens.
    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'network' });
    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'network' });

    const callsSoFar = fetchMock.mock.calls.length;
    // The breaker is now open (failureThreshold: 2). This call never reaches
    // rawGeocode — it fails on the breaker's own "Circuit breaker is open",
    // which geocode() must still surface as a transport failure (network),
    // not silently as "no match".
    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'network' });
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

    // The breaker is now open via trip(), not the failure threshold. This
    // call never reaches fetch — it fails on "Circuit breaker is open",
    // which geocode() wraps as network (a real, if generic, transport
    // failure), never as "no match".
    fetchMock.mockClear();
    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'network' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('MaptilerProvider with no API key', () => {
  // MAPTILER_API_KEY is optional (config.ts) — the worker must still boot,
  // and Fase 5 resolves everything to a comuna centroid, retrying at the
  // start of next month, not every 30 minutes forever. Constructing with an
  // empty key must never reach the network: an empty key still gets a real
  // HTTP response from MapTiler (a 403), which would misclassify this case
  // as a one-hour credential latch instead of Fase 5's dedicated ladder row.
  it('reports isConfigured === false and geocode() never calls fetch', async () => {
    const fetchMock = vi.fn();
    const provider = new MaptilerProvider('', fetchMock as unknown as typeof fetch);

    expect(provider.isConfigured).toBe(false);

    await expect(
      provider.geocode({ address: 'Bandera 140', comuna: 'Santiago' }),
    ).rejects.toMatchObject({ type: 'credential' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports isConfigured === true when constructed with a key', () => {
    const provider = new MaptilerProvider('a-real-key', vi.fn() as unknown as typeof fetch);
    expect(provider.isConfigured).toBe(true);
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

  it('builds a configured provider when MAPTILER_API_KEY is present', async () => {
    // Under Vitest, config.ts's own singleton is always null (it checks
    // process.env.VITEST), so this branch cannot be reached by setting env
    // vars — it has to mock the config module directly.
    vi.resetModules();
    vi.doMock('../../config', () => ({
      config: { MAPTILER_API_KEY: 'a-real-key' },
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const mod = await import('./maptiler');
      const provider = mod.getMaptilerProvider();
      expect(provider.isConfigured).toBe(true);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      vi.doUnmock('../../config');
      vi.resetModules();
    }
  });
});
