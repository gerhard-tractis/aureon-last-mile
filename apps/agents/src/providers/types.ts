// src/providers/types.ts — LLM provider interface and shared types

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMRequest {
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  model: string;
  finishReason: 'stop' | 'tool_calls' | 'max_tokens' | 'error';
}

export interface LLMError {
  type: 'rate_limit' | 'timeout' | 'api_error' | 'network';
  message: string;
  retryable: boolean;
  fallback_hint?: string;
}

export interface LLMProvider {
  readonly model: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
}
