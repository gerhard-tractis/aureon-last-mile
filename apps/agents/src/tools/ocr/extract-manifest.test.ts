import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractManifest, ExtractionResult, EXTRACTION_PROMPT } from './extract-manifest';

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn(() => 'mock-model')),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

import { generateText } from 'ai';

const mockGenerateText = vi.mocked(generateText);

describe('extractManifest', () => {
  const apiKey = 'test-openrouter-key';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts orders from valid JSON response', async () => {
    const mockResponse = {
      pickup_point_code: '400',
      pickup_point_name: 'Paris Maipú',
      orders: [
        {
          order_number: 'GU-001',
          customer_name: 'Juan Perez',
          customer_phone: '+56 9 1234 5678',
          delivery_address: 'Av. Providencia 1234',
          comuna: 'Providencia',
          delivery_date: '2026-03-29',
          packages: [
            {
              label: 'PKG-001',
              package_number: null,
              declared_box_count: 1,
              sku_items: [{ sku: 'SKU1', description: 'Caja A', quantity: 2 }],
              declared_weight_kg: 5.5,
            },
          ],
        },
      ],
    };

    mockGenerateText.mockResolvedValue({ text: JSON.stringify(mockResponse) } as never);

    const result = await extractManifest(apiKey, [Buffer.from('fake-image')]);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].order_number).toBe('GU-001');
    expect(result.orders[0].packages).toHaveLength(1);
    expect(result.orders[0].delivery_date).toBe('2026-03-29');
    expect(result.pickup_point_code).toBe('400');
    expect(result.pickup_point_name).toBe('Paris Maipú');
  });

  it('returns error for illegible manifest', async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ orders: [], error: 'ilegible' }),
    } as never);

    const result = await extractManifest(apiKey, [Buffer.from('blurry')]);
    expect(result.orders).toHaveLength(0);
    expect(result.error).toBe('ilegible');
  });

  it('handles nullable fields in extraction', async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        pickup_point_code: null,
        pickup_point_name: null,
        orders: [{
          order_number: 'GU-002',
          customer_name: null,
          customer_phone: null,
          delivery_address: null,
          comuna: null,
          delivery_date: null,
          packages: [],
        }],
      }),
    } as never);

    const result = await extractManifest(apiKey, [Buffer.from('partial')]);
    expect(result.orders[0].customer_name).toBeNull();
    expect(result.orders[0].delivery_date).toBeNull();
    expect(result.pickup_point_code).toBeNull();
  });

  it('throws on invalid JSON response', async () => {
    mockGenerateText.mockResolvedValue({ text: 'not json at all' } as never);
    await expect(extractManifest(apiKey, [Buffer.from('bad')])).rejects.toThrow();
  });

  it('sends all images in one API call', async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({ pickup_point_code: null, pickup_point_name: null, orders: [] }),
    } as never);

    const images = [Buffer.from('page1'), Buffer.from('page2'), Buffer.from('page3')];
    await extractManifest(apiKey, images);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const call = mockGenerateText.mock.calls[0][0] as { messages: Array<{ content: unknown[] }> };
    expect(call.messages[0].content).toHaveLength(4); // 3 images + 1 text
  });

  it('strips markdown code fences from response', async () => {
    const json = JSON.stringify({ pickup_point_code: null, pickup_point_name: null, orders: [] });
    mockGenerateText.mockResolvedValue({ text: '```json\n' + json + '\n```' } as never);

    const result = await extractManifest(apiKey, [Buffer.from('fenced')]);
    expect(result.orders).toHaveLength(0);
  });

  it('includes extraction prompt with required fields', () => {
    expect(EXTRACTION_PROMPT).toContain('JSON valido');
    expect(EXTRACTION_PROMPT).toContain('order_number');
    expect(EXTRACTION_PROMPT).toContain('delivery_date');
    expect(EXTRACTION_PROMPT).toContain('customer_name');
    expect(EXTRACTION_PROMPT).toContain('comuna');
  });
});
