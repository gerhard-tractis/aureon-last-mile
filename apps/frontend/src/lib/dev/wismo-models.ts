// Model IDs verified against OpenRouter catalog at spec-write time 2026-04-23.
// These IDs are authoritative per spec-36 and should not be changed without
// re-verifying against https://openrouter.ai/models at that time.
//
// Model IDs used:
//   meta-llama/llama-3.1-8b-instruct
//   qwen/qwen-2.5-7b-instruct
//   google/gemini-2.5-flash-lite-preview-06-17
//   mistralai/ministral-8b
//   google/gemini-2.5-flash
//   openai/gpt-4o-mini
//   meta-llama/llama-3.3-70b-instruct
//   qwen/qwen-2.5-72b-instruct

export const WISMO_TEST_MODELS = [
  { id: 'meta-llama/llama-3.1-8b-instruct',              label: 'Llama 3.1 8B  · ~$0.02/M' },
  { id: 'qwen/qwen-2.5-7b-instruct',                     label: 'Qwen 2.5 7B   · ~$0.04/M' },
  { id: 'google/gemini-2.5-flash-lite-preview-06-17',    label: 'Gemini 2.5 Flash Lite · ~$0.10/M' },
  { id: 'mistralai/ministral-8b',                        label: 'Ministral 8B  · ~$0.10/M' },
  { id: 'google/gemini-2.5-flash',                       label: 'Gemini 2.5 Flash · ~$0.30/M' },
  { id: 'openai/gpt-4o-mini',                            label: 'GPT-4o mini    · ~$0.15/M' },
  { id: 'meta-llama/llama-3.3-70b-instruct',             label: 'Llama 3.3 70B (default) · ~$0.13/M' },
  { id: 'qwen/qwen-2.5-72b-instruct',                    label: 'Qwen 2.5 72B   · ~$0.35/M' },
];

export const DEFAULT_WISMO_MODEL = 'meta-llama/llama-3.3-70b-instruct';
