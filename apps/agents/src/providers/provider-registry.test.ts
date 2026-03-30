import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry, createProviderRegistry } from './provider-registry';
import { ClaudeProvider } from './claude';
import { GroqProvider } from './groq';
import { OpenRouterProvider } from './openrouter';

vi.mock('./claude', () => {
  const ClaudeProvider = vi.fn(function (this: Record<string, unknown>, apiKey: string, model?: string) {
    this.model = model ?? 'claude-4-sonnet-20250514';
    this.generate = vi.fn();
  });
  return { ClaudeProvider };
});

vi.mock('./groq', () => {
  const GroqProvider = vi.fn(function (this: Record<string, unknown>, apiKey: string, model?: string) {
    this.model = model ?? 'llama-3.3-70b-versatile';
    this.generate = vi.fn();
  });
  return { GroqProvider };
});

vi.mock('./openrouter', () => {
  const OpenRouterProvider = vi.fn(function (this: Record<string, unknown>, apiKey: string, model?: string) {
    this.model = model ?? 'meta-llama/llama-3.3-70b-instruct';
    this.generate = vi.fn();
  });
  return { OpenRouterProvider };
});

const config = {
  anthropicApiKey: 'anthropic-key',
  groqApiKey: 'groq-key',
  openrouterApiKey: 'openrouter-key',
};

describe('ProviderRegistry', () => {
  it('constructs via new ProviderRegistry', () => {
    const registry = new ProviderRegistry(config);
    expect(registry).toBeDefined();
  });

  it('constructs via createProviderRegistry factory', () => {
    const registry = createProviderRegistry(config);
    expect(registry).toBeDefined();
  });

  it('resolves groq:* to a GroqProvider', () => {
    const registry = new ProviderRegistry(config);
    const provider = registry.getProvider('groq:llama-3.3-70b-versatile');
    expect(provider).toBeDefined();
    expect(GroqProvider).toHaveBeenCalledWith(config.groqApiKey, 'llama-3.3-70b-versatile');
  });

  it('resolves claude:* to a ClaudeProvider', () => {
    const registry = new ProviderRegistry(config);
    const provider = registry.getProvider('claude:claude-4-sonnet-20250514');
    expect(provider).toBeDefined();
    expect(ClaudeProvider).toHaveBeenCalledWith(config.anthropicApiKey, 'claude-4-sonnet-20250514');
  });

  it('resolves openrouter:* to an OpenRouterProvider', () => {
    const registry = new ProviderRegistry(config);
    const provider = registry.getProvider('openrouter:meta-llama/llama-3.3-70b-instruct');
    expect(provider).toBeDefined();
    expect(OpenRouterProvider).toHaveBeenCalledWith(
      config.openrouterApiKey,
      'meta-llama/llama-3.3-70b-instruct',
    );
  });

  it('resolves groq:llama-3.1-8b-instant correctly', () => {
    const registry = new ProviderRegistry(config);
    registry.getProvider('groq:llama-3.1-8b-instant');
    expect(GroqProvider).toHaveBeenCalledWith(config.groqApiKey, 'llama-3.1-8b-instant');
  });

  it('throws for unknown provider prefix', () => {
    const registry = new ProviderRegistry(config);
    expect(() => registry.getProvider('openai:gpt-4')).toThrow(/unknown provider/i);
  });

  it('throws for model name without colon separator', () => {
    const registry = new ProviderRegistry(config);
    expect(() => registry.getProvider('llama-3.3-70b-versatile')).toThrow(/unknown provider/i);
  });

  it('returns same instance for same model on repeated calls', () => {
    const registry = new ProviderRegistry(config);
    const first = registry.getProvider('groq:llama-3.3-70b-versatile');
    const second = registry.getProvider('groq:llama-3.3-70b-versatile');
    expect(first).toBe(second);
  });
});
