// src/orchestration/bull-board.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Queue } from 'bullmq';

// Shared mock state
const capturedAdapters: Array<{ queue: unknown }> = [];
const mockCreateBullBoard = vi.fn();
const mockSetBasePath = vi.fn();
const mockGetRouter = vi.fn().mockReturnValue(vi.fn());
const mockAppUse = vi.fn();
const mockAppListen = vi.fn().mockImplementation((_port: number, cb?: () => void) => {
  cb?.();
  return { close: vi.fn() };
});
const mockExpress = vi.fn().mockReturnValue({
  use: mockAppUse,
  listen: mockAppListen,
});

vi.mock('@bull-board/api', () => ({ createBullBoard: mockCreateBullBoard }));

vi.mock('@bull-board/api/bullMQAdapter', () => {
  class MockBullMQAdapter {
    queue: unknown;
    constructor(q: unknown) {
      this.queue = q;
      capturedAdapters.push({ queue: q });
    }
  }
  return { BullMQAdapter: MockBullMQAdapter };
});

vi.mock('@bull-board/express', () => {
  class MockExpressAdapter {
    setBasePath = mockSetBasePath;
    getRouter = mockGetRouter;
  }
  return { ExpressAdapter: MockExpressAdapter };
});

vi.mock('express', () => ({ default: mockExpress }));

function makeQueues(): Record<string, Queue> {
  return Object.fromEntries(
    ['intake.ingest', 'assignment.optimize', 'coord.lifecycle', 'wismo.client',
      'settle.reconcile', 'whatsapp.outbound', 'exception.handle', 'legacy.worker']
      .map((name) => [name, {} as Queue]),
  );
}

describe('startBullBoard', () => {
  beforeEach(() => {
    capturedAdapters.length = 0;
    vi.clearAllMocks();
    // Re-setup mocks cleared by clearAllMocks
    mockAppListen.mockImplementation((_port: number, cb?: () => void) => {
      cb?.();
      return { close: vi.fn() };
    });
    mockExpress.mockReturnValue({ use: mockAppUse, listen: mockAppListen });
    mockGetRouter.mockReturnValue(vi.fn());
    vi.resetModules();
  });

  it('returns an object with a close function', async () => {
    const { startBullBoard } = await import('./bull-board');
    const server = startBullBoard(makeQueues(), { user: 'admin', password: 'secret' });
    expect(server).toBeDefined();
    expect(typeof server.close).toBe('function');
  });

  it('creates BullMQ adapters for all 8 queues', async () => {
    const { startBullBoard } = await import('./bull-board');
    startBullBoard(makeQueues(), { user: 'admin', password: 'secret' });
    expect(capturedAdapters).toHaveLength(8);
  });

  it('sets basePath to /bull-board', async () => {
    const { startBullBoard } = await import('./bull-board');
    startBullBoard(makeQueues(), { user: 'admin', password: 'secret' });
    expect(mockSetBasePath).toHaveBeenCalledWith('/bull-board');
  });

  it('listens on port 3101', async () => {
    const { startBullBoard } = await import('./bull-board');
    startBullBoard(makeQueues(), { user: 'admin', password: 'secret' });
    expect(mockAppListen).toHaveBeenCalledWith(3101, expect.any(Function));
  });
});

describe('basicAuthMiddleware', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('rejects requests without Authorization header with 401', async () => {
    const { basicAuthMiddleware } = await import('./bull-board');
    const req = { headers: {} };
    const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
    const next = vi.fn();

    basicAuthMiddleware('admin', 'secret')(req as never, res as never, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with wrong credentials with 401', async () => {
    const { basicAuthMiddleware } = await import('./bull-board');
    const creds = Buffer.from('wrong:pass').toString('base64');
    const req = { headers: { authorization: `Basic ${creds}` } };
    const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
    const next = vi.fn();

    basicAuthMiddleware('admin', 'secret')(req as never, res as never, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows requests with correct credentials', async () => {
    const { basicAuthMiddleware } = await import('./bull-board');
    const creds = Buffer.from('admin:secret').toString('base64');
    const req = { headers: { authorization: `Basic ${creds}` } };
    const res = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
    const next = vi.fn();

    basicAuthMiddleware('admin', 'secret')(req as never, res as never, next);

    expect(next).toHaveBeenCalled();
  });
});
