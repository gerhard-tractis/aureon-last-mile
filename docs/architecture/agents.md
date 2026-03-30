# Aureon Agent Suite -- Architecture Reference

> Read this document and `docs/architecture/frontend.md` before any agent implementation task.
> ADRs 007-011 in `docs/adr/` provide rationale for each major decision.
> Data model: `docs/architecture/agents-data-model.sql` | API design: `docs/architecture/agents-api-design.md`

_Date: 2026-03-17_

---

## 1. System Overview

```
                    +------------------+
                    |   Supabase       |
                    |  PostgreSQL      |
                    |  (RLS, audit)    |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v---+  +------v------+  +----v---------+
     | apps/      |  | apps/       |  | apps/        |
     | frontend   |  | mobile      |  | agents       |
     | (Vercel)   |  | (Expo)      |  | (VPS)        |
     +------------+  +-------------+  +----+---------+
                                           |
                          +----------------+----------------+
                          |                |                |
                   +------v------+  +------v------+  +-----v-------+
                   | BullMQ      |  | LLM         |  | External    |
                   | + Redis     |  | Providers   |  | APIs        |
                   | (queues)    |  | (OpenRouter:|  | (WhatsApp,  |
                   +-------------+  |  Gemini,    |  |  OR-Tools)  |
                                    |  Llama,     |  +-------------+
                                    |  DeepSeek)  |
                                    +-------------+
                                           |
                                    +------v------+
                                    | Python      |
                                    | OR-Tools    |
                                    | sidecar     |
                                    | (HTTP)      |
                                    +-------------+
```

### Execution Model

- **BullMQ** decides WHEN: cron schedules, event triggers, retries, rate limits
- **Agents** decide WHAT: select tools from a bounded set based on context
- **Tools** are TypeScript functions that read/write Supabase and call external APIs
- **Providers** abstract LLM and external API calls behind swappable interfaces

---

## 2. Cross-Cutting Concerns

### 2.1 Authentication & Tenant Isolation

**Agents authenticate to Supabase using a single service role key** (`SUPABASE_SERVICE_KEY`). This key bypasses RLS, so every tool function must enforce `operator_id` filtering explicitly in its queries.

```
Agent process boots
  -> reads SUPABASE_SERVICE_KEY from env
  -> creates one Supabase admin client (shared, connection-pooled)
  -> every tool call receives operator_id as a required parameter
  -> every SQL query includes WHERE operator_id = $operator_id
```

**Why not per-agent keys?** The agent system is a single trusted process on the VPS. Per-agent keys would require a key management system with no security benefit since all agents run in the same process. The operator_id enforcement happens at the tool level, not the connection level.

**Why not RLS with JWT?** The agent process is not a human user. Fabricating JWTs per operator would add complexity without benefit. Service role key + explicit operator_id filtering is the established pattern (see `apps/worker/src/db.ts` and `apps/frontend/src/lib/supabase/serverAdminClient.ts`).

**Invariant:** No tool function may execute a query without an `operator_id` filter. This is enforced by the tool function signature (operator_id is a required parameter) and verified in tests.

### 2.2 Error Handling

Three error categories, each with distinct handling:

#### LLM Call Failures

```
LLM call fails (timeout, rate limit, API error)
  -> Provider logs error with request_id, model, latency
  -> Provider returns { success: false, error, fallback_hint }
  -> Agent applies rules-based fallback for that domain:
       INTAKE agent: mark order as "needs_review", continue
       ASSIGNMENT agent: use round-robin assignment
       COORD agent: queue message for retry
       WISMO agent: respond with last known status from DB
  -> Event logged: { type: 'llm_fallback', agent, reason, fallback_action }
```

**Key principle:** The system must operate without LLM availability. Every agent domain has a deterministic fallback path. LLMs improve quality; they are not required for operation.

#### External API Failures (WhatsApp, OpenRouter, OR-Tools)

