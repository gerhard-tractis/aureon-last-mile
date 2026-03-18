// src/lib/health.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';

// Helper: make HTTP request and return { status, body }
function request(
  port: number,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
  });
}

describe('health server', () => {
  let server: http.Server;
  const PORT = 13100; // Use non-default port to avoid conflicts in test

  beforeAll(async () => {
    // Patch the module to use a different port for tests by temporarily
    // importing and starting the server manually
    const { startHealthServer } = await import('./health');
    server = startHealthServer(PORT);
    // Wait for server to be listening
    await new Promise<void>((resolve) => {
      if (server.listening) return resolve();
      server.once('listening', resolve);
    });
  });

  afterAll(() => {
    server.close();
  });

  it('GET /health returns 200 with JSON body {"status":"ok"}', async () => {
    const { status, body } = await request(PORT, '/health');
    expect(status).toBe(200);
    const parsed = JSON.parse(body);
    expect(parsed).toEqual({ status: 'ok' });
  });

  it('GET /health response Content-Type is application/json', async () => {
    const result = await new Promise<{ contentType: string | undefined }>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health' }, (res) => {
        res.resume();
        resolve({ contentType: res.headers['content-type'] });
      });
      req.on('error', reject);
    });
    expect(result.contentType).toContain('application/json');
  });

  it('GET /other returns 404', async () => {
    const { status } = await request(PORT, '/other');
    expect(status).toBe(404);
  });

  it('GET / returns 404', async () => {
    const { status } = await request(PORT, '/');
    expect(status).toBe(404);
  });

  it('POST /health returns 404 (only GET is handled as a path match; other methods fall through)', async () => {
    const result = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: PORT, path: '/health', method: 'POST' },
        (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }); },
      );
      req.on('error', reject);
      req.end();
    });
    // POST /health is not the health check endpoint — return 404
    expect(result.status).toBe(404);
  });
});
