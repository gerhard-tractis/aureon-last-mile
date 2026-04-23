// src/dev/__tests__/dev-router.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockExpressApp() {
  const routes: Array<{ method: string; path: string; handler: Function }> = [];
  return {
    _routes: routes,
    get: vi.fn((path: string, ...handlers: Function[]) => {
      routes.push({ method: 'GET', path, handler: handlers[handlers.length - 1] });
    }),
    post: vi.fn((path: string, ...handlers: Function[]) => {
      routes.push({ method: 'POST', path, handler: handlers[handlers.length - 1] });
    }),
  };
}

function makeReq(overrides: {
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
} = {}) {
  return {
    headers: overrides.headers ?? {},
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    // Simulate operator_id extracted from somewhere (e.g., a middleware)
    operator_id: 'op-1',
  };
}

function makeRes() {
  const res = {
    _status: 0,
    _json: null as unknown,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  res.status.mockImplementation((code: number) => {
    res._status = code;
    return res;
  });
  res.json.mockImplementation((data: unknown) => {
    res._json = data;
    return res;
  });
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('registerDevRoutes — env guard', () => {
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    origEnv = { ...process.env };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('does NOT register routes when ENABLE_DEV_ENDPOINTS is not "true"', async () => {
    process.env.ENABLE_DEV_ENDPOINTS = 'false';
    process.env.NODE_ENV = 'development';
    process.env.AGENTS_DEV_TOKEN = 'secret-token';

    const { registerDevRoutes } = await import('../index');
    const app = mockExpressApp();
    const db = {} as never;

    registerDevRoutes(app as never, db);

    // No routes should have been registered
    expect(app._routes.length).toBe(0);
  });

  it('does NOT register routes when ENABLE_DEV_ENDPOINTS is undefined', async () => {
    delete process.env.ENABLE_DEV_ENDPOINTS;
    process.env.NODE_ENV = 'development';

    const { registerDevRoutes } = await import('../index');
    const app = mockExpressApp();
    registerDevRoutes(app as never, {} as never);
    expect(app._routes.length).toBe(0);
  });

  it('does NOT register routes when NODE_ENV is "production" even if ENABLE_DEV_ENDPOINTS=true', async () => {
    process.env.ENABLE_DEV_ENDPOINTS = 'true';
    process.env.NODE_ENV = 'production';
    process.env.AGENTS_DEV_TOKEN = 'secret-token';

    const { registerDevRoutes } = await import('../index');
    const app = mockExpressApp();
    registerDevRoutes(app as never, {} as never);
    expect(app._routes.length).toBe(0);
  });

  it('DOES register routes when ENABLE_DEV_ENDPOINTS=true and NODE_ENV=development', async () => {
    process.env.ENABLE_DEV_ENDPOINTS = 'true';
    process.env.NODE_ENV = 'development';
    process.env.AGENTS_DEV_TOKEN = 'secret-token';

    const { registerDevRoutes } = await import('../index');
    const app = mockExpressApp();
    registerDevRoutes(app as never, {} as never);
    expect(app._routes.length).toBeGreaterThan(0);
  });
});

describe('devTokenGuard middleware', () => {
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    origEnv = { ...process.env };
    vi.resetModules();
    process.env.ENABLE_DEV_ENDPOINTS = 'true';
    process.env.NODE_ENV = 'development';
    process.env.AGENTS_DEV_TOKEN = 'my-secret-token';
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it('returns 404 when X-Dev-Token header is missing', async () => {
    const { devTokenGuard } = await import('../index');
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = vi.fn();

    devTokenGuard(req as never, res as never, next);

    expect(res._status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when X-Dev-Token header is wrong', async () => {
    const { devTokenGuard } = await import('../index');
    const req = makeReq({ headers: { 'x-dev-token': 'wrong-token' } });
    const res = makeRes();
    const next = vi.fn();

    devTokenGuard(req as never, res as never, next);

    expect(res._status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when X-Dev-Token header matches AGENTS_DEV_TOKEN', async () => {
    const { devTokenGuard } = await import('../index');
    const req = makeReq({ headers: { 'x-dev-token': 'my-secret-token' } });
    const res = makeRes();
    const next = vi.fn();

    devTokenGuard(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
    expect(res._status).toBe(0); // unchanged
  });
});
