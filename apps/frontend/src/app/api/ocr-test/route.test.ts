import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST } from './route';

// ── helpers ──────────────────────────────────────────────────────────────────
function makeReq(images: File[] = []): NextRequest {
  const fd = new FormData();
  images.forEach((f) => fd.append('images', f));
  return { formData: vi.fn().mockResolvedValue(fd) } as unknown as NextRequest;
}

function fakeJpeg(name = 'photo.jpg'): File {
  return new File(['fake-image-bytes'], name, { type: 'image/jpeg' });
}

// ── suite ─────────────────────────────────────────────────────────────────────
describe('POST /api/ocr-test', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key-123';
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.OPENROUTER_API_KEY = originalKey;
    } else {
      delete process.env.OPENROUTER_API_KEY;
    }
    vi.unstubAllGlobals();
  });

  it('returns 500 when OPENROUTER_API_KEY is not set', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const res = await POST(makeReq([fakeJpeg()]));
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/OPENROUTER_API_KEY not configured/);
  });

  it('returns 400 when no images are provided', async () => {
    const res = await POST(makeReq([]));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('No images provided');
  });

  it('returns 502 when OpenRouter returns a non-200 status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Rate limited' }),
    );
    const res = await POST(makeReq([fakeJpeg()]));
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string; detail: string };
    expect(body.error).toMatch(/OpenRouter error 429/);
    expect(body.detail).toBe('Rate limited');
  });

  it('returns 502 when OpenRouter response is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'not-json' } }] }),
      }),
    );
    const res = await POST(makeReq([fakeJpeg()]));
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string; raw: string };
    expect(body.error).toBe('Model returned non-JSON');
    expect(body.raw).toBe('not-json');
  });

  it('strips markdown fences and parses the JSON', async () => {
    const payload = { delivery_date: '2026-03-30', orders: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n' + JSON.stringify(payload) + '\n```' } }],
        }),
      }),
    );
    const res = await POST(makeReq([fakeJpeg()]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it('returns 200 with parsed extraction result for a single image', async () => {
    const payload = {
      delivery_date: '2026-03-30',
      orders: [{
        order_number: 'ORD-001',
        customer_name: 'Test Co',
        customer_phone: null,
        delivery_address: 'Av. Test 123',
        comuna: 'Santiago',
        packages: [{ label: 'PKG-1', package_number: null, declared_box_count: 1, sku_items: [], declared_weight_kg: null }],
      }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
      }),
    );
    const res = await POST(makeReq([fakeJpeg()]));
    expect(res.status).toBe(200);
    const body = await res.json() as typeof payload;
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].order_number).toBe('ORD-001');
  });

  it('sends both images to OpenRouter for a two-page manifest', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"delivery_date":null,"orders":[]}' } }] }),
    });
    vi.stubGlobal('fetch', mockFetch);
    await POST(makeReq([fakeJpeg('p1.jpg'), fakeJpeg('p2.jpg')]));
    const sentBody = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body) as {
      messages: Array<{ content: Array<{ type: string }> }>;
    };
    const imageItems = sentBody.messages[0].content.filter((c) => c.type === 'image_url');
    expect(imageItems).toHaveLength(2);
  });
});