```
External API call fails
  -> Tool logs error with request_id, endpoint, status_code, latency
  -> BullMQ job moves to 'failed' state
  -> BullMQ retry with exponential backoff: 60s, 120s, 240s, 480s
  -> After max_retries (configurable per queue, default 4):
       Job moves to 'dead' (BullMQ dead letter)
       Event logged: { type: 'job_dead', queue, job_id, error }
       Alert sent to operator dashboard (Supabase Realtime)
```

**Rate limiting:** BullMQ's built-in rate limiter (`limiter: { max: N, duration: ms }`) prevents overwhelming external APIs. Each queue has its own rate limit matching the API's documented limits.

#### OR-Tools Sidecar Timeout

```
OR-Tools solve request
  -> HTTP POST to sidecar with deadline header (default 60s)
  -> If timeout:
       ASSIGNMENT agent uses greedy heuristic fallback
       Event logged: { type: 'solver_timeout', input_size, deadline_ms }
  -> If sidecar is down (health check fails):
       All assignment jobs queued with backoff until sidecar recovers
       Alert sent to operator dashboard
```

### 2.3 Logging & Audit Trail

Two logging layers serve different purposes:

#### Structured Process Logs (debugging, operations)

Every module uses a shared structured logger (extending the pattern from `apps/worker/src/logger.ts`):

```typescript
// Structured JSON to stdout, captured by journald on VPS
log('info', 'tool_executed', {
  agent: 'intake',
  tool: 'upsert_order',
  operator_id: '...',
  duration_ms: 42,
  result: 'success',
});
```

Log fields: `level`, `ts` (ISO 8601), `event` (dot-separated name), `agent`, `tool`, `operator_id`, `job_id`, `request_id`, plus context-specific metadata. Logs go to stdout and are captured by systemd journald.

#### Event Entity (audit trail, compliance)

Every agent action that mutates state writes an Event row to the `agent_events` table:

