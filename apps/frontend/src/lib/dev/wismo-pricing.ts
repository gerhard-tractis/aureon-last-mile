// Pricing per million tokens (USD) for each WISMO test model.
// Source: OpenRouter catalog at spec-write time 2026-04-23.
// input/output are per-million-token rates in USD.

export const WISMO_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'meta-llama/llama-3.1-8b-instruct':           { input: 0.02, output: 0.05 },
  'qwen/qwen-2.5-7b-instruct':                  { input: 0.04, output: 0.09 },
  'google/gemini-2.5-flash-lite-preview-06-17': { input: 0.10, output: 0.40 },
  'mistralai/ministral-8b':                     { input: 0.10, output: 0.10 },
  'google/gemini-2.5-flash':                    { input: 0.30, output: 2.50 },
  'openai/gpt-4o-mini':                         { input: 0.15, output: 0.60 },
  'meta-llama/llama-3.3-70b-instruct':          { input: 0.13, output: 0.40 },
  'qwen/qwen-2.5-72b-instruct':                 { input: 0.35, output: 0.40 },
};

/**
 * Estimate cost in USD for a given model run.
 * @param model   OpenRouter model ID
 * @param tokensIn  Number of input tokens consumed
 * @param tokensOut Number of output tokens produced
 * @returns Estimated cost in USD, or 0 if the model is not found.
 */
export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = WISMO_MODEL_PRICING[model];
  if (!p) return 0;
  return (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
}
