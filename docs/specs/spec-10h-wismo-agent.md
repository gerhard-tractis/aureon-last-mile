# Spec-10h: WISMO Agent (Phase 7)

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> Architecture: `docs/architecture/agents.md` §3 (wismo)
> API design: `docs/architecture/agents-api-design.md` §2

_Date: 2026-03-18_

---

## Goal

Client-facing communication: proactive delivery notifications and reactive "where is my order?" (WISMO) handling via WhatsApp. <30s response SLA for reactive queries.

## Prerequisites

- Phase 2 (orchestration — `wismo.client` queue, WhatsApp webhook routing)
- Phase 6 (COORD agent — assignment status changes trigger proactive notifications)

## Proactive Flow

```
COORD updates assignment status (accepted, in_transit, delivered, failed)
  → Trigger: wismo.client { type: 'proactive_*' }
  → WISMO agent:
      1. get_order_status() → current state + ETA
      2. send_client_update() → WhatsApp to customer:
         ├── proactive_dispatched: "Tu pedido va en camino"
         ├── proactive_eta: "Llegada estimada: 14:30-15:00"
         ├── proactive_delivered: "Tu pedido fue entregado"
         ├── proactive_failed: "No pudimos entregar, te contactaremos"
         └── proactive_rescheduled: "Tu entrega fue reprogramada para..."
```

## Reactive Flow

```
Customer WhatsApp message → wismo.client { type: 'client_message' }
  → WISMO agent:
      1. Classify intent (Groq NLU):
         ├── status_inquiry: "dónde está mi pedido?"
         ├── reschedule: "pueden venir mañana?"
         ├── cancel: "quiero cancelar"
         ├── complaint: "llegó dañado", "ya pasó la hora"
         └── other: unrelated or ambiguous
      2. Action per intent:
         ├── status_inquiry → get_order_status() → respond with status + ETA
         ├── reschedule → reschedule_delivery() → confirm new date
         ├── cancel → escalate_to_human (requires operator approval)
         ├── complaint → escalate_to_human + create exception
         └── other → best-effort response or escalate if below confidence
```

## Deliverables

### Agent Core (`src/agents/wismo/`)

- `wismo-agent.ts` — agent definition:
  - Model: Groq Llama 3.3 70B (`groq:llama-3.3-70b`) — real-time, <30s SLA
  - System prompt: Chilean Spanish, empathetic client communication, logistics status context
  - Tools: `get_order_status`, `send_client_update`, `reschedule_delivery`, `escalate_to_human`
  - maxSteps: 5
- `wismo-tools.ts` — tool definitions with Zod input schemas
- `wismo-fallback.ts` — LLM down → respond with last known status from DB using template message (no NLU)

### Client Message NLU

- Groq classifies inbound customer messages
- Chilean Spanish, informal tone ("oye", "porfa", "ya po")
- Confidence threshold: below threshold → escalate rather than guess wrong
- Multi-order matching: customer may have multiple active orders, agent selects most relevant

### Shared Tools

- `src/tools/supabase/wismo.ts` — `create_notification`, `update_notification_status`
- Reuses: `whatsapp/send-message.ts`, `supabase/orders.ts`, `supabase/conversations.ts`

### Notification Tracking

- Every notification logged to `wismo_notifications` table:
  - `type`: proactive_* or reactive_*
  - `delivery_status`: pending → sent → delivered → read
  - Linked to order, conversation, operator
- WhatsApp delivery/read receipts update `delivery_status` via webhook

### Conversation Management

- Client conversations tracked in `conversations` (participant_type: `client`)
- Full message history in `conversation_messages`
- Context linking: conversation → order IDs for multi-order customers

## Exit Criteria

- Proactive notifications fire automatically on assignment status changes
- Customer "¿Dónde está mi pedido?" → accurate status + ETA response within 30s
- Reschedule requests → new date confirmed to customer
- Cancellation requests → escalated to operator (not auto-processed)
- Complaints → escalated + exception record created
- Notification delivery status tracked (pending → sent → delivered → read)
- Fallback: LLM down → template response with last known DB status
- `operator_id` on every query, audit events for every action
- All files under 300 lines with collocated tests
