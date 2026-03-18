# Spec-10b: Agent Suite — Database Migration (Phase 1)

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> Data model: `docs/architecture/agents-data-model.sql`
> Design notes: `docs/architecture/agents-data-model-notes.md`

_Date: 2026-03-18_

---

## Goal

Deploy all 15 new tables, 16+ enum types, indexes, RLS policies, and triggers from the agent data model to Supabase. Single migration covering all agent domains.

## Prerequisites

- Phase 0 completed (apps/agents/ scaffold)
- Spec-09 completed (migrations in `packages/database/supabase/migrations/`)

## Deliverables

### Enum Types (15+)

`intake_method_enum` (add `mobile_camera` value), `intake_status_enum` (add `needs_review` value), `fleet_type_enum`, `driver_status_enum`, `assignment_status_enum`, `conversation_channel_enum`, `participant_type_enum`, `message_direction_enum`, `message_sender_enum`, `wismo_type_enum`, `wismo_delivery_status_enum`, `settlement_status_enum`, `pay_model_enum`, `exception_severity_enum`, `exception_status_enum`, `exception_category_enum`, `command_status_enum`

**Data model additions required** (not yet in `agents-data-model.sql`):
- Add `mobile_camera` to `intake_method_enum` (for mobile app camera intake channel)
- Add `needs_review` to `intake_status_enum` (between `parsed` and `confirmed` — for ambiguous parsing results)
- Add `exception_category_enum`: `late_delivery`, `driver_no_show`, `missing_pod`, `wrong_address`, `data_quality`, `customer_complaint`, `safety_incident`, `duplicate_submission`, `amount_mismatch`, `other`
- Add `command_status_enum`: `pending`, `processed`, `failed`

### New Tables (15)

1. `generators` — cargo generator configuration (extends tenant_clients)
2. `intake_submissions` — multi-channel order ingestion tracking
3. `drivers` — own + external driver unified registry
4. `driver_availabilities` — daily availability slots
5. `assignments` — order-to-driver binding with state machine
6. `conversations` — WhatsApp thread registry
7. `conversation_messages` — individual messages with intent classification
8. `wismo_notifications` — client communication tracking
9. `settlement_periods` — end-of-day reconciliation periods
10. `settlement_line_items` — per-delivery pay lines
11. `settlement_documents` — attached invoices/receipts
12. `exceptions` — deviation tracking (4 severity levels)
13. `agent_events` — immutable append-only audit trail
14. `agent_tool_calls` — individual tool invocations
15. `agent_commands` — dashboard→agents command bridge (WhatsApp webhook + operator actions)

### Existing Table Extensions

- `orders` table: new columns for agent suite integration (assignment linking, agent metadata)

### Indexes

- GIN indexes on `drivers.zones` and `conversations.context_order_ids` (containment queries)
- Partial unique indexes for one-active-per constraints (e.g., one active assignment per order)
- Standard B-tree indexes on FK columns and common query patterns

### RLS Policies

- Service role bypasses all (agent process)
- Authenticated users: read access scoped by `operator_id` (dashboard)
- Anon: no access

### Triggers

- `updated_at` auto-update trigger on mutable tables
- Audit trigger (`audit_trigger_func()`) on mutable tables
- Immutable tables (`agent_events`, `agent_tool_calls`, `conversation_messages`) skip triggers — they ARE the audit trail

### `agent_commands` Table Schema

Not yet in `agents-data-model.sql` — must be added:

```sql
agent_commands
  id              UUID PK DEFAULT gen_random_uuid()
  operator_id     UUID NOT NULL (FK operators)
  command_type    VARCHAR NOT NULL  -- reassign_driver, cancel_order, retry_intake, etc.
  payload         JSONB NOT NULL DEFAULT '{}'
  status          command_status_enum DEFAULT 'pending'
  source          VARCHAR NOT NULL   -- 'dashboard', 'whatsapp_webhook', 'system'
  processed_at    TIMESTAMPTZ
  error_message   TEXT
  created_at      TIMESTAMPTZ DEFAULT NOW()
```

### `operator_config` Table

Operator-level agent configuration. Architecture doc (§2.4) describes this as either a table or JSONB column on `operators`. Implement as a dedicated table for queryability:

```sql
operator_config
  id              UUID PK DEFAULT gen_random_uuid()
  operator_id     UUID NOT NULL UNIQUE (FK operators)
  timezone        VARCHAR DEFAULT 'America/Santiago'
  business_hours  JSONB DEFAULT '{"start":"07:00","end":"19:00"}'
  whatsapp_enabled BOOLEAN DEFAULT false
  auto_assignment_enabled BOOLEAN DEFAULT true
  escalation_email VARCHAR
  wismo_response_language VARCHAR DEFAULT 'es-CL'
  agent_overrides JSONB DEFAULT '{}'  -- per-agent config overrides
  created_at      TIMESTAMPTZ DEFAULT NOW()
  updated_at      TIMESTAMPTZ DEFAULT NOW()
```

## Migration Strategy

- Source SQL: `docs/architecture/agents-data-model.sql`
- Split into ordered migration files if >500 lines (enums first, then tables, then indexes/RLS)
- All wrapped in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` for idempotency

## Exit Criteria

- `supabase db push` succeeds without errors
- `supabase gen types` produces TypeScript types matching all new tables and enums
- Types exported from `packages/database/` and importable by `apps/agents/`
- RLS tested: service-role key bypasses, authenticated sees only own operator's data
- Rollback migration tested (can drop all new objects cleanly)
- No existing table functionality broken (orders, manifests, etc.)
