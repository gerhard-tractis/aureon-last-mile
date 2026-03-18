# Spec-10g: COORD Agent (Phase 6)

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> Architecture: `docs/architecture/agents.md` §3 (coord)
> API design: `docs/architecture/agents-api-design.md` §2, §3

_Date: 2026-03-18_

---

## Goal

WhatsApp-based driver coordination — from assignment notification through delivery confirmation. Manages the full driver lifecycle via conversational AI.

## Prerequisites

- Phase 5 (ASSIGNMENT agent — produces `coord.lifecycle` child jobs)
- Phase 2 (WhatsApp webhook routing driver messages to `coord.lifecycle`)

## Flow

```
ASSIGNMENT creates assignment → coord.lifecycle { type: 'new_assignment' }
  → COORD agent:
      1. send_whatsapp() → route sheet to driver (template message)
      2. Start confirmation timer (delayed job: 30min)
      3. Driver responses:
         ├── Accepts → update assignment (accepted)
         ├── Rejects → reassign_driver() → back to ASSIGNMENT
         ├── Counter-offers (external driver) → negotiation loop
         └── Timer expires → escalate_to_human()
      4. During delivery:
         ├── Status update → update_eta(), mark_delivered()
         ├── Problem report → create_exception()
         └── No update timeout → send reminder via WhatsApp
```

### Assignment State Machine

```
pending → [send WA] → offered (external) or accepted (own)
offered → accepted | rejected | expired | negotiating
negotiating → accepted | rejected | expired
accepted → pickup_pending → picked_up → in_transit → delivered | partially_done | failed
Any state → cancelled (operator override)
delivered | partially_done | failed → settled (Phase 8)
```

## Deliverables

### Agent Core (`src/agents/coord/`)

- `coord-agent.ts` — agent definition:
  - Model: Groq Llama 3.3 70B (`groq:llama-3.3-70b`) — real-time, high volume
  - System prompt: Chilean Spanish driver communication, logistics coordination context
  - Tools: `send_whatsapp`, `update_eta`, `reassign_driver`, `mark_delivered`, `create_exception`, `escalate_to_human`
  - maxSteps: 6
- `coord-tools.ts` — tool definitions with Zod input schemas
- `coord-fallback.ts` — LLM down → template-only messages (no NLU on driver replies, queue all for human review)

### Shared Tools

- `src/tools/whatsapp/send-message.ts` — WhatsApp Business API wrapper:
  - Template messages (route sheet, reminders, confirmations)
  - Free-form text messages
  - Media messages (photos, documents)
  - All outbound through `whatsapp.outbound` queue (rate limited: 60/min per phone)
- `src/tools/whatsapp/receive-webhook.ts` — parse inbound webhook payload (message text, media, status updates)
- `src/tools/supabase/conversations.ts` — `create_conversation`, `get_conversation`, `add_message`
- `src/tools/supabase/assignments.ts` — `update_assignment_status` (enforces valid state transitions)
- `src/tools/supabase/exceptions.ts` — **introduced in this phase**: `create_exception` (COORD is the first agent that creates exceptions from driver problems; EXCEPTION agent in Phase 9 adds `update_exception` and `get_exceptions_by_operator`)

### Driver Message NLU

- Groq classifies inbound driver messages:
  - `acceptance`: "listo", "dale", "ok voy"
  - `rejection`: "no puedo", "paso", "no tengo tiempo"
  - `counter_offer`: "solo si pagan X", "puedo pero a las 3"
  - `status_update`: "ya recogí", "en camino", "entregado"
  - `problem_report`: "no hay nadie", "dirección mala", "paquete dañado"
  - `unrelated`: off-topic messages
- Handles Chilean Spanish colloquialisms (po, cachai, wena, etc.)

### Delayed Jobs

- `check_timer`: fires 30min after assignment WA sent — verifies driver confirmed
  - If no response → send reminder
  - If still no response after 2nd timer → escalate_to_human
- `escalation_timeout`: configurable per operator — total window before hard escalation

### Conversation Tracking

- Every interaction creates/updates a `conversations` row
- Every message (inbound + outbound) logged to `conversation_messages`
- Conversation linked to assignment, driver, and order IDs

## Exit Criteria

- Driver receives WhatsApp with route sheet on new assignment
- Accept reply → assignment status `accepted`
- Reject reply → `reassign_driver` triggered
- 30min no response → reminder sent → escalation on continued silence
- Status updates from driver update assignment state correctly
- Problem reports create exception records
- All messages persisted in `conversation_messages`
- Conversation history queryable by operator from dashboard
- Fallback: LLM down → template messages only, inbound queued for human
- `operator_id` on every query, audit events for every action
- All files under 300 lines with collocated tests
