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

// Shared with non-LLM providers (spec-58's geocoding adapter). Extracted out
// of LLMError so a geocoding failure is not typed as an LLM error just for
// wanting to reuse this vocabulary — see providers/geocoding/maptiler.ts,
// which extends this union with 'credential' rather than importing LLMError.
export type ProviderErrorType = 'rate_limit' | 'timeout' | 'api_error' | 'network';

export interface LLMError {
  type: ProviderErrorType;
  message: string;
  retryable: boolean;
  fallback_hint?: string;
}

export interface LLMProvider {
  readonly model: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
}
