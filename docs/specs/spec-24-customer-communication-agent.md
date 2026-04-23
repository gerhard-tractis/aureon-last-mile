# Spec-24: Customer Communication Agent (WISMO Expanded)

> **Supersedes:** [spec-10h-wismo-agent.md](spec-10h-wismo-agent.md) — do not implement spec-10h.
> Architecture: `docs/architecture/agents.md`
> Data model: `docs/architecture/agents-data-model.sql`
> ETA source: `packages/database/supabase/functions/beetrack-webhook/`

**Status:** completed

_Date: 2026-03-30_

---

## Goal

A single customer-facing agent that owns the entire customer communication lifecycle via WhatsApp: proactive delivery notifications, ETA updates, reschedule capture, and reactive status queries. Drives NPS (customers have timely info), FADR (customers can reschedule before driver departs), and OTIF (fewer failed deliveries from absent customers).

## Prerequisites

- spec-10a (scaffold infrastructure — BullMQ queues, apps/agents project)
- spec-10b (database migration — agent_events, operator_config)
- spec-10c (orchestration — WhatsApp webhook routing)
- spec-10d or spec-10k (Intake agent — must enqueue `proactive_early_arrival` on order confirm)
- spec-10g (COORD agent — must enqueue `proactive_pickup`, `proactive_delivered`, `proactive_failed` on assignment status changes)
- Beetrack webhook (`dispatches.estimated_at` being populated; webhook must enqueue `proactive_eta` on route `in_progress`)

---

## Schema Changes

### 1. New fields on `orders`

```sql
ALTER TABLE orders
  ADD COLUMN rescheduled_delivery_date  DATE        DEFAULT NULL,
  ADD COLUMN rescheduled_window_start   TIME        DEFAULT NULL,
  ADD COLUMN rescheduled_window_end     TIME        DEFAULT NULL;
```

**Semantics:**
- All three are nullable. NULL = no customer-requested reschedule yet.
- Denormalized convenience columns — always reflect the **latest** reschedule from `order_reschedules`. No FK to that table intentionally; the log is the source of truth, these are for fast operator reads without joins.
- Each field updates independently: a reschedule that only narrows the time window leaves `rescheduled_delivery_date` untouched, and vice versa.
- Operators see these alongside the original `delivery_date` / `delivery_window_*` from the retailer.

### 2. New table: `order_reschedules`

Append-only audit log of every customer reschedule request.

```sql
CREATE TABLE order_reschedules (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id               UUID NOT NULL REFERENCES operators(id),
  order_id                  UUID NOT NULL REFERENCES orders(id),

  -- What the customer requested (all nullable — only changed fields are set)
  requested_date            DATE,
  requested_window_start    TIME,
  requested_window_end      TIME,
  requested_address         TEXT,         -- captured but not acted on (escalated)

  -- Why
  reason                    VARCHAR(50) NOT NULL,  -- see reason values below
  customer_note             TEXT,                  -- raw WhatsApp message text

  -- Traceability
  session_message_id        UUID REFERENCES customer_session_messages(id) ON DELETE SET NULL,
  triggered_by              VARCHAR(50) NOT NULL DEFAULT 'wismo_agent',

  -- Operator lifecycle
  status                    VARCHAR(20) NOT NULL DEFAULT 'pending',
  operator_notes            TEXT,
  acknowledged_at           TIMESTAMPTZ,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                TIMESTAMPTZ,

  CONSTRAINT chk_reschedule_status CHECK (status IN ('pending', 'acknowledged', 'applied', 'rejected')),
  CONSTRAINT chk_reschedule_reason CHECK (reason IN ('not_home', 'time_preference', 'address_change', 'early_delivery', 'other')),
  CONSTRAINT chk_reschedule_has_change CHECK (
    requested_date IS NOT NULL OR
    requested_window_start IS NOT NULL OR
    requested_address IS NOT NULL
  )
);

CREATE INDEX idx_reschedules_operator ON order_reschedules(operator_id);
CREATE INDEX idx_reschedules_order    ON order_reschedules(order_id);
CREATE INDEX idx_reschedules_pending  ON order_reschedules(operator_id)
  WHERE deleted_at IS NULL AND status = 'pending';
```

**Reason values:** `not_home`, `time_preference`, `address_change`, `early_delivery`, `other`
**Status transitions:** `pending` → `acknowledged` → `applied` | `rejected`

**Update logic on `orders`:** When a new reschedule row is inserted:
- If `requested_date IS NOT NULL` → `orders.rescheduled_delivery_date = requested_date`
- If `requested_window_start IS NOT NULL` → `orders.rescheduled_window_start/end = requested_window_*`
- Fields absent from this reschedule are **left untouched** on the order

### 3. New table: `customer_sessions`

One session per order. The agent's conversational memory lives here.

> **Why not reuse `conversations`?** The existing `conversations` table (from spec-10g) is driver-centric: it has `driver_id`, `participant_type` (driver/client/generator), multi-order context arrays, and `assigned_agent` fields designed for the COORD agent's negotiation lifecycle. Customer sessions are order-centric (one session per order), have a 1-to-1 relationship with a single order (not a UUID array), use a simpler role model (`user`/`system`), and carry no driver-specific fields. The conversations table also lacks a direct order FK — it uses `context_order_ids UUID[]` which cannot support a unique-per-order constraint or direct joins.
>
> **Decision:** `conversations` + `conversation_messages` are for **driver coordination** (COORD agent only). `customer_sessions` + `customer_session_messages` are for **customer communication** (this agent only). `conversations.participant_type = 'client'` will not be used. Implementers must not write customer messages to `conversations`.
>
> **`wismo_notifications` table:** continues to exist and is used for **delivery status tracking** of outbound notifications (wa_status per notification, scheduled_at, triggered_by_event_id). `customer_session_messages` is the **conversational record** used as agent memory. Both are written for proactive outbound messages: `wismo_notifications` records delivery metadata; `customer_session_messages` records the message content for context. For inbound customer replies, only `customer_session_messages` is written.
>
> **`wismo_notifications.conversation_id`:** this FK references `conversations(id)` and will be `NULL` for all customer messages going forward (since `conversations` is now driver-only). No migration needed — the column is already nullable. Implementers must leave it `NULL` when inserting `wismo_notifications` for this agent.

```sql
CREATE TABLE customer_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID NOT NULL REFERENCES operators(id),
  order_id          UUID NOT NULL REFERENCES orders(id),

  customer_phone    VARCHAR(20) NOT NULL,
  customer_name     VARCHAR(255),

  status            VARCHAR(20) NOT NULL DEFAULT 'active',
  escalated_at      TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,

  CONSTRAINT uq_active_session_per_order
    UNIQUE (operator_id, order_id)
    WHERE deleted_at IS NULL,
  CONSTRAINT chk_session_status
    CHECK (status IN ('active', 'closed', 'escalated')),
  CONSTRAINT chk_session_escalated_at
    CHECK (status != 'escalated' OR escalated_at IS NOT NULL),
  CONSTRAINT chk_session_closed_at
    CHECK (status != 'closed' OR closed_at IS NOT NULL)
);

CREATE INDEX idx_customer_sessions_operator ON customer_sessions(operator_id);
CREATE INDEX idx_customer_sessions_order    ON customer_sessions(order_id);
CREATE INDEX idx_customer_sessions_phone    ON customer_sessions(operator_id, customer_phone)
  WHERE deleted_at IS NULL;
```

### 4. New table: `customer_session_messages`

Individual messages within a session. Agent loads the full history as context on every interaction.

```sql
CREATE TABLE customer_session_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES operators(id),
  session_id          UUID NOT NULL REFERENCES customer_sessions(id),

  role                VARCHAR(10) NOT NULL,   -- 'user' (customer) | 'system' (agent)
  body                TEXT NOT NULL,

  -- WhatsApp delivery tracking
  external_message_id VARCHAR(255),           -- WhatsApp wamid
  wa_status           VARCHAR(20),            -- sent | delivered | read | failed
  wa_status_at        TIMESTAMPTZ,

  -- Media (customer may send photo, voice note, etc.)
  media_url           TEXT,
  media_type          VARCHAR(50),            -- image | audio | document | location

  -- Agent metadata (system messages only)
  template_name       VARCHAR(100),           -- WhatsApp template used, if any
  action_taken        VARCHAR(100),
  -- reschedule_captured | status_sent | eta_sent | pickup_notified
  -- early_arrival_offered | delivered_notified | failed_notified | escalated

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT chk_session_message_role CHECK (role IN ('user', 'system'))
);

CREATE INDEX idx_session_messages_session  ON customer_session_messages(session_id);
CREATE INDEX idx_session_messages_operator ON customer_session_messages(operator_id);
```

### 5. Enum extension: `wismo_type_enum`

The existing `wismo_type_enum` has: `proactive_eta`, `proactive_dispatched`, `proactive_delivered`, `proactive_failed`, `proactive_rescheduled`, `reactive_status`, `reactive_reschedule`, `reactive_cancel`, `reactive_other`.

