import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';

// Mock extractManifest before importing health module
vi.mock('../tools/ocr/extract-manifest', () => ({
  extractManifest: vi.fn(),
}));

import { startHealthServer } from './health';
import { extractManifest } from '../tools/ocr/extract-manifest';

const mockExtract = vi.mocked(extractManifest);

const TEST_PORT = 13110;
const SECRET = 'test-secret';
const API_KEY = 'test-api-key';

let server: http.Server;

function url(path: string) {
  return `http://localhost:${TEST_PORT}${path}`;
}

beforeAll(() => {
  server = startHealthServer(TEST_PORT, { openrouterApiKey: API_KEY, ocrApiSecret: SECRET });
});

afterAll(() => {
  server.close();
});

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const res = await fetch(url('/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });
});

describe('POST /api/ocr-extract', () => {
  it('returns 401 without auth header', async () => {
    const res = await fetch(url('/api/ocr-extract'), { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong secret', async () => {
    const res = await fetch(url('/api/ocr-extract'), {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when no images are sent', async () => {
    const form = new FormData();
    const res = await fetch(url('/api/ocr-extract'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it('calls extractManifest and returns JSON on success', async () => {
    const mockResult = {
      pickup_point_code: '400',
      pickup_point_name: 'Paris Maipú',
      orders: [{ order_number: 'ORD-1', customer_name: 'Test', customer_phone: null, delivery_address: null, comuna: null, delivery_date: '2026-04-01', packages: [] }],
    };
    mockExtract.mockResolvedValueOnce(mockResult as never);

    const form = new FormData();
    form.append('images', new Blob(['fake-jpg'], { type: 'image/jpeg' }), 'page1.jpg');

    const res = await fetch(url('/api/ocr-extract'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}` },
      body: form,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { orders: unknown[]; pickup_point_code: string };
    expect(body.orders).toHaveLength(1);
    expect(body.pickup_point_code).toBe('400');
    expect(mockExtract).toHaveBeenCalledWith(API_KEY, [expect.any(Buffer)]);
  });

  it('returns 502 when extractManifest throws', async () => {
    mockExtract.mockRejectedValueOnce(new Error('OpenRouter down'));

    const form = new FormData();
    form.append('images', new Blob(['fake'], { type: 'image/jpeg' }), 'p1.jpg');

    const res = await fetch(url('/api/ocr-extract'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${SECRET}` },
      body: form,
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('OpenRouter down');
  });
});
