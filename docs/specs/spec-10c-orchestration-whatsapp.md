# Spec-10c: Agent Suite — Orchestration + WhatsApp Webhook (Phase 2)

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> API design: `docs/architecture/agents-api-design.md` §1, §3, §5

_Date: 2026-03-18_

---

## Goal

BullMQ queues running with cron schedules, WhatsApp inbound messages routed to correct queues, dashboard→agents command bridge operational.

## Prerequisites

- Phase 0 (scaffold + infrastructure)
- Phase 1 (database migration — `agent_commands` table exists)

## Deliverables

### Orchestration (`src/orchestration/`)

#### Queue Definitions (`queues.ts`)

| Queue | Concurrency | Rate Limit | Retry |
|-------|-------------|------------|-------|
| `intake.ingest` | 3 | — | 3× exp (1m base) |
| `assignment.optimize` | 1 | — | 2× (2m base) |
| `coord.lifecycle` | 5 | — | 3× (30s base) |
| `wismo.client` | 5 | — | 3× (30s base) |
| `settle.reconcile` | 1 | — | 3× (5m base) |
| `whatsapp.outbound` | 10 | 60/min per phone | 3× (10s base) |
| `exception.handle` | 3 | — | 3× (1m base) |
| `legacy.worker` | 1 | — | 3× (60s base) |

#### Worker Registrations (`workers.ts`)

- Maps each queue to a handler function
- Initially stub handlers: log job data + complete successfully
- Real handlers plugged in per-agent phase (Phase 3+)

#### Cron Schedules (`schedulers.ts`)

| Schedule | Queue | Job | TZ |
|----------|-------|-----|-----|
| `*/15 * * * *` | intake.ingest | email_parse | America/Santiago |
| `0 6,14 * * *` | assignment.optimize | batch_assign | America/Santiago |
| `0 22 * * *` | settle.reconcile | eod_reconcile | America/Santiago |

#### Priority System

```
Priority 10: Human escalations, manual overrides from dashboard
Priority  7: Real-time coordination (driver_message, client_message)
Priority  5: Standard operations (batch_assign, new_assignment)
Priority  3: Proactive notifications (proactive_eta, proactive_delay)
Priority  1: Background batch (eod_reconcile, generate_report, legacy)
```

#### Flow Producer

- BullMQ `FlowProducer` instance for parent→child job relationships
- Used by agents to spawn dependent jobs (e.g., ASSIGNMENT → COORD per driver)

#### Entry Point Update (`index.ts`)

- Boot Redis → create queues → register workers → register schedulers
- Graceful shutdown: drain all workers, close queues, disconnect Redis

### WhatsApp Webhook

#### Supabase Edge Function: `whatsapp-webhook`

- Verify `X-Hub-Signature-256` using `WA_APP_SECRET`
- Parse inbound message payload
- Normalize phone to E.164 (`+569XXXXXXXX`)
- Route by sender:

```
Step 1: Check drivers table (operator_id, phone) → coord.lifecycle { type: 'driver_message' }
Step 2: Check orders (operator_id, customer_phone, active) → wismo.client { type: 'client_message' }
Step 3: Check media type + text hints → intake.ingest { type: 'photo_parse' }
Step 4: Default → wismo.client { type: 'client_message', flag: 'unknown' }
```

- Insert routed job into `agent_commands` table (Edge Function cannot reach Redis)
- Return 200 within 5s (WhatsApp requirement)

### Dashboard→Agents Bridge

#### Command Listener (in `apps/agents`)

- Subscribes to Supabase Realtime `INSERT` on `agent_commands` table
- Maps command type to queue + job data + priority 10
- Command types: `reassign_driver`, `cancel_order`, `force_escalation`, `retry_intake`, `manual_assign`, `override_status`, `send_manual_wa`, `pause_agent`, `resume_agent`
- Marks command as `processed` after enqueueing

### Monitoring

- Bull Board HTTP dashboard (port 3101, basic auth) for queue visibility
- Structured logs for every queue event: job added, started, completed, failed, dead

## Exit Criteria

- All 8 queues visible in Bull Board, healthy status
- Cron jobs fire on schedule (verified in structured logs)
- WhatsApp test message → Edge Function → `agent_commands` → command listener → correct BullMQ queue
- Dashboard command insert → picked up by listener → enqueued with priority 10
- Graceful shutdown drains all workers without losing jobs
- All with collocated tests
