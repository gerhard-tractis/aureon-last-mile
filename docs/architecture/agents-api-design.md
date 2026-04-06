# Aureon Agent Suite — API & Communication Design

> Reference document for the communication layer between agents, queues, external APIs, and the dashboard.
> Read alongside `docs/agents-architecture.md` and `docs/plans/agent-suite-data-model.sql`.

_Date: 2026-03-18_

---

## 1. BullMQ Queue Architecture

### 1.1 Queue Map

| Queue | Jobs | Concurrency | Rate Limit | Retry |
|-------|------|-------------|------------|-------|
| `intake.ingest` | email_parse, photo_parse, file_upload, batch_reparse | 3 | — | 3x exp (1m base) |
| `assignment.optimize` | batch_assign, reoptimize | 1 | — | 2x (2m base) |
| `coord.lifecycle` | new_assignment, driver_message, check_timer, escalation_timeout | 5 | — | 3x (30s base) |
| `wismo.client` | client_message, proactive_eta, proactive_delay | 5 | — | 3x (30s base) |
| `settle.reconcile` | eod_reconcile, generate_report, flag_issue | 1 | — | 3x (5m base) |
| `whatsapp.outbound` | send_template, send_text, send_media | 10 | 60/min per phone | 3x (10s base) |
| `legacy.worker` | csv_email, browser (migrated from pg poll) | 1 | — | 3x (60s base) |

### 1.2 Priority System

```
Priority 10: Human escalations, manual overrides from dashboard
Priority  7: Real-time coordination (driver_message, client_message)
Priority  5: Standard operations (batch_assign, new_assignment)
Priority  3: Proactive notifications (proactive_eta, proactive_delay)
Priority  1: Background batch (eod_reconcile, generate_report, legacy)
```

### 1.3 Repeatable Jobs (Cron)

| Schedule | Queue | Job | TZ |
|----------|-------|-----|-----|
| `*/15 * * * *` | intake.ingest | email_parse | America/Santiago |
| `0 6,14 * * *` | assignment.optimize | batch_assign | America/Santiago |
| `0 22 * * *` | settle.reconcile | eod_reconcile | America/Santiago |
| `0 7,10,13,16 * * *` | legacy.worker | browser | America/Santiago |

### 1.4 Parent→Child Job Flows

```
INTAKE email_parse (parent)
  ├── child: ASSIGNMENT batch_assign  (when enough orders accumulate)
  └── child: WISMO proactive_eta     (confirm receipt to sender)

ASSIGNMENT batch_assign (parent)
  ├── child: COORD new_assignment (per driver)
  ├── child: COORD new_assignment (per driver)
  └── child: COORD new_assignment (per driver)

COORD new_assignment (parent)
  ├── child: WHATSAPP send_template (route sheet to driver)
  └── child: COORD check_timer (delayed 30m: did driver confirm?)
```

---

## 2. Agent↔Tool Communication

### 2.1 Tool Contract

```typescript
interface ToolDefinition<TInput, TOutput> {
  name: string;
  description: string;                    // For LLM function-calling schema
  inputSchema: z.ZodType<TInput>;         // Zod schema → JSON Schema
  execute: (input: TInput, ctx: ToolContext) => Promise<ToolResult<TOutput>>;
}

interface ToolContext {
  operatorId: string;                     // Always present — multi-tenant
  agentId: AgentType;                     // Which agent invoked this
  jobId: string;                          // BullMQ job ID for tracing
  supabase: SupabaseClient;              // service_role client
  logger: Logger;
  enqueue: (queue: string, data: unknown, opts?: JobOpts) => Promise<string>;
}

type ToolResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; retryable: boolean };
```

### 2.2 Agent Definition

```typescript
interface AgentDefinition {
  id: 'INTAKE' | 'ASSIGNMENT' | 'COORD' | 'WISMO' | 'SETTLE' | 'EXCEPTION';
  model: string;                          // e.g., 'groq:llama-3.3-70b', 'anthropic:claude-sonnet'
  systemPrompt: string;
  tools: ToolDefinition<any, any>[];      // Bounded set per agent
  maxSteps: number;                       // Safety limit
  maxTokens: number;
  temperature: number;
}
```