```
agent_events
  id              UUID PK
  operator_id     UUID NOT NULL (FK operators)
  agent_name      VARCHAR NOT NULL
  event_type      VARCHAR NOT NULL (tool_call, llm_fallback, error, decision)
  tool_name       VARCHAR
  input_summary   JSONB          -- sanitized input (no PII in large fields)
  output_summary  JSONB          -- sanitized result
  model_used      VARCHAR        -- which LLM model, if any
  duration_ms     INT
  job_id          UUID           -- FK to BullMQ job ID for correlation
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

This table is append-only (no UPDATE, no DELETE), partitioned by month, with 7-year retention per Chilean law. It serves as the immutable audit trail for all agent decisions.

The existing `audit_logs` table (triggered by `audit_trigger_func()`) continues capturing row-level changes to orders, manifests, and other tables. `agent_events` captures the agent-level reasoning -- why a change was made, not just what changed.

### 2.4 Configuration

Three configuration levels:

#### Operator Config (per-tenant, in Supabase)

Stored in `operator_config` table (or as JSONB column on `operators`):

```jsonc
{
  "timezone": "America/Santiago",
  "business_hours": { "start": "07:00", "end": "19:00" },
  "whatsapp_enabled": true,
  "auto_assignment_enabled": true,
  "escalation_email": "ops@musan.cl",
  "wismo_response_language": "es-CL"
}
```

#### Agent Config (per-agent, in code + overridable per operator)

```jsonc
// Default in code, overridable via operator_config.agents.intake
{
  "intake": {
    "schedule": "0 7,10,13,16 * * *",
    "max_retries": 4,
    "rate_limit": { "max": 10, "duration_ms": 60000 },
    "llm_model": "groq:llama-3.3-70b",
    "fallback_strategy": "mark_needs_review"
  },
  "assignment": {
    "schedule": "0 8,14 * * *",
    "solver_timeout_ms": 60000,
    "solver_fallback": "greedy_nearest",
    "llm_model": "claude:claude-sonnet-4-20250514"
  }
}
```

#### Generator Config (per-connector, in `tenant_clients.connector_config`)

Already exists in the database. Contains connector-specific settings: email filters, column maps, credentials (encrypted), scrape intervals. The agent system reads this at runtime, same as `apps/worker`.

### 2.5 Secrets Management

| Secret | Storage | Access Pattern |
|--------|---------|----------------|
| `SUPABASE_SERVICE_KEY` | VPS env (systemd EnvironmentFile) | Process startup |
| `REDIS_URL` | VPS env | Process startup |
| `ANTHROPIC_API_KEY` | VPS env | Provider init |
| `GROQ_API_KEY` | VPS env | Provider init |
| `OPENROUTER_API_KEY` | VPS env | Provider init |
| `WHATSAPP_API_TOKEN` | VPS env | Provider init |
| `WHATSAPP_PHONE_NUMBER_ID` | VPS env | Provider init |
| `CONNECTOR_ENCRYPTION_KEY` | VPS env | Decrypt `tenant_clients.connector_config` fields prefixed `ENCRYPTED:` |
| `SENTRY_DSN` | VPS env | Process startup |
| `BETTERSTACK_HEARTBEAT_URL` | VPS env | Health check |

All secrets live in the VPS systemd environment file (`/etc/aureon/agents.env`), readable only by the `aureon` user. No secrets in code, no secrets in Supabase, no secrets in Redis.

The `CONNECTOR_ENCRYPTION_KEY` pattern is inherited from `apps/worker` -- connector credentials in `tenant_clients.connector_config` use the `ENCRYPTED:` prefix and are decrypted at runtime by the tool that needs them.

---

## 3. Project Structure

### 3.1 apps/agents/ Directory Layout

```
apps/agents/
  src/
    index.ts                    # Entry point: init Redis, BullMQ, register queues
    config.ts                   # Load env vars, validate required secrets
    config.test.ts

    # --- Orchestration (BullMQ queues and workers) ---
    orchestration/
      queues.ts                 # Queue definitions (names, default opts, rate limits)
      queues.test.ts
      workers.ts                # Worker registrations (queue -> agent mapping)
      workers.test.ts
      schedulers.ts             # Cron schedules (repeatable jobs)
      schedulers.test.ts

    # --- Agents (one per domain) ---
    agents/
      base-agent.ts             # Abstract base: tool registry, execute loop, fallback
      base-agent.test.ts
      intake/
        intake-agent.ts         # INTAKE: Ingests orders from all channels
        intake-agent.test.ts
        intake-tools.ts         # Tool definitions for intake domain
        intake-tools.test.ts
        intake-fallback.ts      # Rules-based fallback when LLM unavailable
        intake-fallback.test.ts
      assignment/
        assignment-agent.ts     # ASSIGNMENT: Assigns orders to drivers
        assignment-agent.test.ts
        assignment-tools.ts
        assignment-tools.test.ts
        assignment-fallback.ts
        assignment-fallback.test.ts
      coord/
        coord-agent.ts          # COORD: WhatsApp driver coordination
        coord-agent.test.ts
        coord-tools.ts
        coord-tools.test.ts
        coord-fallback.ts
        coord-fallback.test.ts
      wismo/
        wismo-agent.ts          # WISMO: Client communication
        wismo-agent.test.ts
        wismo-tools.ts
        wismo-tools.test.ts
        wismo-fallback.ts
        wismo-fallback.test.ts
      settle/
        settle-agent.ts         # SETTLE: End-of-day reconciliation
        settle-agent.test.ts
        settle-tools.ts
        settle-tools.test.ts
        settle-fallback.ts
        settle-fallback.test.ts
      exception/
        exception-agent.ts      # EXCEPTION: Cross-cutting deviation handling
        exception-agent.test.ts
        exception-tools.ts
        exception-tools.test.ts
        exception-fallback.ts
        exception-fallback.test.ts

    # --- Tools (shared tool functions used by agents) ---
    tools/
      supabase/
        orders.ts               # upsert_order, get_order, update_order_status
        orders.test.ts
        packages.ts             # upsert_package, get_packages_by_order
        packages.test.ts
        drivers.ts              # get_available_drivers, update_driver_status
        drivers.test.ts
        events.ts               # log_agent_event (audit trail)
        events.test.ts
        config.ts               # read_operator_config, read_connector_config
        config.test.ts
      whatsapp/
        send-message.ts         # Send template/text message via WhatsApp Business API
        send-message.test.ts
        receive-webhook.ts      # Parse incoming WhatsApp webhook payload
        receive-webhook.test.ts
      ocr/
        extract-manifest.ts     # Call OpenRouter Gemini 2.5 Flash, return structured order/package data
        extract-manifest.test.ts
      solver/
        request-assignment.ts   # HTTP call to Python OR-Tools sidecar
        request-assignment.test.ts

    # --- Providers (LLM + external API abstractions) ---
    providers/
      types.ts                  # LLMProvider interface, LLMResponse, LLMError
      claude.ts                 # Anthropic Claude provider
      claude.test.ts
      groq.ts                   # Groq (Llama 3.3 70B) provider
      groq.test.ts
      provider-registry.ts     # Model name -> provider resolution
      provider-registry.test.ts
      circuit-breaker.ts        # Generic circuit breaker for all providers
      circuit-breaker.test.ts

    # --- Infrastructure ---
    lib/
      supabase-client.ts        # Singleton admin client (service role key)
      supabase-client.test.ts
      redis-client.ts           # ioredis connection with reconnect
      redis-client.test.ts
      logger.ts                 # Structured JSON logger (extends worker pattern)
      logger.test.ts
      crypto.ts                 # Decrypt ENCRYPTED: fields from connector_config
      crypto.test.ts
      health.ts                 # HTTP health endpoint for BetterStack
      health.test.ts

  package.json
  tsconfig.json
  vitest.config.ts
