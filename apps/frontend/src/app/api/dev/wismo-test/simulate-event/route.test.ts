import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSSRClient: vi.fn(async () => ({
    auth: { getSession: mockGetSession },
  })),
}));

import { POST } from './route';

function makeRequest(body = '{"event":"delivery_attempted"}') {
  return new NextRequest('http://localhost/api/dev/wismo-test/simulate-event', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}

function adminSession(operatorId = 'op-1') {
  return {
    data: {
      session: { user: { id: 'u1', app_metadata: { claims: { role: 'admin', operator_id: operatorId } } } },
    },
    error: null,
  };
}

describe('POST /api/dev/wismo-test/simulate-event', () => {
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
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when role is not admin/maintainer', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u1', app_metadata: { claims: { role: 'pickup_crew' } } } } },
      error: null,
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 500 when AGENTS_DEV_TOKEN is missing', async () => {
    mockGetSession.mockResolvedValue(adminSession());
    delete process.env.AGENTS_DEV_TOKEN;
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
  });

  it('returns 500 when AGENTS_BASE_URL is missing', async () => {
    mockGetSession.mockResolvedValue(adminSession());
    delete process.env.AGENTS_BASE_URL;
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
  });

  it('proxies to /dev/simulate-event and forwards body', async () => {
    mockGetSession.mockResolvedValue(adminSession('op-8'));
    const mockFetch = vi.fn().mockResolvedValue({ status: 200, text: async () => '{"queued":true}' });
    vi.stubGlobal('fetch', mockFetch);

    const payload = '{"event":"delivery_attempted","order_id":"ORD-001"}';
    const res = await POST(makeRequest(payload));
    expect(res.status).toBe(200);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3110/dev/simulate-event');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(payload);
    expect((init.headers as Record<string, string>)['X-Dev-Token']).toBe('tok');
    expect((init.headers as Record<string, string>)['X-Operator-Id']).toBe('op-8');
  });

  it('never exposes AGENTS_DEV_TOKEN in response', async () => {
    mockGetSession.mockResolvedValue(adminSession());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, text: async () => '{"queued":true}' }));
    const res = await POST(makeRequest());
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('tok');
  });

  it('allows maintainer role', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: { user: { id: 'u1', app_metadata: { claims: { role: 'maintainer', operator_id: 'op-1' } } } },
      },
      error: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, text: async () => '{"queued":true}' }));
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
  });
});
