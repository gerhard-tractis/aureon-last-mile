import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GroqProvider } from './groq';
import type { LLMRequest } from './types';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

vi.mock('@ai-sdk/groq', () => ({
  createGroq: vi.fn(() => {
    const provider = vi.fn((modelId: string) => ({ modelId, provider: 'groq' }));
    return provider;
  }),
}));

import { generateText } from 'ai';
import { createGroq } from '@ai-sdk/groq';

const mockGenerateText = vi.mocked(generateText);
const mockCreateGroq = vi.mocked(createGroq);

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

describe('GroqProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateGroq.mockReturnValue(
      Object.assign(
        vi.fn((modelId: string) => ({ modelId, provider: 'groq' })),
        { languageModel: vi.fn(), transcription: vi.fn() }
      ) as unknown as ReturnType<typeof createGroq>
    );
  });

  it('constructs with default model', () => {
    const provider = new GroqProvider('test-key');
    expect(provider.model).toBe(DEFAULT_MODEL);
  });

  it('constructs with custom model', () => {
    const provider = new GroqProvider('test-key', 'llama-3.1-8b-instant');
    expect(provider.model).toBe('llama-3.1-8b-instant');
  });

  it('creates groq provider with the provided API key', () => {
    new GroqProvider('my-groq-key');
    expect(mockCreateGroq).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'my-groq-key' })
    );
  });

  it('calls generateText with correct model and params', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Hello from Groq',
      toolCalls: [],
      usage: { promptTokens: 12, completionTokens: 6, totalTokens: 18 },
      finishReason: 'stop',
      response: { id: 'g1', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const provider = new GroqProvider('test-key');
    const request: LLMRequest = {
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 200,
      temperature: 0.7,
    };

    await provider.generate(request);

    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(callArgs.maxTokens).toBe(200);
    expect(callArgs.temperature).toBe(0.7);
    expect(callArgs.model).toBeDefined();
  });

  it('maps response text and usage correctly', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Groq response',
      toolCalls: [],
      usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
      finishReason: 'stop',
      response: { id: 'g2', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const provider = new GroqProvider('test-key');
    const result = await provider.generate({
      messages: [{ role: 'user', content: 'Question' }],
    });

    expect(result.content).toBe('Groq response');
    expect(result.model).toBe(DEFAULT_MODEL);
    expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 4 });
    expect(result.finishReason).toBe('stop');
  });

  it('maps tool_calls finish reason and tool calls', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [
        {
          type: 'tool-call',
          toolCallId: 'tc_1',
          toolName: 'search',
          args: { query: 'weather' },
        },
      ],
      usage: { promptTokens: 10, completionTokens: 7, totalTokens: 17 },
      finishReason: 'tool-calls',
      response: { id: 'g3', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const provider = new GroqProvider('test-key');
    const result = await provider.generate({
      messages: [{ role: 'user', content: 'Search' }],
    });

    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]).toEqual({
      id: 'tc_1',
      name: 'search',
      arguments: { query: 'weather' },
    });
  });

  it('maps tool definitions correctly', async () => {
    mockGenerateText.mockResolvedValue({
      text: '',
      toolCalls: [],
      usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      finishReason: 'stop',
      response: { id: 'g4', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const provider = new GroqProvider('test-key');
    const request: LLMRequest = {
      messages: [{ role: 'user', content: 'Do something' }],
      tools: [
        {
          name: 'calculate',
          description: 'Perform a calculation',
          parameters: {
            type: 'object',
            properties: { expression: { type: 'string' } },
            required: ['expression'],
          },
        },
      ],
    };

    await provider.generate(request);

    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs.tools).toHaveProperty('calculate');
    const calcTool = (callArgs.tools as Record<string, unknown>)['calculate'] as Record<string, unknown>;
    expect(calcTool.description).toBe('Perform a calculation');
  });

  it('maps max_tokens finish reason', async () => {
    mockGenerateText.mockResolvedValue({
      text: 'Partial',
      toolCalls: [],
      usage: { promptTokens: 5, completionTokens: 50, totalTokens: 55 },
      finishReason: 'length',
      response: { id: 'g5', modelId: DEFAULT_MODEL, timestamp: new Date() },
      steps: [],
      warnings: undefined,
    } as unknown as Awaited<ReturnType<typeof generateText>>);

    const provider = new GroqProvider('test-key');
    const result = await provider.generate({
      messages: [{ role: 'user', content: 'Long story' }],
    });

    expect(result.finishReason).toBe('max_tokens');
  });

  it('throws on API failure', async () => {
    mockGenerateText.mockRejectedValue(new Error('Groq service error'));

    const provider = new GroqProvider('test-key');

    await expect(
      provider.generate({ messages: [{ role: 'user', content: 'hi' }] })
    ).rejects.toMatchObject({
      message: expect.stringContaining('Groq service error'),
    });
  });
});
