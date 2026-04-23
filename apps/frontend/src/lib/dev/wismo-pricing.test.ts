import { describe, it, expect } from 'vitest';
import { estimateCost, WISMO_MODEL_PRICING } from './wismo-pricing';

describe('estimateCost', () => {
  it('returns 0 for unknown model', () => {
    expect(estimateCost('unknown/model', 1000, 500)).toBe(0);
  });

  it('returns 0 for empty string model', () => {
    expect(estimateCost('', 1000, 500)).toBe(0);
  });

  it('handles zero tokens', () => {
    expect(estimateCost('meta-llama/llama-3.3-70b-instruct', 0, 0)).toBe(0);
  });

  it('calculates cost for llama-3.3-70b correctly', () => {
    // input: 1M tokens × $0.13 + output: 1M tokens × $0.40
    const cost = estimateCost('meta-llama/llama-3.3-70b-instruct', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.53, 5);
  });

  it('calculates cost for llama-3.1-8b correctly', () => {
    // input: 500K × 0.02 + output: 200K × 0.05 = 0.01 + 0.01 = 0.02
    const cost = estimateCost('meta-llama/llama-3.1-8b-instruct', 500_000, 200_000);
    expect(cost).toBeCloseTo(0.02, 5);
  });

  it('pricing table has entries for all 8 curated models', () => {
    const models = [
      'meta-llama/llama-3.1-8b-instruct',
      'qwen/qwen-2.5-7b-instruct',
      'google/gemini-2.5-flash-lite-preview-06-17',
      'mistralai/ministral-8b',
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
      'meta-llama/llama-3.3-70b-instruct',
      'qwen/qwen-2.5-72b-instruct',
    ];
    for (const m of models) {
      expect(WISMO_MODEL_PRICING[m], `Missing pricing for ${m}`).toBeDefined();
    }
  });
});
