import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Supabase mock ─────────────────────────────────────────────────────────────
const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: mockGetSession },
  })),
}));

import { GET, POST } from './route';

// ── Helpers ──────────────────────────────────────────────────────────────────

function adminSession(operatorId = 'op-1') {
  return {
    data: {
      session: {
        user: { id: 'u1', app_metadata: { claims: { role: 'admin', operator_id: operatorId } } },
      },
    },
    error: null,
  };
}

function makeGet() {
  return new NextRequest('http://localhost/api/dev/wismo-test/test-orders', { method: 'GET' });
}

function makePost(body = '{}') {
  return new NextRequest('http://localhost/api/dev/wismo-test/test-orders', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('GET /api/dev/wismo-test/test-orders', () => {
  const origToken = process.env.AGENTS_DEV_TOKEN;
  const origBase = process.env.AGENTS_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENTS_DEV_TOKEN = 'tok';
    process.env.AGENTS_BASE_URL = 'http://localhost:3110';
  });

  afterEach(() => {
    process.env.AGENTS_DEV_TOKEN = origToken;
    process.env.AGENTS_BASE_URL = origBase;
    vi.unstubAllGlobals();
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });

  it('returns 401 when role is not admin/maintainer', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', app_metadata: { claims: { role: 'pickup_crew' } } } } },
      error: null,
    });
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });

  it('returns 500 when AGENTS_DEV_TOKEN is missing', async () => {
    mockGetSession.mockResolvedValue(adminSession());
    delete process.env.AGENTS_DEV_TOKEN;
    const res = await GET(makeGet());
    expect(res.status).toBe(500);
  });

  it('returns 500 when AGENTS_BASE_URL is missing', async () => {
    mockGetSession.mockResolvedValue(adminSession());
    delete process.env.AGENTS_BASE_URL;
    const res = await GET(makeGet());
    expect(res.status).toBe(500);
  });

  it('proxies GET to agents and returns response', async () => {
    mockGetSession.mockResolvedValue(adminSession('op-99'));
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, text: async () => '[]' });
    vi.stubGlobal('fetch', mockFetch);

    const res = await GET(makeGet());
    expect(res.status).toBe(200);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3110/dev/test-orders');
    expect((init.headers as Record<string, string>)['X-Dev-Token']).toBe('tok');
    expect((init.headers as Record<string, string>)['X-Operator-Id']).toBe('op-99');
  });

  it('never exposes AGENTS_DEV_TOKEN in response', async () => {
    mockGetSession.mockResolvedValue(adminSession());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, text: async () => '{"ok":true}' }));

    const res = await GET(makeGet());
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('tok');
  });
});

describe('POST /api/dev/wismo-test/test-orders', () => {
  const origToken = process.env.AGENTS_DEV_TOKEN;
  const origBase = process.env.AGENTS_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENTS_DEV_TOKEN = 'tok';
    process.env.AGENTS_BASE_URL = 'http://localhost:3110';
  });

  afterEach(() => {
    process.env.AGENTS_DEV_TOKEN = origToken;
    process.env.AGENTS_BASE_URL = origBase;
    vi.unstubAllGlobals();
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const res = await POST(makePost());
    expect(res.status).toBe(401);
  });

  it('proxies POST body to agents and returns response', async () => {
    mockGetSession.mockResolvedValue(adminSession('op-1'));
    const mockFetch = vi.fn().mockResolvedValue({ status: 201, text: async () => '{"id":"t-1"}' });
    vi.stubGlobal('fetch', mockFetch);

    const res = await POST(makePost('{"order_number":"ORD-001"}'));
    expect(res.status).toBe(201);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3110/dev/test-orders');
    expect(init.body).toBe('{"order_number":"ORD-001"}');
    expect((init.headers as Record<string, string>)['X-Dev-Token']).toBe('tok');
  });
});
