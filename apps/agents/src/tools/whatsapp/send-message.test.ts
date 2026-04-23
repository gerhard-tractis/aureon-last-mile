import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendWhatsAppMessage } from './send-message';

const PHONE_NUMBER_ID = 'pnid-1';
const ACCESS_TOKEN = 'token-abc';

function mockFetch(status: number, json: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  });
}

describe('sendWhatsAppMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a text message and returns external_message_id', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { messages: [{ id: 'wamid.abc123' }] }));

    const result = await sendWhatsAppMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, {
      type: 'text',
      to: '+56912345678',
      body: 'Tu pedido está en camino.',
    });

    expect(result.external_message_id).toBe('wamid.abc123');
  });

  it('sends a template message', async () => {
    const fetchMock = mockFetch(200, { messages: [{ id: 'wamid.tmpl1' }] });
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendWhatsAppMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, {
      type: 'template',
      to: '+56987654321',
      template_name: 'order_eta',
      language_code: 'es_CL',
      components: [{ type: 'body', parameters: [{ type: 'text', text: '14:30' }] }],
    });

    expect(result.external_message_id).toBe('wamid.tmpl1');
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody.type).toBe('template');
    expect(callBody.template.name).toBe('order_eta');
  });

  it('calls the correct WhatsApp API endpoint with auth header', async () => {
    const fetchMock = mockFetch(200, { messages: [{ id: 'wamid.x' }] });
    vi.stubGlobal('fetch', fetchMock);

    await sendWhatsAppMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, {
      type: 'text',
      to: '+56900000001',
      body: 'Hola',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`);
    expect(init.headers['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
  });

  it('throws on non-2xx response', async () => {
    vi.stubGlobal('fetch', mockFetch(400, { error: { message: 'Bad request' } }));

    await expect(
      sendWhatsAppMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, {
        type: 'text',
        to: '+56900000002',
        body: 'oops',
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('400') });
  });

  it('returns empty string for missing message id gracefully', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { messages: [] }));

    const result = await sendWhatsAppMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, {
      type: 'text',
      to: '+56900000003',
      body: 'hi',
    });

    expect(result.external_message_id).toBe('');
  });

  describe('mock channel', () => {
    it('returns a MOCK- prefixed id and does NOT call fetch', async () => {
      const fetchMock = mockFetch(200, { messages: [{ id: 'wamid.never' }] });
      vi.stubGlobal('fetch', fetchMock);

      const result = await sendWhatsAppMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, {
        type: 'text',
        to: '+56900000004',
        body: 'mock test',
      }, 'mock');

      expect(result.external_message_id).toMatch(/^MOCK-/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('calls fetch normally when channel is whatsapp', async () => {
      const fetchMock = mockFetch(200, { messages: [{ id: 'wamid.real' }] });
      vi.stubGlobal('fetch', fetchMock);

      const result = await sendWhatsAppMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, {
        type: 'text',
        to: '+56900000005',
        body: 'real test',
      }, 'whatsapp');

      expect(result.external_message_id).toBe('wamid.real');
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('calls fetch normally when channel is undefined (default behaviour)', async () => {
      const fetchMock = mockFetch(200, { messages: [{ id: 'wamid.default' }] });
      vi.stubGlobal('fetch', fetchMock);

      const result = await sendWhatsAppMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, {
        type: 'text',
        to: '+56900000006',
        body: 'default test',
      });

      expect(result.external_message_id).toBe('wamid.default');
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });
});