```

### 3.2 Monorepo Relationships

```
aureon-last-mile/
  apps/
    frontend/           # Reads agent_events for audit UI, operator_config for settings
    mobile/             # Receives push notifications triggered by COORD agent
    worker/             # Existing connectors (csv_email, beetrack) -- migrating out
    agents/             # NEW: BullMQ agent orchestrator
  packages/             # FUTURE: shared types, validation schemas
    types/              # OrderStatus, PackageStatus, etc. (currently in frontend/src/lib)
  supabase/
    migrations/         # Schema for agent_events, operator_config, etc.
  sidecar/
    or-tools/           # FUTURE: Python OR-Tools HTTP service
      solver.py
      requirements.txt
      Dockerfile
```

**Dependency direction (apps/agents internal):**

```
index.ts (entry point)
  |
  v
orchestration/ (queues, workers, schedulers)
  |
  v
agents/ (domain agents with tool registries)
  |
  v
tools/ (Supabase mutations, WhatsApp, OCR, solver)
  |
  v
providers/ (LLM abstractions, circuit breakers)
  |
  v
lib/ (Supabase client, Redis client, logger, crypto)
  |
  v
Supabase + Redis + External APIs
```

No upward imports. `tools/` never imports from `agents/`. `providers/` never imports from `tools/`. `lib/` never imports from `providers/`.

### 3.3 Relationship to apps/worker

During migration, both processes run on the VPS:

```
systemd
  |-- aureon-worker.service    (apps/worker -- node-cron, pg polling)
  |-- aureon-agents.service    (apps/agents -- BullMQ, Redis)
  |-- aureon-solver.service    (sidecar/or-tools -- Python HTTP)
  |-- redis-server.service     (Redis 7)
