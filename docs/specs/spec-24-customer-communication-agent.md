# Spec-24: Customer Communication Agent (WISMO Expanded)

> **Supersedes:** [spec-10h-wismo-agent.md](spec-10h-wismo-agent.md) — do not implement spec-10h.
> Architecture: `docs/architecture/agents.md`
> Data model: `docs/architecture/agents-data-model.sql`
> ETA source: `packages/database/supabase/functions/beetrack-webhook/`

**Status:** in progress

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