**Changes:**
- `proactive_dispatched` is **retired** — replaced by `proactive_pickup_confirmed` (trigger #2) and `proactive_eta` (trigger #3, now includes ETA window). `proactive_dispatched` should no longer be enqueued; existing enum value kept for historical data.
- Two new values added:

```sql
ALTER TYPE wismo_type_enum ADD VALUE IF NOT EXISTS 'proactive_early_arrival';
ALTER TYPE wismo_type_enum ADD VALUE IF NOT EXISTS 'proactive_pickup_confirmed';
```

**Mapping: queue job type → wismo_type_enum value**

| Queue job type | wismo_type_enum value |
|---|---|
| `proactive_early_arrival` | `proactive_early_arrival` |
| `proactive_pickup` | `proactive_pickup_confirmed` |
| `proactive_eta` | `proactive_eta` |
| `proactive_delivered` | `proactive_delivered` |
| `proactive_failed` | `proactive_failed` |

---

## Proactive Triggers

| # | Event | Condition | Message |
|---|-------|-----------|---------|
| 1 | Order confirmed (intake) | `delivery_date > today` | Early arrival offer: pedido listo, ¿puedes recibirlo antes? |
| 2 | Assignment → `picked_up` | — | Pickup confirmed: tu pedido fue recogido |
| 3 | Route → `in_progress` | `dispatches.estimated_at` available | ETA: pedido en camino, estimamos entre [X] y [Y] |
| 4 | Assignment → `delivered` | — | Delivered: tu pedido fue entregado |
| 5 | Assignment → `failed` | — | Failed: no pudimos entregar, te contactaremos |

**ETA calculation (trigger #3):**
```
dispatches.estimated_at = 14:37
→ round to nearest 30min → 14:30
→ window = [14:30 - 60min, 14:30 + 60min] → "entre las 13:30 y 15:30"
```

**Early arrival offer (trigger #1):** Offer the next 2 business days + the original delivery date as options. No capacity check in V1 — assume capacity available. The `reschedule_date = reason: early_delivery` if customer accepts.

**Session lifecycle:**
```
Trigger #1 OR #2 (whichever fires first)
  → create customer_session (if not exists)
  → send proactive message → log as system message

Customer replies (any time)
  → load session history
  → agent processes intent
  → reply + log both messages

Assignment → delivered | failed
  → send notification → close session
```

---

## Reactive Flow

```
Customer WhatsApp message
  → wismo.client { type: 'client_message', session_id, order_id, body }
  → WISMO agent:
      1. create_or_get_session()
      2. get_session_history()          ← agent memory
      3. get_order_status()             ← current DB state
      4. classify intent (NLU):
         ├── status_inquiry     → respond with status + ETA from DB
         ├── reschedule_date    → capture_reschedule(date)
         ├── reschedule_time    → capture_reschedule(window)
         ├── reschedule_both    → capture_reschedule(date + window)
         ├── early_delivery_accept → capture_reschedule(date, reason: early_delivery)
         ├── address_change     → capture_reschedule(address) + escalate_to_human
         ├── cancel             → escalate_to_human (requires operator)
         ├── complaint          → escalate_to_human + create_exception
         ├── gratitude          → friendly close
         └── other              → best-effort or escalate if below confidence threshold
```

---

## Agent Deliverables

### `src/agents/wismo/`

| File | Responsibility | Max Lines |
|------|---------------|-----------|
| `wismo-agent.ts` | Agent definition, tool registry, proactive/reactive entrypoints | 150 |
| `wismo-tools.ts` | Zod schemas + execute functions for all tools | 200 |
| `wismo-fallback.ts` | LLM down → template response with last known DB status | 100 |
| `wismo-agent.test.ts` | Unit tests for agent logic | 200 |
| `wismo-tools.test.ts` | Unit tests for each tool | 200 |
| `wismo-fallback.test.ts` | Unit tests for fallback paths | 100 |

**Agent config:**
- Model: `openrouter/meta-llama/llama-3.3-70b-instruct` — fast NLU inference, <30s SLA
- Fallback: LLM unavailable → `wismo-fallback.ts` sends template with last known DB status
- maxSteps: 5
- System prompt: Chilean Spanish, empathetic logistics context, `operator_id` injected per call

### Tools

| Tool | Description |
|------|-------------|
| `create_or_get_session` | Find or create `customer_sessions` row for the order |
| `get_session_history` | Load all `customer_session_messages` for session (agent context) |
| `get_order_status` | Query order + assignment + dispatch for current state + ETA |
| `send_customer_message` | Send WhatsApp + log as system message in session |
| `capture_reschedule` | Insert `order_reschedules` + update denormalized fields on `orders` |
| `escalate_to_human` | Set `customer_sessions.status = 'escalated'`, alert operator dashboard |

**ETA utility (not an agent tool):** `roundEtaToWindow(estimated_at: string): string` — private function inside `wismo-tools.ts`. Takes `dispatches.estimated_at`, rounds to nearest 30min, returns a formatted window string (`"entre las 13:30 y 15:30"`). Called internally by `send_customer_message` for proactive ETA messages. Not exposed as an LLM-callable tool since it is a deterministic computation.

### Shared tools (new)

- `src/tools/supabase/customer-sessions.ts` — CRUD for sessions and messages
- `src/tools/supabase/reschedules.ts` — insert reschedule + update orders fields

### Reused tools (existing)

- `src/tools/whatsapp/send-message.ts`
- `src/tools/supabase/orders.ts`
- `src/tools/supabase/events.ts` (audit trail)

---

## Queue Integration

**`wismo.client` queue — full job type list:**

| Job type | Status | Fired by | Payload |
|----------|--------|----------|---------|
| `proactive_early_arrival` | **NEW** (new enum value + new queue job) | Intake agent on order confirm | `{ order_id, operator_id }` |
| `proactive_pickup` | **NEW** (maps to new enum value `proactive_pickup_confirmed`) | COORD agent on assignment `picked_up` | `{ order_id, operator_id, assignment_id }` |
| `proactive_eta` | existing (now also enqueued by Beetrack webhook) | Beetrack webhook on route `in_progress` | `{ order_id, operator_id, estimated_at }` |
| `proactive_delivered` | existing enum value, **NEW queue job** (now enqueued by COORD) | COORD agent on assignment `delivered` | `{ order_id, operator_id }` |
| `proactive_failed` | existing enum value, **NEW queue job** (now enqueued by COORD) | COORD agent on assignment `failed` | `{ order_id, operator_id, failure_reason }` |
| `client_message` | existing | WhatsApp webhook | `{ order_id, operator_id, session_id, body, external_message_id }` |

Add `proactive_early_arrival`, `proactive_pickup`, `proactive_delivered`, `proactive_failed` to `orchestration/queues.ts` job type definitions.

---

## Out of Scope (future specs)

- **Active rescheduling:** auto-cancel assignment + re-route on reschedule (V2)
- **Capacity-aware date suggestions:** check capacity center before offering dates (V2)
- **Package-level pickup triggers:** fire per-package scan rather than per-assignment (V2)
- **Address change auto-processing:** geocoding, zone reassignment, new driver (V2)
- **SMS fallback channel**

---

## Exit Criteria

**Schema**
- [ ] Migration: `orders` 3 new nullable columns applied
- [ ] Migration: `order_reschedules` table created with all constraints and indexes
- [ ] Migration: `customer_sessions` table created with unique constraint and indexes
- [ ] Migration: `customer_session_messages` table created with indexes
- [ ] Migration: `wismo_type_enum` extended with `proactive_early_arrival`, `proactive_pickup_confirmed`

**Proactive triggers**
- [ ] Order confirmed + `delivery_date > today` → WhatsApp early arrival offer sent, session created, message logged to `customer_session_messages` + `wismo_notifications`
- [ ] Assignment → `picked_up` → WhatsApp pickup confirmed message sent and logged
- [ ] Route → `in_progress` + `dispatches.estimated_at` present → WhatsApp ETA message with ±1hr rounded window sent and logged
- [ ] Assignment → `delivered` → WhatsApp delivery confirmation sent and logged, session closed
- [ ] Assignment → `failed` → WhatsApp failure notification sent and logged, session closed

**Reactive handling**
- [ ] "¿dónde está mi pedido?" → accurate status + ETA response within 30s
- [ ] Reschedule request (date / time / both) → `order_reschedules` row inserted, `orders` denormalized fields updated independently, confirmation sent to customer
- [ ] Early arrival acceptance → reschedule captured with `reason: early_delivery`
- [ ] Address change → captured in `order_reschedules.requested_address` + `escalate_to_human` triggered
- [ ] Cancellation request → escalated to operator, not auto-processed
- [ ] Complaint → escalated + exception record created

**Agent behaviour**
- [ ] Session history loaded as full context on every interaction (agent never loses conversation history)
- [ ] Date-only reschedule leaves `rescheduled_window_*` untouched; time-only reschedule leaves `rescheduled_delivery_date` untouched
- [ ] Fallback: LLM unavailable → template response with last known DB status, no crash
- [ ] `operator_id` present on every Supabase query
- [ ] Every agent action logged to `agent_events` (append-only audit trail)
- [ ] All files ≤300 lines with collocated `*.test.ts` files

---

## Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full customer communication agent — DB schema, Supabase tools, WhatsApp tool, OpenRouter provider, WISMO agent core, and queue wiring.

**Architecture:** A pure async `processWismoJob` function (matching the existing `intake-agent.ts` pattern) handles both proactive triggers and reactive customer WhatsApp messages. Six LLM-callable tools close over a shared Supabase client passed as a parameter. A `createWismoHandler` factory produces the BullMQ job handler that calls `processWismoJob`.

**Tech Stack:** TypeScript, BullMQ 5, Vercel AI SDK 4, `@ai-sdk/openai` (OpenRouter base URL), Supabase JS 2, Zod 3, Vitest 4. All code lives in `apps/agents/src/`.

**Run tests from:** `apps/agents/` → `npm test`

---

### Chunk 1: Database Migration

---

#### Task 1: Write the customer communication schema migration

**Files:**
- Create: `packages/database/supabase/migrations/20260330000001_add_customer_communication_schema.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration: add_customer_communication_schema
-- Adds tables and columns for spec-24 customer communication agent.

-- ── 1. New nullable columns on orders ────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS rescheduled_delivery_date DATE        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_window_start  TIME        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rescheduled_window_end    TIME        DEFAULT NULL;

COMMENT ON COLUMN public.orders.rescheduled_delivery_date IS
  'Latest customer-requested delivery date. NULL = no reschedule. Updated by wismo agent.';
COMMENT ON COLUMN public.orders.rescheduled_window_start IS
  'Latest customer-requested delivery window start. Updates independently of date.';
COMMENT ON COLUMN public.orders.rescheduled_window_end IS
  'Latest customer-requested delivery window end.';

-- ── 2. customer_sessions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_sessions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      UUID        NOT NULL REFERENCES public.operators(id),
  order_id         UUID        NOT NULL REFERENCES public.orders(id),

  customer_phone   VARCHAR(20) NOT NULL,
  customer_name    VARCHAR(255),

  status           VARCHAR(20) NOT NULL DEFAULT 'active',

  escalated_at     TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,

  CONSTRAINT chk_session_status
    CHECK (status IN ('active', 'closed', 'escalated')),
  CONSTRAINT chk_session_escalated_at
    CHECK (status != 'escalated' OR escalated_at IS NOT NULL),
  CONSTRAINT chk_session_closed_at
    CHECK (status != 'closed' OR closed_at IS NOT NULL)
);

-- Partial unique index: only one active session per order (soft-deleted rows are excluded)
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_session_per_order
  ON public.customer_sessions(operator_id, order_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_sessions_operator
  ON public.customer_sessions(operator_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_order
  ON public.customer_sessions(order_id);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_phone
  ON public.customer_sessions(operator_id, customer_phone)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE TRIGGER set_customer_sessions_updated_at
  BEFORE UPDATE ON public.customer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customer_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_sessions_service_role ON public.customer_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 3. customer_session_messages ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_session_messages (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id          UUID        NOT NULL REFERENCES public.operators(id),
  session_id           UUID        NOT NULL REFERENCES public.customer_sessions(id),

  role                 VARCHAR(10) NOT NULL,
  body                 TEXT        NOT NULL,

  external_message_id  VARCHAR(255),
  wa_status            VARCHAR(20),
  wa_status_at         TIMESTAMPTZ,

  media_url            TEXT,
  media_type           VARCHAR(50),

  template_name        VARCHAR(100),
  action_taken         VARCHAR(100),

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at           TIMESTAMPTZ,

  CONSTRAINT chk_session_message_role
    CHECK (role IN ('user', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_session_messages_session
  ON public.customer_session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_session_messages_operator
  ON public.customer_session_messages(operator_id);

ALTER TABLE public.customer_session_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_session_messages_service_role ON public.customer_session_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4. order_reschedules ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_reschedules (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id           UUID        NOT NULL REFERENCES public.operators(id),
  order_id              UUID        NOT NULL REFERENCES public.orders(id),

  requested_date        DATE,
  requested_window_start TIME,
  requested_window_end   TIME,
  requested_address     TEXT,

  reason                VARCHAR(50) NOT NULL,
  customer_note         TEXT,

  session_message_id    UUID REFERENCES public.customer_session_messages(id)
                          ON DELETE SET NULL,
  triggered_by          VARCHAR(50) NOT NULL DEFAULT 'wismo_agent',

  status                VARCHAR(20) NOT NULL DEFAULT 'pending',
  operator_notes        TEXT,
  acknowledged_at       TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,

  CONSTRAINT chk_reschedule_status
    CHECK (status IN ('pending', 'acknowledged', 'applied', 'rejected')),
  CONSTRAINT chk_reschedule_reason
    CHECK (reason IN ('not_home', 'time_preference', 'address_change', 'early_delivery', 'other')),
  CONSTRAINT chk_reschedule_has_change
    CHECK (
      requested_date IS NOT NULL OR
      requested_window_start IS NOT NULL OR
      requested_address IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_reschedules_operator
  ON public.order_reschedules(operator_id);
CREATE INDEX IF NOT EXISTS idx_reschedules_order
  ON public.order_reschedules(order_id);
CREATE INDEX IF NOT EXISTS idx_reschedules_pending
  ON public.order_reschedules(operator_id)
  WHERE deleted_at IS NULL AND status = 'pending';

CREATE OR REPLACE TRIGGER set_order_reschedules_updated_at
  BEFORE UPDATE ON public.order_reschedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.order_reschedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_reschedules_service_role ON public.order_reschedules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 5. wismo_type_enum extension ─────────────────────────────────────────
-- proactive_dispatched is retired (kept for historical data, no longer enqueued)
ALTER TYPE public.wismo_type_enum ADD VALUE IF NOT EXISTS 'proactive_early_arrival';
ALTER TYPE public.wismo_type_enum ADD VALUE IF NOT EXISTS 'proactive_pickup_confirmed';
```

- [ ] **Step 2: Apply migration to local Supabase**

```bash
cd apps/frontend
npx supabase migration up
```

Expected: migration applied without errors.

- [ ] **Step 3: Verify schema in local DB**

```bash
npx supabase db diff --schema public | grep -E 'customer_sessions|customer_session_messages|order_reschedules|rescheduled_'
```

Expected: no diff (migration fully applied).

- [ ] **Step 4: Commit**

```bash
git add packages/database/supabase/migrations/20260330000001_add_customer_communication_schema.sql
git commit -m "feat(db): add customer_sessions, order_reschedules, rescheduled_* columns"
```

---

### Chunk 2: Supabase Tools

---

#### Task 2: customer-sessions Supabase tool

**Files:**
- Create: `apps/agents/src/tools/supabase/customer-sessions.ts`
- Create: `apps/agents/src/tools/supabase/customer-sessions.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/agents/src/tools/supabase/customer-sessions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  upsertCustomerSession,
  closeCustomerSession,
  escalateCustomerSession,
  insertSessionMessage,
  getSessionMessages,
  updateMessageWaStatus,
} from './customer-sessions';

function makeDb(opts: {
  sessionData?: Record<string, unknown> | null;
  messagesData?: Record<string, unknown>[];
  insertedSession?: Record<string, unknown>;
  insertedMessage?: Record<string, unknown>;
} = {}) {
  const mockSelect = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.sessionData ?? null, error: null }),
    data: opts.messagesData ?? [],
    error: null,
  });
  const mockInsert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: opts.insertedSession ?? { id: 'sess-1' }, error: null }),
    }),
  });
  const mockUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({ data: opts.insertedSession ?? { id: 'sess-1' }, error: null }),
    }),
    error: null,
  });
  return {
    from: vi.fn().mockReturnValue({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: opts.insertedSession ?? { id: 'sess-1' }, error: null }),
        }),
      }),
    }),
  };
}

describe('upsertCustomerSession', () => {
  it('returns existing session when one exists', async () => {
    const existing = { id: 'sess-existing', order_id: 'ord-1', status: 'active' };
    const db = makeDb({ sessionData: existing });
    const result = await upsertCustomerSession(db as never, {
      operator_id: 'op-1',
      order_id: 'ord-1',
      customer_phone: '+56912345678',
      customer_name: 'Juan',
    });
    expect(result.id).toBe('sess-existing');
  });

  it('creates new session when none exists', async () => {
    const db = makeDb({ sessionData: null, insertedSession: { id: 'sess-new', status: 'active' } });
    const result = await upsertCustomerSession(db as never, {
      operator_id: 'op-1',
      order_id: 'ord-1',
      customer_phone: '+56912345678',
    });
    expect(result.id).toBe('sess-new');
    expect(db.from).toHaveBeenCalledWith('customer_sessions');
  });
});

describe('closeCustomerSession', () => {
  it('updates status to closed with closed_at timestamp', async () => {
    const db = makeDb({ insertedSession: { id: 'sess-1', status: 'closed' } });
    await closeCustomerSession(db as never, 'sess-1', 'op-1');
    expect(db.from).toHaveBeenCalledWith('customer_sessions');
  });
});

describe('insertSessionMessage', () => {
  it('inserts message with operator_id and session_id', async () => {
    const db = makeDb({ insertedMessage: { id: 'msg-1' } } as never);
    await insertSessionMessage(db as never, {
      operator_id: 'op-1',
      session_id: 'sess-1',
      role: 'system',
      body: 'Tu pedido fue recogido.',
      action_taken: 'pickup_notified',
    });
    expect(db.from).toHaveBeenCalledWith('customer_session_messages');
  });
});

describe('getSessionMessages', () => {
  it('queries messages for the given session ordered by created_at', async () => {
    const db = makeDb({ messagesData: [{ id: 'msg-1', role: 'system', body: 'Hola' }] });
    await getSessionMessages(db as never, 'sess-1', 'op-1');
    expect(db.from).toHaveBeenCalledWith('customer_session_messages');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/agents && npm test -- --reporter=verbose src/tools/supabase/customer-sessions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement customer-sessions.ts**

```typescript
// apps/agents/src/tools/supabase/customer-sessions.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CustomerSessionRow {
  id: string;
  operator_id: string;
  order_id: string;
  customer_phone: string;
  customer_name?: string | null;
  status: 'active' | 'closed' | 'escalated';
  escalated_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionMessageRow {
  id: string;
  operator_id: string;
  session_id: string;
  role: 'user' | 'system';
  body: string;
  external_message_id?: string | null;
  wa_status?: string | null;
  wa_status_at?: string | null;
  template_name?: string | null;
  action_taken?: string | null;
  created_at: string;
}

export interface UpsertSessionInput {
  operator_id: string;
  order_id: string;
  customer_phone: string;
  customer_name?: string;
}

export async function upsertCustomerSession(
  db: SupabaseClient,
  input: UpsertSessionInput,
): Promise<CustomerSessionRow> {
  // Return existing active session if one exists
  const { data: existing } = await db
    .from('customer_sessions')
    .select('*')
    .eq('operator_id', input.operator_id)
    .eq('order_id', input.order_id)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) return existing as CustomerSessionRow;

  const { data, error } = await db
    .from('customer_sessions')
    .insert({
      operator_id: input.operator_id,
      order_id: input.order_id,
      customer_phone: input.customer_phone,
      customer_name: input.customer_name ?? null,
      status: 'active',
    })
    .select()
    .single();

  if (error) throw new Error(`upsertCustomerSession: ${error.message}`);
  return data as CustomerSessionRow;
}

export async function closeCustomerSession(
  db: SupabaseClient,
  sessionId: string,
  operatorId: string,
): Promise<void> {
  const { error } = await db
    .from('customer_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('operator_id', operatorId);
  if (error) throw new Error(`closeCustomerSession: ${error.message}`);
}

export async function escalateCustomerSession(
  db: SupabaseClient,
  sessionId: string,
  operatorId: string,
): Promise<void> {
  const { error } = await db
    .from('customer_sessions')
    .update({ status: 'escalated', escalated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('operator_id', operatorId);
  if (error) throw new Error(`escalateCustomerSession: ${error.message}`);
}

export interface InsertMessageInput {
  operator_id: string;
  session_id: string;
  role: 'user' | 'system';
  body: string;
  external_message_id?: string;
  wa_status?: string;
  template_name?: string;
  action_taken?: string;
  media_url?: string;
  media_type?: string;
}

export async function insertSessionMessage(
  db: SupabaseClient,
  input: InsertMessageInput,
): Promise<SessionMessageRow> {
  const { data, error } = await db
    .from('customer_session_messages')
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(`insertSessionMessage: ${error.message}`);
  return data as SessionMessageRow;
}

export async function getSessionMessages(
  db: SupabaseClient,
  sessionId: string,
  operatorId: string,
): Promise<SessionMessageRow[]> {
  const { data, error } = await db
    .from('customer_session_messages')
    .select('*')
    .eq('session_id', sessionId)
    .eq('operator_id', operatorId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getSessionMessages: ${error.message}`);
  return (data ?? []) as SessionMessageRow[];
}

export async function updateMessageWaStatus(
  db: SupabaseClient,
  messageId: string,
  operatorId: string,
  waStatus: string,
): Promise<void> {
  const { error } = await db
    .from('customer_session_messages')
    .update({ wa_status: waStatus, wa_status_at: new Date().toISOString() })
    .eq('id', messageId)
    .eq('operator_id', operatorId);
  if (error) throw new Error(`updateMessageWaStatus: ${error.message}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/agents && npm test -- src/tools/supabase/customer-sessions.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/tools/supabase/customer-sessions.ts \
        apps/agents/src/tools/supabase/customer-sessions.test.ts
git commit -m "feat(agents): add customer-sessions Supabase tool"
```

---

#### Task 3: reschedules Supabase tool

**Files:**
- Create: `apps/agents/src/tools/supabase/reschedules.ts`
- Create: `apps/agents/src/tools/supabase/reschedules.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/agents/src/tools/supabase/reschedules.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { insertReschedule } from './reschedules';

function makeDb(opts: { insertOk?: boolean } = {}) {
  const shouldFail = opts.insertOk === false;

  // Track insert calls on order_reschedules
  const insertChain = {
    select: vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue(
        shouldFail
          ? { data: null, error: { message: 'db error' } }
          : { data: { id: 'resc-1' }, error: null },
      ),
    }),
  };
  const insertFn = vi.fn().mockReturnValue(insertChain);

  // Track update calls on orders
  const updateChain = {
    eq: vi.fn().mockReturnThis(),
    error: null as null,
  };
  // mockReturnThis() returns the chain; we need to resolve the final .eq call
  // Supabase's update().eq().eq() returns a promise-like — simulate with resolved value
  updateChain.eq.mockResolvedValue({ error: null });
  const updateFn = vi.fn().mockReturnValue(updateChain);

  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') return { update: updateFn };
      return { insert: insertFn };
    }),
    _insertFn: insertFn,
    _updateFn: updateFn,
  };
}

describe('insertReschedule', () => {
  it('inserts reschedule row and updates orders.rescheduled_delivery_date when date provided', async () => {
    const db = makeDb();
    await insertReschedule(db as never, {
      operator_id: 'op-1',
      order_id: 'ord-1',
      session_message_id: 'msg-1',
      reason: 'not_home',
      customer_note: 'no estaré',
      requested_date: '2026-04-02',
    });
    expect(db.from).toHaveBeenCalledWith('order_reschedules');
    expect(db._insertFn).toHaveBeenCalledOnce();
    expect(db.from).toHaveBeenCalledWith('orders');
    const updatePayload = db._updateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload).toHaveProperty('rescheduled_delivery_date', '2026-04-02');
  });

  it('updates only rescheduled_window when only window provided', async () => {
    const db = makeDb();
    await insertReschedule(db as never, {
      operator_id: 'op-1',
      order_id: 'ord-1',
      session_message_id: 'msg-1',
      reason: 'time_preference',
      customer_note: 'necesito en la tarde',
      requested_window_start: '14:00',
      requested_window_end: '18:00',
    });
    expect(db.from).toHaveBeenCalledWith('orders');
    const updatePayload = db._updateFn.mock.calls[0][0] as Record<string, unknown>;
    expect(updatePayload).not.toHaveProperty('rescheduled_delivery_date');
    expect(updatePayload).toHaveProperty('rescheduled_window_start', '14:00');
    expect(updatePayload).toHaveProperty('rescheduled_window_end', '18:00');
  });

  it('throws when DB insert fails', async () => {
    const db = makeDb({ insertOk: false });
    await expect(
      insertReschedule(db as never, {
        operator_id: 'op-1',
        order_id: 'ord-1',
        session_message_id: 'msg-1',
        reason: 'other',
        customer_note: 'test',
        requested_date: '2026-04-02',
      }),
    ).rejects.toThrow('insertReschedule');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/agents && npm test -- src/tools/supabase/reschedules.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement reschedules.ts**

```typescript
// apps/agents/src/tools/supabase/reschedules.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type RescheduleReason =
  | 'not_home'
  | 'time_preference'
  | 'address_change'
  | 'early_delivery'
  | 'other';

export interface InsertRescheduleInput {
  operator_id: string;
  order_id: string;
  session_message_id: string | null;
  reason: RescheduleReason;
  customer_note: string;
  requested_date?: string | null;        // ISO date string 'YYYY-MM-DD'
  requested_window_start?: string | null; // 'HH:MM'
  requested_window_end?: string | null;   // 'HH:MM'
  requested_address?: string | null;
}

export async function insertReschedule(
  db: SupabaseClient,
  input: InsertRescheduleInput,
): Promise<void> {
  const { error } = await db
    .from('order_reschedules')
    .insert({
      operator_id: input.operator_id,
      order_id: input.order_id,
      session_message_id: input.session_message_id,
      reason: input.reason,
      customer_note: input.customer_note,
      requested_date: input.requested_date ?? null,
      requested_window_start: input.requested_window_start ?? null,
      requested_window_end: input.requested_window_end ?? null,
      requested_address: input.requested_address ?? null,
    });

  if (error) throw new Error(`insertReschedule: ${error.message}`);

  // Update denormalized fields on orders — only fields that are present in this reschedule
  const orderUpdate: Record<string, string> = {};
  if (input.requested_date) {
    orderUpdate['rescheduled_delivery_date'] = input.requested_date;
  }
  if (input.requested_window_start && input.requested_window_end) {
    orderUpdate['rescheduled_window_start'] = input.requested_window_start;
    orderUpdate['rescheduled_window_end'] = input.requested_window_end;
  }

  if (Object.keys(orderUpdate).length > 0) {
    const { error: updateError } = await db
      .from('orders')
      .update(orderUpdate)
      .eq('id', input.order_id)
      .eq('operator_id', input.operator_id);
    if (updateError) throw new Error(`insertReschedule (orders update): ${updateError.message}`);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/agents && npm test -- src/tools/supabase/reschedules.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/tools/supabase/reschedules.ts \
        apps/agents/src/tools/supabase/reschedules.test.ts
git commit -m "feat(agents): add reschedules Supabase tool"
```

---

### Chunk 3: WhatsApp Tool

---

#### Task 4: WhatsApp send-message tool

**Files:**
- Create: `apps/agents/src/tools/whatsapp/send-message.ts`
- Create: `apps/agents/src/tools/whatsapp/send-message.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/agents/src/tools/whatsapp/send-message.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendWhatsAppMessage } from './send-message';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeSuccessResponse(wamid = 'wamid.abc123') {
  return {
    ok: true,
    json: async () => ({ messages: [{ id: wamid }] }),
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('sendWhatsAppMessage', () => {
  const creds = { apiToken: 'tok-1', phoneNumberId: 'pnid-1' };

  it('sends a text message and returns the wamid', async () => {
    mockFetch.mockResolvedValueOnce(makeSuccessResponse('wamid.xyz'));

    const result = await sendWhatsAppMessage(
      creds,
      { to: '+56912345678', body: 'Hola, tu pedido fue recogido.' },
    );

    expect(result.wamid).toBe('wamid.xyz');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('pnid-1/messages');
    const body = JSON.parse(opts.body as string);
    expect(body.to).toBe('+56912345678');
    expect(body.type).toBe('text');
  });

  it('throws when the API returns an error status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Invalid phone' } }),
    });

    await expect(
      sendWhatsAppMessage(creds, { to: 'invalid', body: 'test' }),
    ).rejects.toThrow('WhatsApp API error 400');
  });

  it('throws when fetch itself fails (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network timeout'));
    await expect(
      sendWhatsAppMessage(creds, { to: '+56912345678', body: 'test' }),
    ).rejects.toThrow('network timeout');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/agents && npm test -- src/tools/whatsapp/send-message.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement send-message.ts**

```typescript
// apps/agents/src/tools/whatsapp/send-message.ts

const WA_API_BASE = 'https://graph.facebook.com/v17.0';

export interface WhatsAppCreds {
  apiToken: string;
  phoneNumberId: string;
}

export interface SendMessageInput {
  to: string;        // E.164 format: '+56912345678'
  body: string;      // Plain text message
  templateName?: string; // For template metadata only — plain text is always sent
}

export interface SendMessageResult {
  wamid: string;     // WhatsApp message ID for delivery tracking
}

export async function sendWhatsAppMessage(
  creds: WhatsAppCreds,
  input: SendMessageInput,
): Promise<SendMessageResult> {
  const url = `${WA_API_BASE}/${creds.phoneNumberId}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'text',
    text: { body: input.body, preview_url: false },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      `WhatsApp API error ${response.status}: ${(detail as Record<string, unknown>)?.error ?? 'unknown'}`,
    );
  }

  const data = (await response.json()) as { messages: Array<{ id: string }> };
  return { wamid: data.messages[0].id };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/agents && npm test -- src/tools/whatsapp/send-message.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Add WHATSAPP env vars to config.ts**

Open `apps/agents/src/config.ts`. Add these fields to the Zod schema (after the existing keys):

```typescript
WHATSAPP_API_TOKEN: z.string().min(1),
WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
```

> `OPENROUTER_API_KEY` already exists in config.ts — do not add it again.

- [ ] **Step 6: Run the config tests to verify they still pass**

```bash
cd apps/agents && npm test -- src/config.test.ts
```

Expected: PASS (add the new env vars to the test mock if needed).

- [ ] **Step 7: Commit**

```bash
git add apps/agents/src/tools/whatsapp/send-message.ts \
        apps/agents/src/tools/whatsapp/send-message.test.ts \
        apps/agents/src/config.ts \
        apps/agents/src/config.test.ts
git commit -m "feat(agents): add WhatsApp send-message tool + WHATSAPP/OPENROUTER env vars"
```

---

### Chunk 4: WISMO Tools + Fallback

---

#### Task 5: wismo-tools.ts — roundEtaToWindow utility + tool definitions

**Files:**
- Create: `apps/agents/src/agents/wismo/wismo-tools.ts`
- Create: `apps/agents/src/agents/wismo/wismo-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/agents/src/agents/wismo/wismo-tools.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  roundEtaToWindow,
  makeWismoTools,
} from './wismo-tools';
import type { AgentContext } from '../base-agent';

// ── roundEtaToWindow ───────────────────────────────────────────────────
describe('roundEtaToWindow', () => {
  it('rounds 14:37 to 14:30 center → window 13:30–15:30', () => {
    expect(roundEtaToWindow('2026-03-30T14:37:00.000-03:00')).toBe('entre las 13:30 y 15:30');
  });

  it('rounds 14:47 to 15:00 center → window 14:00–16:00', () => {
    expect(roundEtaToWindow('2026-03-30T14:47:00.000-03:00')).toBe('entre las 14:00 y 16:00');
  });

  it('rounds exact 14:00 → window 13:00–15:00', () => {
    expect(roundEtaToWindow('2026-03-30T14:00:00.000-03:00')).toBe('entre las 13:00 y 15:00');
  });

  it('rounds 14:15 to 14:30 center → window 13:30–15:30', () => {
    expect(roundEtaToWindow('2026-03-30T14:15:00.000-03:00')).toBe('entre las 13:30 y 15:30');
  });
});

// ── makeWismoTools ─────────────────────────────────────────────────────
function makeDb(opts: {
  sessionData?: Record<string, unknown> | null;
  messagesData?: Record<string, unknown>[];
  orderData?: Record<string, unknown> | null;
} = {}) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: opts.sessionData ?? null, error: null }),
      single: vi.fn().mockResolvedValue({ data: opts.orderData ?? null, error: null }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), error: null }),
      data: opts.messagesData ?? [],
      error: null,
    }),
  };
}