### 2.3 Tool Registry Per Agent

| Agent | Tools |
|-------|-------|
| **INTAKE** | parse_excel, parse_with_vision (→GLM-OCR), geocode_address, create_order, confirm_to_sender, flag_parsing_error |
| **ASSIGNMENT** | get_available_drivers, optimize_route (→OR-Tools), assign_driver, escalate_no_capacity |
| **COORD** | send_whatsapp, update_eta, reassign_driver, mark_delivered, create_exception, escalate_to_human |
| **WISMO** | get_order_status, send_client_update, reschedule_delivery, escalate_to_human |
| **SETTLE** | reconcile_orders, calculate_driver_pay, generate_report, flag_discrepancy |
| **EXCEPTION** | classify_exception, auto_resolve, escalate_to_human, notify_supervisor |

### 2.4 Error Handling

```
Tool returns { success: false, retryable: true }
  → Agent may retry with different params (counts against maxSteps)

Tool returns { success: false, retryable: false }
  → Agent must escalate_to_human or abort

Tool throws exception
  → Caught by runner, logged to Sentry
  → Job retries per BullMQ policy
  → After max retries: dead letter + dashboard alert

LLM returns invalid tool call
  → Zod validation rejects, retried within agent loop
```

---

## 3. WhatsApp Integration

### 3.1 Inbound Flow

```
WhatsApp Cloud API
       │
       ▼
Supabase Edge Function: whatsapp-webhook
  1. Verify X-Hub-Signature-256
  2. Parse message
  3. Route by sender:
     ├── Known driver phone → coord.lifecycle { type: 'driver_message' }
     ├── Known customer phone → wismo.client { type: 'client_message' }
     ├── Media + intake hint → intake.ingest { type: 'photo_parse' }
     └── Unknown → wismo.client { type: 'client_message', flag: 'unknown' }
  4. Return 200 immediately (<5s)
```

### 3.2 Message Routing Logic

```
Step 1: Normalize phone → E.164 (+569XXXXXXXX)
Step 2: Check drivers table (operator_id, phone) → COORD
Step 3: Check orders (operator_id, customer_phone, active) → WISMO
Step 4: Check media type + text hints → INTAKE
Step 5: Default → WISMO with unknown_sender flag
```

### 3.3 Outbound Flow

All outbound messages go through `whatsapp.outbound` queue:
- Rate limited: 60/min per recipient phone
- Every message logged to `conversation_messages` table
- Agent tools call `enqueue('whatsapp.outbound', ...)` — never call WA API directly

---

## 4. OR-Tools Service Contract

### 4.1 Architecture

```
ASSIGNMENT agent (Node.js)  →  HTTP POST  →  Python sidecar (:8090)
                            ←  JSON        ←  FastAPI + CP-SAT
```

### 4.2 Request: POST /api/v1/optimize

```typescript
{
  operator_id: string;
  delivery_date: string;               // 'YYYY-MM-DD'
  orders: [{
    id: string;
    lat: number; lng: number;
    time_window_start?: string;        // 'HH:MM'
    time_window_end?: string;
    service_time_minutes: number;
    weight_kg: number; volume_m3: number;
    priority: 'urgent' | 'alert' | 'ok';
  }];
  drivers: [{
    id: string; name: string;
    start_lat: number; start_lng: number;
    end_lat: number; end_lng: number;
    shift_start: string; shift_end: string;
    max_weight_kg: number; max_volume_m3: number;
    max_stops: number; cost_per_km: number;
  }];
  constraints: {
    max_solve_time_seconds: number;    // default 60
    allow_drops: boolean;
    drop_penalty: number;              // default 10000
    balance_routes: boolean;
  };
}
```

### 4.3 Response

```typescript
{
  status: 'optimal' | 'feasible' | 'infeasible' | 'timeout';
  solve_time_seconds: number;
  objective_value: number;
  routes: [{
    driver_id: string;
    stops: [{ order_id, sequence, arrival_time, departure_time, distance_from_prev_km }];
    total_distance_km: number;
    total_time_minutes: number;
  }];
  unassigned_orders: [{ order_id, reason: 'capacity' | 'time_window' | 'no_feasible_driver' }];
  warnings: string[];
}
```

