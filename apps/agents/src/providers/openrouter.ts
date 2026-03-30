// src/providers/openrouter.ts — OpenRouter provider via OpenAI-compatible API

import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { LLMProvider, LLMRequest, LLMResponse, ToolCall } from './types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct';

function mapFinishReason(reason: string): LLMResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool-calls':
      return 'tool_calls';
    case 'length':
      return 'max_tokens';
    case 'error':
      return 'error';
    default:
      return 'stop';
  }
}

export class OpenRouterProvider implements LLMProvider {
  readonly model: string;
  private readonly openai: ReturnType<typeof createOpenAI>;

  constructor(apiKey: string, model = DEFAULT_MODEL) {
    this.model = model;
    this.openai = createOpenAI({
      apiKey,
      baseURL: OPENROUTER_BASE_URL,
    });
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const tools = request.tools
      ? Object.fromEntries(
          request.tools.map((t) => [
            t.name,
            { description: t.description, parameters: t.parameters },
          ]),
        )
      : undefined;

    try {
      const result = await generateText({
        model: this.openai(this.model),
        messages: request.messages,
        ...(tools !== undefined && { tools: tools as Parameters<typeof generateText>[0]['tools'] }),
        ...(request.maxTokens !== undefined && { maxTokens: request.maxTokens }),
        ...(request.temperature !== undefined && { temperature: request.temperature }),
      });

      const toolCalls: ToolCall[] = (result.toolCalls ?? []).map(
        (tc: { toolCallId: string; toolName: string; args: Record<string, unknown> }) => ({
          id: tc.toolCallId,
          name: tc.toolName,
          arguments: tc.args,
        }),
      );

      return {
        content: result.text,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        usage: {
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
        },
        model: this.model,
        finishReason: mapFinishReason(result.finishReason),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  }
}
