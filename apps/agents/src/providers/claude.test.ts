import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeProvider } from './claude';
import type { LLMRequest } from './types';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'anthropic' }));
    return provider;
  }),
}));

import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

const mockGenerateText = vi.mocked(generateText);
const mockCreateAnthropic = vi.mocked(createAnthropic);

const DEFAULT_MODEL = 'claude-4-sonnet-20250514';

describe('ClaudeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateAnthropic.mockReturnValue(
      Object.assign(
        vi.fn((modelId: string) => ({ modelId, provider: 'anthropic' })),
        { languageModel: vi.fn(), textEmbeddingModel: vi.fn(), imageModel: vi.fn() }
      ) as unknown as ReturnType<typeof createAnthropic>
    );
  });

  it('constructs with default model', () => {
    const provider = new ClaudeProvider('test-key');
    expect(provider.model).toBe(DEFAULT_MODEL);
  });

  it('constructs with custom model', () => {
    const provider = new ClaudeProvider('test-key', 'claude-3-5-sonnet-20241022');
    expect(provider.model).toBe('claude-3-5-sonnet-20241022');
  });

  it('calls generateText with correct parameters', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Hello',
      toolCalls: [],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
      response: { id: 'r1', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const provider = new ClaudeProvider('test-key');
    const request: LLMRequest = {
      messages: [{ role: 'user', content: 'Hello' }],
      maxTokens: 100,
      temperature: 0.5,
    };

    await provider.generate(request);

    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'Hello' }]);
    expect(callArgs.maxTokens).toBe(100);
    expect(callArgs.temperature).toBe(0.5);
    expect(callArgs.model).toBeDefined();
  });

  it('maps tool definitions to AI SDK tool format', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      finishReason: 'stop',
      response: { id: 'r2', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const provider = new ClaudeProvider('test-key');
    const request: LLMRequest = {
      messages: [{ role: 'user', content: 'Do something' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      ],
    };

    await provider.generate(request);

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.tools).toBeDefined();
    expect(callArgs.tools).toHaveProperty('get_weather');
    const weatherTool = (callArgs.tools as Record<string, unknown>)['get_weather'] as Record<string, unknown>;
    expect(weatherTool.description).toBe('Get weather for a city');
  });

  it('maps response text and usage correctly', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'The answer is 42',
      toolCalls: [],
      usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 },
      finishReason: 'stop',
      response: { id: 'r3', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const provider = new ClaudeProvider('test-key');
    const result = await provider.generate({
      messages: [{ role: 'user', content: 'Question' }],
    });

    expect(result.content).toBe('The answer is 42');
    expect(result.model).toBe(DEFAULT_MODEL);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 8 });
    expect(result.finishReason).toBe('stop');
  });

  it('maps tool_calls finish reason', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'get_weather',
          args: { city: 'Berlin' },
        },
      ],
      usage: { promptTokens: 15, completionTokens: 10, totalTokens: 25 },
      finishReason: 'tool-calls',
      response: { id: 'r4', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const provider = new ClaudeProvider('test-key');
    const result = await provider.generate({
      messages: [{ role: 'user', content: 'Weather?' }],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      id: 'call_1',
      name: 'get_weather',
      arguments: { city: 'Berlin' },
    });
  });

  it('maps max_tokens finish reason', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Truncated',
      toolCalls: [],
      usage: { promptTokens: 5, completionTokens: 100, totalTokens: 105 },
      finishReason: 'length',
      response: { id: 'r5', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const provider = new ClaudeProvider('test-key');
    const result = await provider.generate({
      messages: [{ role: 'user', content: 'Tell me a story' }],
    });

    expect(result.finishReason).toBe('max_tokens');
  });

  it('throws LLMError on API failure', async () => {
    mockGenerateText.mockRejectedValue(new Error('API rate limit exceeded'));

    const provider = new ClaudeProvider('test-key');

    await expect(
      provider.generate({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({
      message: expect.stringContaining('API rate limit exceeded'),
    });
  });

  it('creates anthropic provider with the provided API key', () => {
    new ClaudeProvider('my-secret-key');
    expect(mockCreateAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'my-secret-key' })
    );
  });
});
