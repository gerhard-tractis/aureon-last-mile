# ADR-009: Multi-Model Strategy (Claude + Groq + GLM-OCR)

**Status:** Accepted
**Date:** 2026-03-17
**Deciders:** Development Team

---

## Context

The agent system requires AI capabilities across three distinct workload profiles: (1) high-volume natural language understanding for WhatsApp messages, delivery status parsing, and address normalization (thousands/day); (2) complex reasoning for exception handling, SLA negotiation, and multi-step decision-making (dozens/day); (3) document vision for OCR on delivery receipts, manifests, and proof-of-delivery photos (hundreds/day).

## Decision

Use three specialized models, each matched to its workload:

- **Groq (Llama 3.3 70B):** High-volume NLU -- WhatsApp intent classification, address normalization, status extraction. Selected for speed (tokens/s) and cost at volume.
- **Claude (Anthropic):** Complex reasoning -- exception resolution, multi-step planning, escalation decisions. Selected for accuracy on nuanced logistics scenarios.
- **GLM-OCR API:** Document vision -- extract structured data from delivery receipts, manifests, photos. Selected as a dedicated OCR service (not a general-purpose vision model).

All model calls go through a provider abstraction layer (`providers/`) so models can be swapped without changing agent code.

## Rationale

No single model optimizes for all three workloads simultaneously. Groq's Llama 3.3 70B processes WhatsApp messages at ~500 tokens/s with sub-second latency, critical for the <30s WISMO response SLA. Claude excels at the complex reasoning needed for exception handling but is too expensive and slow for high-volume NLU. GLM-OCR is purpose-built for document extraction, outperforming general vision models on structured document layouts.

The provider abstraction means the system is not locked into any specific model. If Groq pricing changes or a better OCR service appears, only the provider implementation changes.

## Rejected Alternatives

**Single model for everything (Claude only).** Rejected because: (1) cost-prohibitive at high volume (thousands of WhatsApp messages/day through Claude); (2) latency too high for real-time WISMO responses; (3) Claude's vision capabilities are general-purpose, not optimized for structured document OCR.

**Single model for everything (Groq/Llama only).** Rejected because: (1) Llama 3.3 70B lacks the reasoning depth for complex exception handling (multi-step SLA analysis, cross-referencing operator policies); (2) no vision capability for document OCR.

**OpenAI GPT-4o for all tasks.** Rejected because: (1) higher cost than Groq for high-volume NLU; (2) vision capabilities exist but OCR accuracy on Chilean logistics documents (Spanish, mixed layouts) is unproven; (3) rate limits are more restrictive than Groq for burst traffic.

**Self-hosted models on VPS.** Rejected because: (1) VPS does not have GPU; (2) CPU inference for 70B models is impractically slow; (3) operational burden of model serving, updates, and monitoring.

## Consequences

- Three sets of API keys to manage (Groq, Anthropic, GLM-OCR)
- Provider abstraction layer must normalize response formats across models
- Each provider must implement circuit breaker + fallback (Groq down -> queue messages; Claude down -> apply rules-based fallback)
- Cost monitoring per model per operator required
- Model selection is an agent-level configuration, not hardcoded in tools
