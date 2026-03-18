# Spec-10f: ASSIGNMENT Agent (Phase 5)

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> Architecture: `docs/architecture/agents.md` §3 (assignment)
> API design: `docs/architecture/agents-api-design.md` §2, §4

_Date: 2026-03-18_

---

## Goal

Assign orders to drivers using OR-Tools route optimization. Runs on cron (2×/day), produces optimized routes, creates assignment records, and spawns COORD jobs per driver.

## Prerequisites

- Phase 2 (orchestration — `assignment.optimize` queue active)
- Phase 4 (OR-Tools sidecar running on VPS)

## Flow

```
BullMQ cron (6am, 2pm Santiago) → assignment.optimize queue
  → ASSIGNMENT agent:
      1. get_unassigned_orders() → orders pending for today
      2. get_available_drivers() → drivers with availability + capacity
      3. request_assignment() → HTTP POST to OR-Tools sidecar
         ├── Returns optimized routes per driver
         └── Returns unassigned orders with reasons
      4. assign_driver() per route → create assignment (status: pending)
      5. Unassignable orders → escalate_no_capacity() → dashboard alert
      6. Enqueue coord.lifecycle { type: 'new_assignment' } per driver
```

## Deliverables

### Agent Core (`src/agents/assignment/`)

- `assignment-agent.ts` — agent definition:
  - Model: Claude Sonnet (`anthropic:claude-sonnet`) — complex constraint reasoning, low volume
  - System prompt: Chilean logistics assignment context, constraint awareness
  - Tools: `get_unassigned_orders`, `get_available_drivers`, `request_assignment`, `assign_driver`, `escalate_no_capacity`
  - maxSteps: 8
- `assignment-tools.ts` — tool definitions with Zod input schemas
- `assignment-fallback.ts`:
  - OR-Tools sidecar down → zone-based greedy fallback (group by zone, fill by capacity)
  - LLM down → escalate all to human (no automated assignment without reasoning)

### Shared Tools

- `src/tools/supabase/drivers.ts` — `get_available_drivers` (joins `drivers` + `driver_availabilities` for date), `update_driver_status`
- `src/tools/supabase/assignments.ts` — `create_assignment`, `get_assignments_by_date`, `update_assignment_status`
- `src/tools/solver/request-assignment.ts` — HTTP POST to OR-Tools sidecar:
  - Builds request payload from orders + drivers data
  - AbortController with 120s timeout
  - Health check before sending payload
  - Returns parsed response or error

### Parent→Child Jobs

- On successful assignment → `FlowProducer` creates:
  - `coord.lifecycle { type: 'new_assignment', driver_id, assignment_id, route }` per driver

### Greedy Fallback (sidecar down)

- Group orders by zone (orders have zone/comuna)
- Match zones to drivers (`drivers.zones` GIN query)
- Fill drivers by capacity (weight, volume, stops)
- Overflow → next available driver covering that zone
- No driver for zone → escalate
- Produces valid but suboptimal assignments

## Exit Criteria

- Cron fires at 6am and 2pm America/Santiago
- Unassigned orders → OR-Tools → optimized routes → assignment records created (status: `pending`)
- Routes respect hard constraints: weight, volume, stops, time windows, shifts
- Unassignable orders → `agent_events` with type `escalation` → dashboard alert
- Child jobs enqueued for COORD (one per driver with assignment)
- Sidecar down → greedy fallback produces valid assignments, logs `solver_fallback` event
- LLM down → all escalated to human
- `operator_id` on every query
- All files under 300 lines with collocated tests
