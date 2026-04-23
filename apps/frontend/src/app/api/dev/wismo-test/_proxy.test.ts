import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Supabase mock — must be declared before vi.mock hoisting ─────────────────
const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: mockGetSession },
  })),
}));

import { proxyToAgents } from './_proxy';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(method = 'GET'): NextRequest {
  return new NextRequest('http://localhost/api/dev/wismo-test/test-orders', { method });
}

function sessionFor(role: string, operatorId = 'op-1') {
  return {
    data: {
      session: {
        user: {
          id: 'user-1',
          app_metadata: { claims: { role, operator_id: operatorId } },
        },
      },
    },
    error: null,
  };
}

function noSession() {
  return { data: { session: null }, error: null };
}

const VALID_ENVS = {
  AGENTS_DEV_TOKEN: 'secret-dev-token',
  AGENTS_BASE_URL: 'http://localhost:3110',
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('proxyToAgents', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Set valid env vars by default
    process.env.AGENTS_DEV_TOKEN = VALID_ENVS.AGENTS_DEV_TOKEN;
    process.env.AGENTS_BASE_URL = VALID_ENVS.AGENTS_BASE_URL;
  });

  afterEach(() => {
    // Restore env
    process.env.AGENTS_DEV_TOKEN = origEnv.AGENTS_DEV_TOKEN;
    process.env.AGENTS_BASE_URL = origEnv.AGENTS_BASE_URL;
    vi.unstubAllGlobals();
  });

  // ── Auth checks ─────────────────────────────────────────────────────────────

  it('returns 401 when session is missing', async () => {
    mockGetSession.mockResolvedValue(noSession());
    const res = await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/[Uu]nauthorized/);
  });

  it('returns 401 when getSession returns an error', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: new Error('jwt expired') });
    const res = await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when role is not admin or maintainer', async () => {
    mockGetSession.mockResolvedValue(sessionFor('operations_manager'));
    const res = await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/admin or maintainer/);
  });

  it('allows role admin', async () => {
    mockGetSession.mockResolvedValue(sessionFor('admin'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '[]',
    }));
    const res = await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('allows role maintainer', async () => {
    mockGetSession.mockResolvedValue(sessionFor('maintainer'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '[]',
    }));
    const res = await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });
    expect(res.status).toBe(200);
  });

  // ── Env var checks ──────────────────────────────────────────────────────────

  it('returns 500 when AGENTS_DEV_TOKEN is missing', async () => {
    mockGetSession.mockResolvedValue(sessionFor('admin'));
    delete process.env.AGENTS_DEV_TOKEN;
    const res = await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/AGENTS_DEV_TOKEN/);
  });

  it('returns 500 when AGENTS_BASE_URL is missing', async () => {
    mockGetSession.mockResolvedValue(sessionFor('admin'));
    delete process.env.AGENTS_BASE_URL;
    const res = await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/AGENTS_BASE_URL/);
  });

  // ── Header injection ────────────────────────────────────────────────────────

  it('injects X-Dev-Token header into upstream request', async () => {
    mockGetSession.mockResolvedValue(sessionFor('admin', 'op-42'));
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '{}',
    });
    vi.stubGlobal('fetch', mockFetch);

    await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sentHeaders = init.headers as Record<string, string>;
    expect(sentHeaders['X-Dev-Token']).toBe('secret-dev-token');
  });

  it('injects X-Operator-Id header into upstream request', async () => {
    mockGetSession.mockResolvedValue(sessionFor('admin', 'op-42'));
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '{}',
    });
    vi.stubGlobal('fetch', mockFetch);

    await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const sentHeaders = init.headers as Record<string, string>;
    expect(sentHeaders['X-Operator-Id']).toBe('op-42');
  });

  it('never exposes AGENTS_DEV_TOKEN in response body', async () => {
    mockGetSession.mockResolvedValue(sessionFor('admin'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '{"items":[]}',
    }));

    const res = await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('secret-dev-token');
  });

  // ── Proxy correctness ───────────────────────────────────────────────────────

  it('calls correct upstream URL', async () => {
    mockGetSession.mockResolvedValue(sessionFor('admin'));
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, text: async () => '{}' });
    vi.stubGlobal('fetch', mockFetch);

    await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe('http://localhost:3110/dev/test-orders');
  });

  it('forwards request body for POST requests', async () => {
    mockGetSession.mockResolvedValue(sessionFor('admin'));
    const mockFetch = vi.fn().mockResolvedValue({ status: 201, text: async () => '{"id":"new"}' });
    vi.stubGlobal('fetch', mockFetch);

    await proxyToAgents(makeRequest('POST'), {
      path: '/dev/test-orders',
      method: 'POST',
      body: '{"order_number":"ORD-123"}',
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"order_number":"ORD-123"}');
  });

  it('passes upstream status code through to response', async () => {
    mockGetSession.mockResolvedValue(sessionFor('admin'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, text: async () => '{"error":"not found"}' }));

    const res = await proxyToAgents(makeRequest(), { path: '/dev/test-orders/bad-id', method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('returns 502 when upstream fetch throws a network error', async () => {
    mockGetSession.mockResolvedValue(sessionFor('admin'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const res = await proxyToAgents(makeRequest(), { path: '/dev/test-orders', method: 'GET' });
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/ECONNREFUSED/);
  });
});