### 4.4 Timeout Strategy

- HTTP timeout: 120s (AbortController)
- CP-SAT internal limit: `max_solve_time_seconds` (default 60s)
- On timeout: return best feasible found so far
- On infeasible: ASSIGNMENT agent calls `escalate_no_capacity`
- Health check: `GET /api/v1/health` before sending payload

---

## 5. Dashboard ↔ Agents Communication

### 5.1 Dashboard Reads (Supabase Realtime)

| Table | Event | Dashboard Use |
|-------|-------|---------------|
| `orders` | UPDATE | Pipeline view status changes |
| `agent_events` | INSERT (escalation, error) | Live activity feed, alert badges |
| `conversations` | UPDATE | Unread count, active conversations |
| `conversation_messages` | INSERT | Chat view |
| `exceptions` | INSERT | Exception panel |

### 5.2 Dashboard Writes (Human → Agent)

Dashboard cannot access Redis directly. Pattern:

```
Dashboard POST /api/agents/action
  → Auth check (JWT + role)
  → INSERT into agent_commands table
  → Supabase Realtime notifies VPS
  → Command listener enqueues BullMQ job (priority 10)
```

Command types: `reassign_driver`, `cancel_order`, `force_escalation`, `retry_intake`, `manual_assign`, `override_status`, `send_manual_wa`, `pause_agent`, `resume_agent`.

---

## 6. Ingestion Flows

### Path A: Email (IMAP)

```
Gmail IMAP  ←  BullMQ repeatable (every 15 min)
  → Fetch unread from known senders
  → Download attachment → Supabase Storage
  → INTAKE agent: parse_excel() or parse_with_vision()
  → create_order() per row
  → confirm_to_sender()
  → Mark email as read
```

### Path B: WhatsApp Photo

```
WhatsApp photo msg  →  whatsapp-webhook Edge Function
  → Download media via WA Media API
  → Store in Supabase Storage
  → INTAKE agent: parse_with_vision() → GLM-OCR
  → create_order() per row
  → confirm_to_sender() via WhatsApp reply
```

### Path C: Dashboard Upload

```
Dashboard file upload  →  POST /api/orders/bulk-import
  → Upload to Supabase Storage
  → INSERT agent_commands { type: 'retry_intake' }
  → Command listener → intake.ingest queue
  → INTAKE agent processes
```

---

## 7. Model Selection

| Agent | Default Model | Rationale | Fallback |
|-------|--------------|-----------|----------|
| INTAKE | Groq (Llama 3.3 70B) | High volume, cost sensitive | Claude Sonnet |
| ASSIGNMENT | Claude Sonnet | Complex constraint reasoning, low volume | Escalate to human |
| COORD | Groq (Llama 3.3 70B) | Real-time, high volume | Claude Sonnet (ambiguous msgs) |
| WISMO | Groq (Llama 3.3 70B) | Real-time, template responses | Claude Sonnet (complaints) |
| SETTLE | Claude Sonnet | Financial accuracy, low volume | Escalate to human |
| EXCEPTION | Claude Sonnet | Complex reasoning for resolution | Rules-based fallback |

---

## 8. Environment Variables (VPS)

```bash
# Redis
REDIS_URL=redis://127.0.0.1:6379

# WhatsApp Business API
WA_PHONE_NUMBER_ID=xxxxx
WA_ACCESS_TOKEN=xxxxx
WA_VERIFY_TOKEN=xxxxx
WA_APP_SECRET=xxxxx

# LLM Providers
GROQ_API_KEY=xxxxx
ANTHROPIC_API_KEY=xxxxx

# GLM-OCR
GLM_OCR_ENDPOINT=https://api.glm-ocr.com/v1/extract
GLM_OCR_API_KEY=xxxxx

# OR-Tools sidecar
ORTOOLS_URL=http://127.0.0.1:8090

# Existing (unchanged)
SUPABASE_URL=xxxxx
SUPABASE_SERVICE_ROLE_KEY=xxxxx
SENTRY_DSN=xxxxx
ENCRYPTION_KEY=xxxxx
```
