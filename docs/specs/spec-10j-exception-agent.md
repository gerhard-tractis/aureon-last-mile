# Spec-10j: EXCEPTION Agent (Phase 9)

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> Architecture: `docs/architecture/agents.md` §3 (exception)
> API design: `docs/architecture/agents-api-design.md` §2

_Date: 2026-03-18_

---

## Goal

Cross-cutting deviation handling: classify exceptions by severity, auto-resolve known patterns, escalate unknown or critical issues to humans with full context.

## Prerequisites

- Phase 6 (COORD — creates exceptions from driver problems)
- Phase 7 (WISMO — creates exceptions from client complaints)
- Phase 8 (SETTLE — creates exceptions from discrepancies)

## Triggers

Exceptions arrive from any agent domain:

| Source | Exception Types |
|--------|----------------|
| COORD | Driver no-show, vehicle breakdown, wrong address, access denied, package damaged |
| WISMO | Customer complaint, delivery dispute, service quality issue |
| SETTLE | Missing POD, amount mismatch, unconfirmed delivery, duplicate charge |
| INTAKE | Repeated parsing failures, unreadable document, duplicate submission |
| Dashboard | Operator manually flags any issue |

## Flow

```
Exception created → exception queue
  → EXCEPTION agent:
      1. classify_exception() → severity + category
         ├── critical: lost package, safety incident → immediate human
         ├── high: failed delivery, customer complaint → attempt auto-resolve
         ├── medium: late delivery, partial failure → auto-resolve
         └── low: minor discrepancy, data quality → auto-resolve
      2. Resolution path:
         ├── auto_resolve() → apply known pattern:
         │   ├── Late delivery → send apology + updated ETA to customer
         │   ├── Driver no-show → trigger reassignment via ASSIGNMENT
         │   ├── Missing POD → request from driver via WhatsApp
         │   ├── Wrong address → flag for operator correction
         │   └── Data mismatch → correct record + log correction
         ├── escalate_to_human() → dashboard alert with context summary
         └── notify_supervisor() → WhatsApp/email to ops manager
      3. Update exception record with resolution or escalation details
```

## Deliverables

### Agent Core (`src/agents/exception/`)

- `exception-agent.ts` — agent definition:
  - Model: Claude Sonnet (`anthropic:claude-sonnet`) — complex reasoning for classification and resolution
  - System prompt: Chilean logistics exception handling, severity assessment, resolution patterns
  - Tools: `classify_exception`, `auto_resolve`, `escalate_to_human`, `notify_supervisor`
  - maxSteps: 6
- `exception-tools.ts` — tool definitions with Zod input schemas
- `exception-fallback.ts` — LLM down → all exceptions escalate to human (no automated resolution without reasoning)

### Shared Tools

- `src/tools/supabase/exceptions.ts` — **built in Phase 6 (COORD)**, extended here:
  - `create_exception` — introduced in Phase 6 (COORD needs it for driver problems)
  - `update_exception` — add resolution, change status, link to actions taken (new in this phase)
  - `get_exceptions_by_operator` — query for dashboard display (new in this phase)

### Resolution Patterns

Deterministic rules in tool code, Claude decides which applies:

| Pattern | Auto-Resolution | Triggers |
|---------|----------------|----------|
| Late delivery | Send apology to customer (WISMO), update ETA | `category: late_delivery` |
| Driver no-show | Enqueue reassignment job | `category: driver_no_show` |
| Missing POD | Send WA request to driver | `category: missing_pod` |
| Wrong address | Flag for operator, pause delivery | `category: wrong_address` |
| Data mismatch | Correct if clear, flag if ambiguous | `category: data_quality` |
| Customer complaint | Log, acknowledge to customer, escalate | `severity: high` |
| Safety incident | Immediate human escalation, no auto-resolve | `severity: critical` |

### Exception Lifecycle

Aligned with `exception_status_enum` in the data model:

```
open → auto_resolving (agent attempting resolution)
auto_resolving → auto_resolved (pattern matched, action taken)
auto_resolving → escalated (no pattern or resolution failed)
open → escalated (critical severity, skip auto-resolve)
escalated → human_resolved (operator resolved)
Any → dismissed (operator dismisses)
```

### Cross-Agent Actions

EXCEPTION agent can trigger actions in other domains:
- Enqueue `assignment.optimize { type: 'reoptimize' }` for reassignment
- Enqueue `wismo.client { type: 'proactive_*' }` for customer notifications
- Enqueue `whatsapp.outbound` for supervisor notifications

## Exit Criteria

- Exceptions from COORD, WISMO, SETTLE, INTAKE all route to exception queue
- Classification produces accurate severity levels (tested with representative examples)
- Known patterns auto-resolve: late delivery → apology sent, no-show → reassignment triggered, missing POD → driver contacted
- Unknown/critical patterns escalate with full context summary for operator
- Cross-agent job enqueuing works (exception → reassignment, exception → customer notification)
- Fallback: LLM down → all exceptions escalate to human
- Exception lifecycle transitions enforced
- `operator_id` on every query, audit events for every action
- All files under 300 lines with collocated tests
