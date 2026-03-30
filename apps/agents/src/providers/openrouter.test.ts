import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenRouterProvider } from './openrouter';
import type { LLMRequest } from './types';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'openrouter' }));
    return provider;
  }),
}));

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const mockGenerateText = vi.mocked(generateText);
const mockCreateOpenAI = vi.mocked(createOpenAI);

const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct';

describe('OpenRouterProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOpenAI.mockReturnValue(
      Object.assign(
        vi.fn((modelId: string) => ({ modelId, provider: 'openrouter' })),
        { languageModel: vi.fn(), transcription: vi.fn(), imageModel: vi.fn() },
      ) as unknown as ReturnType<typeof createOpenAI>,
    );
  });

  it('constructs with default model', () => {
    const p = new OpenRouterProvider('key');
    expect(p.model).toBe(DEFAULT_MODEL);
  });

  it('constructs with custom model', () => {
    const p = new OpenRouterProvider('key', 'deepseek/deepseek-r1');
    expect(p.model).toBe('deepseek/deepseek-r1');
  });

  it('creates openai client pointing at OpenRouter base URL', () => {
    new OpenRouterProvider('my-or-key');
    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'my-or-key',
        baseURL: 'https://openrouter.ai/api/v1',
      }),
    );
  });

  it('maps response text and usage', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Hola',
      toolCalls: [],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      finishReason: 'stop',
      response: { id: 'or-1', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const p = new OpenRouterProvider('key');
    const result = await p.generate({ messages: [{ role: 'user', content: 'Hi' }] });

    expect(result.content).toBe('Hola');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
    expect(result.finishReason).toBe('stop');
  });

  it('maps tool_calls finish reason', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'foo', args: { x: 1 } }],
      usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
      finishReason: 'tool-calls',
      response: { id: 'or-2', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const p = new OpenRouterProvider('key');
    const result = await p.generate({ messages: [{ role: 'user', content: 'do' }] });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({ id: 'tc1', name: 'foo', arguments: { x: 1 } });
  });

  it('passes tools to generateText', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      finishReason: 'stop',
      response: { id: 'or-3', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const request: LLMRequest = {
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'myTool', description: 'does stuff', parameters: { type: 'object', properties: {} } }],
    };
    const p = new OpenRouterProvider('key');
    await p.generate(request);

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.tools).toHaveProperty('myTool');
  });

  it('throws on API failure', async () => {
    mockGenerateText.mockRejectedValue(new Error('OpenRouter 503'));
    const p = new OpenRouterProvider('key');
    await expect(p.generate({ messages: [{ role: 'user', content: 'hi' }] }))
      .rejects.toMatchObject({ message: expect.stringContaining('OpenRouter 503') });
  });
});
