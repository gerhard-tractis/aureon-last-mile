import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GlmOcrProvider } from './glm-ocr';

describe('GlmOcrProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('constructs with apiKey and endpoint', () => {
    const provider = new GlmOcrProvider('test-key', 'https://api.glm-ocr.example/v1/extract');
    expect(provider).toBeDefined();
  });

  it('sends correct POST request with image and prompt', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'Invoice #1234',
        confidence: 0.97,
        fields: { invoice_number: '1234' },
      }),
    } as Response);

    const provider = new GlmOcrProvider('my-key', 'https://api.example.com/ocr');
    await provider.extractDocument('base64imagedata==', 'Extract invoice fields');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/ocr');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body as string);
    expect(body.image).toBe('base64imagedata==');
    expect(body.prompt).toBe('Extract invoice fields');

    const headers = options.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-key');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends request without prompt when not provided', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'Some text', confidence: 0.85 }),
    } as Response);

    const provider = new GlmOcrProvider('key', 'https://api.example.com/ocr');
    await provider.extractDocument('imgdata==');

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.image).toBe('imgdata==');
    expect(body.prompt).toBeUndefined();
  });

  it('returns parsed GlmOcrResponse on success', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'Driver: João Silva',
        confidence: 0.92,
        fields: { driver_name: 'João Silva', license: 'SP-1234' },
      }),
    } as Response);

    const provider = new GlmOcrProvider('key', 'https://api.example.com/ocr');
    const result = await provider.extractDocument('imgdata==');

    expect(result.text).toBe('Driver: João Silva');
    expect(result.confidence).toBe(0.92);
    expect(result.fields).toEqual({ driver_name: 'João Silva', license: 'SP-1234' });
  });

  it('returns response without fields when not in response', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'Plain text', confidence: 0.88 }),
    } as Response);

    const provider = new GlmOcrProvider('key', 'https://api.example.com/ocr');
    const result = await provider.extractDocument('imgdata==');

    expect(result.text).toBe('Plain text');
    expect(result.confidence).toBe(0.88);
    expect(result.fields).toBeUndefined();
  });

  it('throws api_error on non-OK HTTP response', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response);

    const provider = new GlmOcrProvider('bad-key', 'https://api.example.com/ocr');

    await expect(provider.extractDocument('imgdata==')).rejects.toMatchObject({
      type: 'api_error',
      message: expect.stringContaining('401'),
    });
  });

  it('throws api_error on 500 server error', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    const provider = new GlmOcrProvider('key', 'https://api.example.com/ocr');

    await expect(provider.extractDocument('imgdata==')).rejects.toMatchObject({
      type: 'api_error',
      message: expect.stringContaining('500'),
    });
  });

  it('throws timeout error when request exceeds 30 seconds', async () => {
    vi.useFakeTimers();

    try {
      // Mock fetch to listen for abort signal and reject with AbortError when signalled.
      // Attach a no-op catch to prevent the internal promise from becoming an unhandled rejection
      // (the caller's await will catch it; the raw promise needs .catch() too).
      fetchSpy.mockImplementation((_url: unknown, options?: RequestInit) => {
        const p = new Promise<Response>((_resolve, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }
        });
        p.catch(() => {/* suppress unhandled-rejection on mock promise */});
        return p;
      });

      const provider = new GlmOcrProvider('key', 'https://api.example.com/ocr');
      // Attach catch immediately so Vitest doesn't see an unhandled rejection
      const promise = provider.extractDocument('imgdata==');
      const caught = promise.catch((e: unknown) => e);

      // Advance past the 30s timeout — triggers controller.abort() inside extractDocument
      await vi.advanceTimersByTimeAsync(30000);

      const error = await caught;
      expect(error).toMatchObject({
        type: 'timeout',
        message: expect.any(String),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws api_error on network failure', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    const provider = new GlmOcrProvider('key', 'https://api.example.com/ocr');

    await expect(provider.extractDocument('imgdata==')).rejects.toMatchObject({
      type: 'api_error',
      message: expect.stringContaining('Failed to fetch'),
    });
  });
});