const mockSendWa = vi.fn().mockResolvedValue({ wamid: 'wamid-test' });
const context: AgentContext = { operator_id: 'op-1', job_id: 'job-1', request_id: 'req-1' };
const creds = { apiToken: 'tok', phoneNumberId: 'pnid' };

describe('makeWismoTools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('create_or_get_session returns existing session', async () => {
    const db = makeDb({ sessionData: { id: 'sess-1', status: 'active' } });
    const tools = makeWismoTools(db as never, mockSendWa, creds);
    const tool = tools.find(t => t.name === 'create_or_get_session')!;
    const result = await tool.execute({ order_id: 'ord-1', customer_phone: '+56912345678' }, context);
    expect((result as Record<string, unknown>).session_id).toBe('sess-1');
  });

  it('get_session_history returns messages array', async () => {
    const db = makeDb({ messagesData: [{ id: 'm1', role: 'system', body: 'Hi' }] });
    const tools = makeWismoTools(db as never, mockSendWa, creds);
    const tool = tools.find(t => t.name === 'get_session_history')!;
    const result = await tool.execute({ session_id: 'sess-1' }, context);
    expect(Array.isArray((result as Record<string, unknown>).messages)).toBe(true);
  });

  it('capture_reschedule inserts reschedule and confirms to caller', async () => {
    const db = makeDb();
    const tools = makeWismoTools(db as never, mockSendWa, creds);
    const tool = tools.find(t => t.name === 'capture_reschedule')!;
    const result = await tool.execute(
      {
        session_id: 'sess-1',
        order_id: 'ord-1',
        reason: 'not_home',
        customer_note: 'no estaré',
        requested_date: '2026-04-02',
      },
      context,
    );
    expect((result as Record<string, unknown>).captured).toBe(true);
  });

  it('escalate_to_human updates session status', async () => {
    const db = makeDb({ sessionData: { id: 'sess-1', status: 'active' } });
    const tools = makeWismoTools(db as never, mockSendWa, creds);
    const tool = tools.find(t => t.name === 'escalate_to_human')!;
    const result = await tool.execute({ session_id: 'sess-1', reason: 'cancel' }, context);
    expect((result as Record<string, unknown>).escalated).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/agents && npm test -- src/agents/wismo/wismo-tools.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement wismo-tools.ts**

```typescript
// apps/agents/src/agents/wismo/wismo-tools.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentTool, AgentContext } from '../base-agent';
import type { WhatsAppCreds, SendMessageResult } from '../../tools/whatsapp/send-message';
import {
  upsertCustomerSession,
  insertSessionMessage,
  getSessionMessages,
  escalateCustomerSession,
} from '../../tools/supabase/customer-sessions';
import { insertReschedule, type RescheduleReason } from '../../tools/supabase/reschedules';

// ── ETA utility ──────────────────────────────────────────────────────────

export function roundEtaToWindow(estimatedAt: string): string {
  const dt = new Date(estimatedAt);
  const totalMins = dt.getHours() * 60 + dt.getMinutes();
  const roundedMins = Math.round(totalMins / 30) * 30;
  const centerHours = Math.floor(roundedMins / 60) % 24;
  const centerMinutes = roundedMins % 60;

  const center = new Date(dt);
  center.setHours(centerHours, centerMinutes, 0, 0);

  const from = new Date(center.getTime() - 60 * 60 * 1000);
  const to = new Date(center.getTime() + 60 * 60 * 1000);

  const fmt = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `entre las ${fmt(from)} y ${fmt(to)}`;
}

// ── Tool factory ─────────────────────────────────────────────────────────

type SendFn = (
  creds: WhatsAppCreds,
  input: { to: string; body: string; templateName?: string },
) => Promise<SendMessageResult>;

export function makeWismoTools(
  db: SupabaseClient,
  sendWa: SendFn,
  creds: WhatsAppCreds,
): AgentTool[] {
  return [

    {
      name: 'create_or_get_session',
      description: 'Find or create a customer WhatsApp session for the given order.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order UUID' },
          customer_phone: { type: 'string', description: 'Customer phone in E.164 format' },
          customer_name: { type: 'string', description: 'Customer name (optional)' },
        },
        required: ['order_id', 'customer_phone'],
      },
      async execute(args, ctx: AgentContext) {
        const { order_id, customer_phone, customer_name } = args as {
          order_id: string;
          customer_phone: string;
          customer_name?: string;
        };
        const session = await upsertCustomerSession(db, {
          operator_id: ctx.operator_id,
          order_id,
          customer_phone,
          customer_name,
        });
        return { session_id: session.id, status: session.status };
      },
    },

    {
      name: 'get_session_history',
      description: 'Load the full conversation history for a session. Use as agent memory before responding.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'Session UUID' },
        },
        required: ['session_id'],
      },
      async execute(args, ctx: AgentContext) {
        const { session_id } = args as { session_id: string };
        const messages = await getSessionMessages(db, session_id, ctx.operator_id);
        return { messages };
      },
    },

    {
      name: 'get_order_status',
      description: 'Get the current delivery status and ETA for an order.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Order UUID' },
        },
        required: ['order_id'],
      },
      async execute(args, ctx: AgentContext) {
        const { order_id } = args as { order_id: string };

        const { data: order, error } = await db
          .from('orders')
          .select(`
            id, order_number, customer_name, delivery_date,
            delivery_window_start, delivery_window_end,
            rescheduled_delivery_date, rescheduled_window_start, rescheduled_window_end,
            assignments!inner(status, picked_up_at, in_transit_at, delivered_at, failed_at,
              dispatches(estimated_at, status))
          `)
          .eq('id', order_id)
          .eq('operator_id', ctx.operator_id)
          .is('deleted_at', null)
          .single();

        if (error) throw new Error(`get_order_status: ${error.message}`);
        return order;
      },
    },

    {
      name: 'send_customer_message',
      description: 'Send a WhatsApp message to the customer and log it in the session.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          customer_phone: { type: 'string' },
          body: { type: 'string', description: 'Message text in Chilean Spanish' },
          action_taken: {
            type: 'string',
            description: 'One of: status_sent, eta_sent, pickup_notified, early_arrival_offered, delivered_notified, failed_notified, reschedule_confirmed, escalated',
          },
          estimated_at: {
            type: 'string',
            description: 'ISO timestamp from dispatches.estimated_at — include only for ETA messages',
          },
        },
        required: ['session_id', 'customer_phone', 'body', 'action_taken'],
      },
      async execute(args, ctx: AgentContext) {
        const { session_id, customer_phone, body, action_taken, estimated_at } = args as {
          session_id: string;
          customer_phone: string;
          body: string;
          action_taken: string;
          estimated_at?: string;
        };

        // If this is an ETA message, append the rounded window to the body
        const finalBody =
          estimated_at && action_taken === 'eta_sent'
            ? `${body} ${roundEtaToWindow(estimated_at)}`
            : body;

        const { wamid } = await sendWa(creds, { to: customer_phone, body: finalBody });

        await insertSessionMessage(db, {
          operator_id: ctx.operator_id,
          session_id,
          role: 'system',
          body: finalBody,
          external_message_id: wamid,
          wa_status: 'sent',
          action_taken,
        });

        return { sent: true, wamid };
      },
    },

    {
      name: 'capture_reschedule',
      description: 'Record a customer reschedule request. Updates the order and the audit log.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          order_id: { type: 'string' },
          reason: {
            type: 'string',
            enum: ['not_home', 'time_preference', 'address_change', 'early_delivery', 'other'],
          },
          customer_note: { type: 'string', description: 'Raw customer message text' },
          requested_date: { type: 'string', description: 'ISO date YYYY-MM-DD (if date changed)' },
          requested_window_start: { type: 'string', description: 'HH:MM (if time range changed)' },
          requested_window_end: { type: 'string', description: 'HH:MM (if time range changed)' },
          requested_address: { type: 'string', description: 'New address text (if address change)' },
          session_message_id: { type: 'string', description: 'Message UUID that triggered this' },
        },
        required: ['session_id', 'order_id', 'reason', 'customer_note'],
      },
      async execute(args, ctx: AgentContext) {
        const {
          order_id, reason, customer_note, requested_date,
          requested_window_start, requested_window_end, requested_address, session_message_id,
        } = args as {
          order_id: string;
          reason: RescheduleReason;
          customer_note: string;
          requested_date?: string;
          requested_window_start?: string;
          requested_window_end?: string;
          requested_address?: string;
          session_message_id?: string;
        };

        await insertReschedule(db, {
          operator_id: ctx.operator_id,
          order_id,
          session_message_id: session_message_id ?? null,
          reason,
          customer_note,
          requested_date,
          requested_window_start,
          requested_window_end,
          requested_address,
        });

        return { captured: true };
      },
    },

    {
      name: 'escalate_to_human',
      description: 'Mark the session as escalated so an operator handles it. Use for cancellations, complaints, address changes.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          reason: {
            type: 'string',
            description: 'cancel | complaint | address_change | low_confidence',
          },
        },
        required: ['session_id', 'reason'],
      },
      async execute(args, ctx: AgentContext) {
        const { session_id } = args as { session_id: string; reason: string };
        await escalateCustomerSession(db, session_id, ctx.operator_id);
        return { escalated: true };
      },
    },

  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/agents && npm test -- src/agents/wismo/wismo-tools.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/agents/wismo/wismo-tools.ts \
        apps/agents/src/agents/wismo/wismo-tools.test.ts
git commit -m "feat(agents): add wismo-tools with roundEtaToWindow and 6 agent tools"
```

---

#### Task 6: wismo-fallback.ts

**Files:**
- Create: `apps/agents/src/agents/wismo/wismo-fallback.ts`
- Create: `apps/agents/src/agents/wismo/wismo-fallback.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/agents/src/agents/wismo/wismo-fallback.test.ts
import { describe, it, expect, vi } from 'vitest';
import { wismoFallback } from './wismo-fallback';

const mockSendWa = vi.fn().mockResolvedValue({ wamid: 'wamid-fallback' });

function makeDb(orderData?: Record<string, unknown> | null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: orderData ?? null, error: null }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null }),
        }),
      }),
    }),
  };
}

describe('wismoFallback', () => {
  it('sends a template message when order data is found', async () => {
    const db = makeDb({
      id: 'ord-1',
      customer_name: 'Ana',
      customer_phone: '+56912345678',
      delivery_date: '2026-04-01',
    });
    await wismoFallback(db as never, mockSendWa, { apiToken: 't', phoneNumberId: 'p' }, {
      operator_id: 'op-1',
      order_id: 'ord-1',
      session_id: 'sess-1',
      customer_phone: '+56912345678',
    });
    expect(mockSendWa).toHaveBeenCalledOnce();
    const [, { body }] = mockSendWa.mock.calls[0] as [unknown, { body: string }];
    expect(body).toContain('Ana');
  });

  it('sends a generic message when order data is not found', async () => {
    const db = makeDb(null);
    await wismoFallback(db as never, mockSendWa, { apiToken: 't', phoneNumberId: 'p' }, {
      operator_id: 'op-1',
      order_id: 'ord-1',
      session_id: 'sess-1',
      customer_phone: '+56912345678',
    });
    expect(mockSendWa).toHaveBeenCalledOnce();
  });

  it('does not throw when WhatsApp send fails', async () => {
    const db = makeDb(null);
    const failSend = vi.fn().mockRejectedValue(new Error('wa error'));
    await expect(
      wismoFallback(db as never, failSend, { apiToken: 't', phoneNumberId: 'p' }, {
        operator_id: 'op-1',
        order_id: 'ord-1',
        session_id: 'sess-1',
        customer_phone: '+56912345678',
      }),
    ).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/agents && npm test -- src/agents/wismo/wismo-fallback.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement wismo-fallback.ts**

```typescript
// apps/agents/src/agents/wismo/wismo-fallback.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppCreds, SendMessageResult } from '../../tools/whatsapp/send-message';
import { insertSessionMessage } from '../../tools/supabase/customer-sessions';
import { log } from '../../lib/logger';

type SendFn = (
  creds: WhatsAppCreds,
  input: { to: string; body: string },
) => Promise<SendMessageResult>;

export interface WismoFallbackInput {
  operator_id: string;
  order_id: string;
  session_id: string;
  customer_phone: string;
}

export async function wismoFallback(
  db: SupabaseClient,
  sendWa: SendFn,
  creds: WhatsAppCreds,
  input: WismoFallbackInput,
): Promise<void> {
  log('warn', 'wismo.fallback_triggered', {
    operator_id: input.operator_id,
    order_id: input.order_id,
  });

  // Try to load last known status from DB
  const { data: order } = await db
    .from('orders')
    .select('customer_name, delivery_date')
    .eq('id', input.order_id)
    .eq('operator_id', input.operator_id)
    .is('deleted_at', null)
    .single();

  const name = (order as Record<string, unknown> | null)?.customer_name ?? 'cliente';
  const date = (order as Record<string, unknown> | null)?.delivery_date ?? 'la fecha acordada';

  const body =
    `Hola ${name}, en este momento no podemos procesar tu consulta automáticamente. ` +
    `Tu pedido está programado para el ${date}. ` +
    `Un operador te contactará a la brevedad. Disculpa los inconvenientes.`;

  try {
    const { wamid } = await sendWa(creds, { to: input.customer_phone, body });
    await insertSessionMessage(db, {
      operator_id: input.operator_id,
      session_id: input.session_id,
      role: 'system',
      body,
      external_message_id: wamid,
      wa_status: 'sent',
      action_taken: 'fallback_template',
    });
  } catch (err) {
    log('warn', 'wismo.fallback_send_failed', {
      operator_id: input.operator_id,
      error: String(err),
    });
    // Swallow — fallback must never throw
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/agents && npm test -- src/agents/wismo/wismo-fallback.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/agents/wismo/wismo-fallback.ts \
        apps/agents/src/agents/wismo/wismo-fallback.test.ts
git commit -m "feat(agents): add wismo-fallback for LLM-unavailable path"
```

---

### Chunk 5: WISMO Agent + Worker + Queue Wiring

---

#### Task 7: wismo-agent.ts

**Files:**
- Create: `apps/agents/src/agents/wismo/wismo-agent.ts`
- Create: `apps/agents/src/agents/wismo/wismo-agent.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/agents/src/agents/wismo/wismo-agent.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processWismoJob, type WismoJobData } from './wismo-agent';

// Mock all tool dependencies
vi.mock('../../tools/whatsapp/send-message', () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ wamid: 'wamid-test' }),
}));
vi.mock('../../tools/supabase/customer-sessions', () => ({
  upsertCustomerSession: vi.fn().mockResolvedValue({ id: 'sess-1', status: 'active' }),
  insertSessionMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
  getSessionMessages: vi.fn().mockResolvedValue([]),
  escalateCustomerSession: vi.fn().mockResolvedValue(undefined),
  closeCustomerSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../tools/supabase/reschedules', () => ({
  insertReschedule: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../tools/supabase/events', () => ({
  logAgentEvent: vi.fn().mockResolvedValue(undefined),
}));

