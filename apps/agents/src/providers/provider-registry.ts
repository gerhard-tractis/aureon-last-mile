// src/providers/provider-registry.ts — Model name → provider resolution

import { ClaudeProvider } from './claude';
import { GlmOcrProvider } from './glm-ocr';
import { GroqProvider } from './groq';
import type { LLMProvider } from './types';

export interface ProviderRegistryConfig {
  anthropicApiKey: string;
  groqApiKey: string;
  glmOcrApiKey: string;
  glmOcrEndpoint: string;
}

export class ProviderRegistry {
  private readonly config: ProviderRegistryConfig;
  private readonly cache = new Map<string, LLMProvider>();
  private glmOcrInstance: GlmOcrProvider | null = null;

  constructor(config: ProviderRegistryConfig) {
    this.config = config;
  }

  /**
   * Resolve a model name in the format "provider:model-name" to an LLMProvider.
   * Supported prefixes: "groq", "claude".
   */
  getProvider(modelName: string): LLMProvider {
    if (this.cache.has(modelName)) {
      return this.cache.get(modelName)!;
    }

    const colonIndex = modelName.indexOf(':');
    if (colonIndex === -1) {
      throw new Error(`Unknown provider prefix in model name: "${modelName}"`);
    }

    const prefix = modelName.slice(0, colonIndex);
    const model = modelName.slice(colonIndex + 1);

    let provider: LLMProvider;
    switch (prefix) {
      case 'groq':
        provider = new GroqProvider(this.config.groqApiKey, model);
        break;
      case 'claude':
        provider = new ClaudeProvider(this.config.anthropicApiKey, model);
        break;
      default:
        throw new Error(`Unknown provider prefix in model name: "${modelName}"`);
    }

    this.cache.set(modelName, provider);
    return provider;
  }

  /**
   * Returns the GlmOcrProvider instance (singleton per registry).
   */
  getGlmOcr(): GlmOcrProvider {
    if (!this.glmOcrInstance) {
      this.glmOcrInstance = new GlmOcrProvider(
        this.config.glmOcrApiKey,
        this.config.glmOcrEndpoint,
      );
    }
    return this.glmOcrInstance;
  }
}

export function createProviderRegistry(
  config: ProviderRegistryConfig,
): ProviderRegistry {
  return new ProviderRegistry(config);
}