```

Both services write to the same Supabase database. Migration path:

1. `apps/agents` deployed alongside `apps/worker`
2. New intake connectors built in `apps/agents`
3. Existing Easy CSV connector moved from worker to agents
4. Existing Paris/Beetrack connector moved from worker to agents
5. `apps/worker` decommissioned (systemd service disabled)

### 3.4 Key File Responsibilities

| File | Responsibility | Max Lines |
|------|---------------|-----------|
| `index.ts` | Boot Redis, register queues/workers, graceful shutdown | ~80 |
| `config.ts` | Validate env vars, export typed config object | ~60 |
| `orchestration/queues.ts` | Define BullMQ Queue instances with rate limits | ~80 |
| `orchestration/workers.ts` | Map each queue to its agent's `process()` method | ~80 |
| `orchestration/schedulers.ts` | Register cron-repeatable jobs | ~60 |
| `agents/base-agent.ts` | Abstract class: tool registry, LLM call, fallback dispatch | ~150 |
| `agents/intake/*` | INTAKE agent: multi-channel order ingestion | ~150 |
| `agents/assignment/*` | ASSIGNMENT agent: OR-Tools optimization + driver binding | ~150 |
| `agents/coord/*` | COORD agent: WhatsApp driver coordination lifecycle | ~150 |
| `agents/wismo/*` | WISMO agent: client queries + proactive notifications | ~150 |
| `agents/settle/*` | SETTLE agent: end-of-day reconciliation + driver pay | ~150 |
| `agents/exception/*` | EXCEPTION agent: cross-cutting deviation handling | ~150 |
| `agents/*/XYZ-tools.ts` | Tool definitions (name, description, parameters, execute) | ~200 |
| `agents/*/XYZ-fallback.ts` | Rules-based fallback for when LLM is unavailable | ~100 |
| `tools/supabase/*.ts` | Single Supabase table CRUD operations | ~100 |
| `tools/whatsapp/*.ts` | WhatsApp Business API call wrappers | ~100 |
| `providers/*.ts` | LLM/API provider with circuit breaker | ~150 |
| `lib/*.ts` | Infrastructure singletons and utilities | ~80 |

All files target under 300 lines. Tests collocated as `*.test.ts`.

---

## 4. Quality Attributes Summary

| Attribute | Target | Mechanism |
|-----------|--------|-----------|
| WISMO response latency | < 30 seconds | Groq (fast inference) + cached last-known status in DB |
| Ingestion automation rate | 90%+ without manual intervention | LLM-powered field mapping + rules fallback |
| Audit completeness | 100% of agent actions logged | `agent_events` table (append-only) + `audit_logs` trigger |
| LLM failure resilience | System operates without LLM | Every agent has a rules-based fallback path |
| Tenant isolation | Zero cross-tenant data leakage | operator_id required parameter on every tool function |
| Retry reliability | No lost jobs | BullMQ persistent Redis-backed queues with dead letter |
| Secrets exposure | Zero secrets in logs or DB | Env-only secrets, sanitized log output |

---

## 5. ADR Index

| ADR | Title | Key Decision |
|-----|-------|-------------|
| [ADR-007](../adr/ADR-007-agentic-bounded-tools-over-deterministic-flows.md) | Agentic with bounded tools | Agents select tools; not hardcoded state machines |
| [ADR-008](../adr/ADR-008-bullmq-redis-over-n8n.md) | BullMQ + Redis over n8n | Custom queues replace visual workflow tool |
| [ADR-009](../adr/ADR-009-multi-model-strategy.md) | Multi-model strategy | OpenRouter: Gemini (vision), Llama (NLU), DeepSeek (reasoning) |
| [ADR-010](../adr/ADR-010-python-sidecar-for-or-tools.md) | Python sidecar for OR-Tools | Separate HTTP service for route optimization |
| [ADR-011](../adr/ADR-011-agents-as-separate-app.md) | apps/agents as separate app | New app, not worker extension; incremental migration |
