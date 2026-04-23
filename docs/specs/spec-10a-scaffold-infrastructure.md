# Spec-10a: Agent Suite — Scaffold + Infrastructure (Phase 0)

**Status:** completed

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> Architecture: `docs/architecture/agents.md` §3

_Date: 2026-03-18_

---

## Goal

Bootable `apps/agents/` Node.js process with all shared infrastructure, zero agents. Every subsequent phase builds on this foundation.

## Prerequisites

- Spec-09 completed (monorepo, `packages/database/`, npm workspaces)

## Deliverables

### Package Setup

- `apps/agents/package.json` — dependencies: bullmq, ioredis, @supabase/supabase-js, zod, ai (Vercel AI SDK), @ai-sdk/anthropic, vitest
- `apps/agents/tsconfig.json`
- `apps/agents/vitest.config.ts`

### Configuration

- `src/config.ts` — env var validation, typed config object
  - Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `GLM_OCR_API_KEY`, `GLM_OCR_ENDPOINT`, `ENCRYPTION_KEY`, `SENTRY_DSN`
  - Optional: `BETTERSTACK_HEARTBEAT_URL`, `WA_PHONE_NUMBER_ID`, `WA_ACCESS_TOKEN`, `WA_VERIFY_TOKEN`, `WA_APP_SECRET`
  - Fails fast on missing required vars with clear error messages

### Infrastructure (`src/lib/`)

- `supabase-client.ts` — singleton admin client (service role key, connection pooled)
- `redis-client.ts` — ioredis with reconnect logic, error logging
- `logger.ts` — structured JSON logger to stdout (extends `apps/worker/src/logger.ts` pattern): `level`, `ts` (ISO 8601), `event`, `agent`, `tool`, `operator_id`, `job_id`, `request_id`
- `crypto.ts` — decrypt `ENCRYPTED:` prefixed fields from `tenant_clients.connector_config`
- `health.ts` — HTTP health endpoint (port 3100) for BetterStack uptime monitoring

### Providers (`src/providers/`)

- `types.ts` — `LLMProvider` interface, `LLMResponse`, `LLMError` types
- `groq.ts` — Groq provider (Llama 3.3 70B) implementing `LLMProvider`
- `claude.ts` — Anthropic Claude provider implementing `LLMProvider`
- `glm-ocr.ts` — GLM-OCR document vision provider implementing `LLMProvider`
- `provider-registry.ts` — model name → provider resolution (e.g., `groq:llama-3.3-70b` → Groq instance)
- `circuit-breaker.ts` — generic circuit breaker: opens after N failures, half-open after timeout, closes on success

### Base Agent

- `src/agents/base-agent.ts` — abstract base class:
  - Tool registry (bounded tool set per agent)
  - Execute loop: LLM call → tool selection → tool execution → repeat until done or maxSteps
  - Fallback dispatch: when LLM unavailable, delegate to agent-specific fallback handler
  - Audit logging: every tool call → `agent_events`

### Entry Point

- `src/index.ts` — boots Redis connection, starts health endpoint, registers graceful shutdown (SIGTERM/SIGINT drain). No queues or workers yet.

### Deployment

- systemd unit file: `aureon-agents.service` (EnvironmentFile `/etc/aureon/agents.env`, User `aureon`, restart on failure)

## Exit Criteria

- `npm run dev` boots without errors, health endpoint responds 200
- Provider registry resolves all three model names to correct providers
- Circuit breaker opens after configured failures, recovers after timeout
- Logger outputs valid structured JSON to stdout
- Config validation rejects missing required env vars with descriptive errors
- Supabase client connects and can execute a simple query
- Redis client connects and can ping
- All files have collocated `*.test.ts` tests passing
- Every file under 300 lines