import { sendWhatsAppMessage } from '../../tools/whatsapp/send-message';
import { upsertCustomerSession, closeCustomerSession } from '../../tools/supabase/customer-sessions';

function makeDb(orderData?: Record<string, unknown> | null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: orderData ?? { id: 'ord-1', customer_phone: '+56912345678', customer_name: 'Ana' }, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'sess-1', status: 'active' }, error: null }),
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null }) }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis(), error: null }),
      data: [],
      error: null,
    }),
  };
}

const openrouterKey = 'or-key-test';

function makeJob(overrides: Partial<WismoJobData> = {}): WismoJobData {
  return {
    type: 'proactive_pickup',
    order_id: 'ord-1',
    operator_id: 'op-1',
    assignment_id: 'asgn-1',
    ...overrides,
  };
}

describe('processWismoJob — proactive_pickup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates session and sends pickup confirmed message', async () => {
    const db = makeDb();
    await processWismoJob(db as never, openrouterKey, makeJob({ type: 'proactive_pickup' }));
    expect(upsertCustomerSession).toHaveBeenCalledOnce();
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce();
    const [, { body }] = vi.mocked(sendWhatsAppMessage).mock.calls[0] as [unknown, { body: string }];
    expect(body.toLowerCase()).toContain('recogi');
  });
});

