import { describe, it, expect, vi } from 'vitest';
import { ProviderRegistry, createProviderRegistry } from './provider-registry';
import { OpenRouterProvider } from './openrouter';

vi.mock('./openrouter', () => {
  const OpenRouterProvider = vi.fn(function (this: Record<string, unknown>, apiKey: string, model?: string) {
    this.model = model ?? 'meta-llama/llama-3.3-70b-instruct';
    this.generate = vi.fn();
  });
  return { OpenRouterProvider };
});

const config = {
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

  it('resolves openrouter:* to an OpenRouterProvider', () => {
    const registry = new ProviderRegistry(config);
    const provider = registry.getProvider('openrouter:meta-llama/llama-3.3-70b-instruct');
    expect(provider).toBeDefined();
    expect(OpenRouterProvider).toHaveBeenCalledWith(
      config.openrouterApiKey,
      'meta-llama/llama-3.3-70b-instruct',
    );
  });

  it('throws for unknown provider prefix', () => {
    const registry = new ProviderRegistry(config);
    expect(() => registry.getProvider('openai:gpt-4')).toThrow(/unknown provider/i);
  });

  it('throws for groq prefix (removed provider)', () => {
    const registry = new ProviderRegistry(config);
    expect(() => registry.getProvider('groq:llama-3.3-70b-versatile')).toThrow(/unknown provider/i);
  });

  it('throws for claude prefix (removed provider)', () => {
    const registry = new ProviderRegistry(config);
    expect(() => registry.getProvider('claude:claude-4-sonnet-20250514')).toThrow(/unknown provider/i);
  });

  it('throws for model name without colon separator', () => {
    const registry = new ProviderRegistry(config);
    expect(() => registry.getProvider('llama-3.3-70b-versatile')).toThrow(/unknown provider/i);
  });

  it('returns same instance for same model on repeated calls', () => {
    const registry = new ProviderRegistry(config);
    const first = registry.getProvider('openrouter:meta-llama/llama-3.3-70b-instruct');
    const second = registry.getProvider('openrouter:meta-llama/llama-3.3-70b-instruct');
    expect(first).toBe(second);
  });
});