describe('processWismoJob — proactive_delivered', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends delivered message and closes the session', async () => {
    const db = makeDb();
    await processWismoJob(db as never, openrouterKey, makeJob({ type: 'proactive_delivered' }));
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce();
    expect(closeCustomerSession).toHaveBeenCalledOnce();
  });
});

describe('processWismoJob — proactive_early_arrival', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends early arrival offer with next 2 business days', async () => {
    const db = makeDb({ id: 'ord-1', customer_phone: '+56912345678', customer_name: 'Ana', delivery_date: '2026-04-10' });
    await processWismoJob(db as never, openrouterKey, makeJob({ type: 'proactive_early_arrival' }));
    expect(sendWhatsAppMessage).toHaveBeenCalledOnce();
    const [, { body }] = vi.mocked(sendWhatsAppMessage).mock.calls[0] as [unknown, { body: string }];
    expect(body).toContain('antes');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/agents && npm test -- src/agents/wismo/wismo-agent.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement wismo-agent.ts**

```typescript
// apps/agents/src/agents/wismo/wismo-agent.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import type { CoreMessage } from 'ai';
import { log } from '../../lib/logger';
import { logAgentEvent } from '../../tools/supabase/events';
import { sendWhatsAppMessage } from '../../tools/whatsapp/send-message';
import {
  upsertCustomerSession,
  insertSessionMessage,
  getSessionMessages,
  closeCustomerSession,
} from '../../tools/supabase/customer-sessions';
import { makeWismoTools, roundEtaToWindow } from './wismo-tools';
import { wismoFallback } from './wismo-fallback';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const WISMO_MODEL = 'meta-llama/llama-3.3-70b-instruct';

export interface WismoJobData {
  type:
    | 'proactive_early_arrival'
    | 'proactive_pickup'
    | 'proactive_eta'
    | 'proactive_delivered'
    | 'proactive_failed'
    | 'client_message';
  order_id: string;
  operator_id: string;
  // proactive_pickup / proactive_delivered / proactive_failed
  assignment_id?: string;
  failure_reason?: string;
  // proactive_eta
  estimated_at?: string;
  // client_message
  session_id?: string;
  body?: string;
  external_message_id?: string;
}

export async function processWismoJob(
  db: SupabaseClient,
  openrouterApiKey: string,
  job: WismoJobData,
): Promise<void> {
  const { type, order_id, operator_id } = job;
  log('info', 'wismo.job_started', { type, order_id, operator_id });

  // Load the order for customer phone / name
  const { data: order, error: orderErr } = await db
    .from('orders')
    .select('id, customer_name, customer_phone, delivery_date, order_number')
    .eq('id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .single();

  if (orderErr || !order) {
    log('error', 'wismo.order_not_found', { order_id, operator_id });
    return;
  }

  const { customer_phone, customer_name } = order as {
    customer_phone: string;
    customer_name: string;
    delivery_date: string;
    order_number: string;
  };

  const creds = {
    apiToken: process.env['WHATSAPP_API_TOKEN'] ?? '',
    phoneNumberId: process.env['WHATSAPP_PHONE_NUMBER_ID'] ?? '',
  };

  // ── Proactive handlers (no LLM needed) ─────────────────────────────────
  if (type === 'proactive_pickup') {
    const session = await upsertCustomerSession(db, { operator_id, order_id, customer_phone, customer_name });
    const body = `Hola ${customer_name}, tu pedido ha sido recogido y está en camino. Te avisaremos cuando tengamos el horario estimado de entrega. Si necesitas reprogramar o tienes alguna consulta, responde a este mensaje.`;
    const { wamid } = await sendWhatsAppMessage(creds, { to: customer_phone, body });
    await insertSessionMessage(db, { operator_id, session_id: session.id, role: 'system', body, external_message_id: wamid, wa_status: 'sent', action_taken: 'pickup_notified' });
    await logAgentEvent(db, { operator_id, agent: 'wismo', event_type: 'proactive_pickup', meta: { order_id, session_id: session.id } });
    return;
  }

  if (type === 'proactive_eta' && job.estimated_at) {
    const session = await upsertCustomerSession(db, { operator_id, order_id, customer_phone, customer_name });
    const window = roundEtaToWindow(job.estimated_at);
    const body = `Hola ${customer_name}, tu pedido va en camino. Estimamos entregarlo hoy ${window}. Si necesitas reprogramar, responde a este mensaje.`;
    const { wamid } = await sendWhatsAppMessage(creds, { to: customer_phone, body });
    await insertSessionMessage(db, { operator_id, session_id: session.id, role: 'system', body, external_message_id: wamid, wa_status: 'sent', action_taken: 'eta_sent' });
    await logAgentEvent(db, { operator_id, agent: 'wismo', event_type: 'proactive_eta', meta: { order_id, estimated_at: job.estimated_at, window } });
    return;
  }

  if (type === 'proactive_delivered') {
    const session = await upsertCustomerSession(db, { operator_id, order_id, customer_phone, customer_name });
    const body = `Hola ${customer_name}, tu pedido fue entregado exitosamente. ¡Gracias por preferirnos!`;
    const { wamid } = await sendWhatsAppMessage(creds, { to: customer_phone, body });
    await insertSessionMessage(db, { operator_id, session_id: session.id, role: 'system', body, external_message_id: wamid, wa_status: 'sent', action_taken: 'delivered_notified' });
    await closeCustomerSession(db, session.id, operator_id);
    await logAgentEvent(db, { operator_id, agent: 'wismo', event_type: 'proactive_delivered', meta: { order_id } });
    return;
  }

  if (type === 'proactive_failed') {
    const session = await upsertCustomerSession(db, { operator_id, order_id, customer_phone, customer_name });
    const body = `Hola ${customer_name}, lamentamos informarte que no pudimos entregar tu pedido hoy. Un operador te contactará para coordinar una nueva entrega.`;
    const { wamid } = await sendWhatsAppMessage(creds, { to: customer_phone, body });
    await insertSessionMessage(db, { operator_id, session_id: session.id, role: 'system', body, external_message_id: wamid, wa_status: 'sent', action_taken: 'failed_notified' });
    await closeCustomerSession(db, session.id, operator_id);
    await logAgentEvent(db, { operator_id, agent: 'wismo', event_type: 'proactive_failed', meta: { order_id, failure_reason: job.failure_reason } });
    return;
  }

  if (type === 'proactive_early_arrival') {
    const session = await upsertCustomerSession(db, { operator_id, order_id, customer_phone, customer_name });
    const deliveryDate = (order as Record<string, unknown>).delivery_date as string;
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() + 1);
    const d2 = new Date(today); d2.setDate(d2.getDate() + 2);
    const fmt = (d: Date) => d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
    const body = `Hola ${customer_name}, ya tenemos tu pedido listo en nuestro centro. La entrega estaba programada para el ${new Date(deliveryDate).toLocaleDateString('es-CL')}, pero podemos adelantarla. ¿Te acomoda recibirla el ${fmt(d1)}, el ${fmt(d2)}, o prefieres la fecha original? Responde con tu preferencia.`;
    const { wamid } = await sendWhatsAppMessage(creds, { to: customer_phone, body });
    await insertSessionMessage(db, { operator_id, session_id: session.id, role: 'system', body, external_message_id: wamid, wa_status: 'sent', action_taken: 'early_arrival_offered' });
    await logAgentEvent(db, { operator_id, agent: 'wismo', event_type: 'proactive_early_arrival', meta: { order_id } });
    return;
  }

  // ── Reactive: client_message (LLM-powered) ─────────────────────────────
  if (type === 'client_message' && job.body) {
    const session = await upsertCustomerSession(db, { operator_id, order_id, customer_phone, customer_name });
    const sessionId = job.session_id ?? session.id;

    // Log the inbound message
    await insertSessionMessage(db, {
      operator_id,
      session_id: sessionId,
      role: 'user',
      body: job.body,
      external_message_id: job.external_message_id,
      wa_status: 'received',
    });

    // Load history for agent context
    const history = await getSessionMessages(db, sessionId, operator_id);

    const tools = makeWismoTools(db, sendWhatsAppMessage, creds);

    const systemPrompt = `Eres el asistente de entregas de Aureon. Ayudas a clientes chilenos con sus pedidos por WhatsApp.
Siempre responde en español chileno informal (tuteo, "oye", "ya po").
Tu operator_id es ${operator_id}. El order_id es ${order_id}. El session_id es ${sessionId}.
El teléfono del cliente es ${customer_phone}.

Cuando el cliente pide reprogramar: usa capture_reschedule y luego send_customer_message para confirmar.
Cuando el cliente pide cancelar o tiene una queja grave: usa escalate_to_human.
Cuando el cliente pregunta dónde está su pedido: usa get_order_status y luego send_customer_message con el estado.
Siempre termina enviando un mensaje al cliente con send_customer_message.`;

    const messages: CoreMessage[] = [
      ...history.map(m => ({
        role: (m.role === 'system' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.body,
      })),
    ];

    // Build AI SDK tool definitions from AgentTool array
    const aiTools = Object.fromEntries(
      tools.map(t => [
        t.name,
        {
          description: t.description,
          parameters: t.parameters,
          execute: (args: Record<string, unknown>) =>
            t.execute(args, { operator_id, job_id: order_id, request_id: sessionId }),
        },
      ]),
    );

    try {
      const openrouterClient = createOpenAI({
        apiKey: openrouterApiKey,
        baseURL: OPENROUTER_BASE,
      });

      await generateText({
        model: openrouterClient(WISMO_MODEL),
        system: systemPrompt,
        messages,
        tools: aiTools as Parameters<typeof generateText>[0]['tools'],
        maxSteps: 5,
      });

      await logAgentEvent(db, { operator_id, agent: 'wismo', event_type: 'client_message_handled', meta: { order_id, session_id: sessionId } });
    } catch (err) {
      log('warn', 'wismo.llm_failed', { error: String(err), order_id });
      await wismoFallback(db, sendWhatsAppMessage, creds, { operator_id, order_id, session_id: sessionId, customer_phone });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/agents && npm test -- src/agents/wismo/wismo-agent.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/agents/wismo/wismo-agent.ts \
        apps/agents/src/agents/wismo/wismo-agent.test.ts
git commit -m "feat(agents): implement processWismoJob — proactive triggers + reactive NLU"
```

---

#### Task 8: wismo-worker.ts

**Files:**
- Create: `apps/agents/src/agents/wismo/wismo-worker.ts`
- Create: `apps/agents/src/agents/wismo/wismo-worker.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/agents/src/agents/wismo/wismo-worker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createWismoHandler } from './wismo-worker';

vi.mock('./wismo-agent', () => ({
  processWismoJob: vi.fn().mockResolvedValue(undefined),
}));
import { processWismoJob } from './wismo-agent';

function makeDb() {
  return {};
}

describe('createWismoHandler', () => {
  it('calls processWismoJob with validated job data', async () => {
    const handler = createWismoHandler(makeDb() as never, 'or-key');
    await handler({
      data: {
        type: 'proactive_pickup',
        order_id: 'ord-1',
        operator_id: 'op-1',
        assignment_id: 'asgn-1',
      },
    } as never);
    expect(processWismoJob).toHaveBeenCalledOnce();
  });

  it('throws when order_id is missing', async () => {
    const handler = createWismoHandler(makeDb() as never, 'or-key');
    await expect(
      handler({ data: { type: 'proactive_pickup', operator_id: 'op-1' } } as never),
    ).rejects.toThrow('wismo job missing order_id');
  });

  it('throws when operator_id is missing', async () => {
    const handler = createWismoHandler(makeDb() as never, 'or-key');
    await expect(
      handler({ data: { type: 'proactive_pickup', order_id: 'ord-1' } } as never),
    ).rejects.toThrow('wismo job missing operator_id');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd apps/agents && npm test -- src/agents/wismo/wismo-worker.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement wismo-worker.ts**

```typescript
// apps/agents/src/agents/wismo/wismo-worker.ts
import type { Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import { processWismoJob, type WismoJobData } from './wismo-agent';
import { log } from '../../lib/logger';

export function createWismoHandler(
  db: SupabaseClient,
  openrouterApiKey: string,
): (job: Job) => Promise<void> {
  return async (job: Job): Promise<void> => {
    const data = job.data as Record<string, unknown>;

    if (typeof data['order_id'] !== 'string' || !data['order_id']) {
      throw new Error('wismo job missing order_id');
    }
    if (typeof data['operator_id'] !== 'string' || !data['operator_id']) {
      throw new Error('wismo job missing operator_id');
    }
    if (typeof data['type'] !== 'string' || !data['type']) {
      throw new Error('wismo job missing type');
    }

    log('info', 'wismo.job_received', {
      job_id: job.id,
      type: data['type'],
      order_id: data['order_id'],
      operator_id: data['operator_id'],
    });

    await processWismoJob(db, openrouterApiKey, data as unknown as WismoJobData);
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/agents && npm test -- src/agents/wismo/wismo-worker.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/agents/wismo/wismo-worker.ts \
        apps/agents/src/agents/wismo/wismo-worker.test.ts
git commit -m "feat(agents): add wismo-worker factory"
```

---

#### Task 9: Wire WISMO into orchestration (queues + workers + index)

**Files:**
- Modify: `apps/agents/src/orchestration/queues.ts`
- Modify: `apps/agents/src/orchestration/workers.ts`
- Modify: `apps/agents/src/index.ts`

- [ ] **Step 1: Update queues.ts — add new job type constants**

Open `apps/agents/src/orchestration/queues.ts`. The `wismo.client` queue already exists. Add a note comment documenting the new job types that are now handled:

```typescript
// wismo.client job types:
//   proactive_early_arrival  — fired by Intake agent on order confirm + future delivery_date
//   proactive_pickup         — fired by COORD agent on assignment picked_up
//   proactive_eta            — fired by Beetrack webhook on route in_progress
//   proactive_delivered      — fired by COORD agent on assignment delivered
//   proactive_failed         — fired by COORD agent on assignment failed
//   client_message           — fired by WhatsApp webhook on inbound customer message
```

No code change needed if `wismo.client` queue config is already present. Verify it exists:

```bash
grep -n "wismo" apps/agents/src/orchestration/queues.ts
```

Expected: `wismo.client` queue is defined.

- [ ] **Step 2: Update workers.ts — register WISMO handler**

Open `apps/agents/src/orchestration/workers.ts`. Find where handlers are provided to `createWorkers`. Add the WISMO handler alongside the intake handler:

```typescript
import { createWismoHandler } from '../agents/wismo/wismo-worker';

// Inside the function that creates handlers:
handlers['wismo.client'] = createWismoHandler(db, config.OPENROUTER_API_KEY);
```

- [ ] **Step 3: Run the orchestration tests to verify nothing is broken**

```bash
cd apps/agents && npm test -- src/orchestration/workers.test.ts
```

Expected: PASS (existing tests should still pass).

- [ ] **Step 4: Run the full test suite**

```bash
cd apps/agents && npm test
```

Expected: all tests PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/orchestration/queues.ts \
        apps/agents/src/orchestration/workers.ts \
        apps/agents/src/index.ts
git commit -m "feat(agents): wire WISMO handler into orchestration"
```

---

#### Task 10: Final integration check + push

- [ ] **Step 1: Run full test suite one last time**

```bash
cd apps/agents && npm test -- --reporter=verbose
```

Expected: all tests PASS.

- [ ] **Step 2: Check no file exceeds 300 lines**

```bash
wc -l apps/agents/src/agents/wismo/*.ts apps/agents/src/tools/supabase/customer-sessions.ts apps/agents/src/tools/supabase/reschedules.ts apps/agents/src/tools/whatsapp/send-message.ts
```

Expected: every file ≤ 300 lines.

- [ ] **Step 3: Push and create PR**

```bash
git push origin HEAD
gh pr create --title "feat(agents): implement spec-24 customer communication agent (WISMO)" \
  --body "Implements the customer communication agent per spec-24. Adds DB migration, customer_sessions, order_reschedules tables, WhatsApp tool, and WISMO agent with 5 proactive triggers + reactive NLU."
gh pr merge --auto --squash
```

- [ ] **Step 4: Confirm CI passes**

```bash
gh pr checks <PR_NUMBER> --watch
```

Expected: all checks green.
