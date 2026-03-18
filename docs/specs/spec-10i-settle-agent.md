# Spec-10i: SETTLE Agent (Phase 8)

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> Architecture: `docs/architecture/agents.md` §3 (settle)
> API design: `docs/architecture/agents-api-design.md` §2

_Date: 2026-03-18_

---

## Goal

End-of-day reconciliation: verify deliveries against assignments, calculate driver pay per pay model, generate settlement reports with Chilean tax compliance (IVA, SII folios, CLP).

## Prerequisites

- Phase 5 (ASSIGNMENT — assignment records exist)
- Phase 6 (COORD — delivery status updates from drivers)

## Flow

```
BullMQ cron (10pm Santiago) → settle.reconcile queue
  → SETTLE agent:
      1. reconcile_orders()
         ├── Compare assignments vs actual delivery statuses
         ├── All delivered → mark assignment as settled
         ├── Partial → flag discrepancies
         └── Missing POD → flag for review
      2. calculate_driver_pay()
         ├── per_delivery: count × rate_per_delivery
         ├── per_km: total_distance × rate_per_km
         ├── fixed_daily: flat daily rate
         ├── hybrid: base_daily + per_delivery bonus
         └── Apply: bonuses, deductions, IVA (19%)
      3. generate_report()
         ├── Create settlement_period (status: calculating)
         ├── Add settlement_line_items per delivery
         ├── Calculate totals in CLP (NUMERIC 12,2)
         └── Track SII folio for Chilean tax compliance
      4. flag_discrepancy()
         ├── Assigned but no delivery status
         ├── Delivery confirmed but no POD
         └── Amount disputes → settlement status: disputed
```

## Deliverables

### Agent Core (`src/agents/settle/`)

- `settle-agent.ts` — agent definition:
  - Model: Claude Sonnet (`anthropic:claude-sonnet`) — financial accuracy critical, low volume (1×/day)
  - System prompt: Chilean logistics settlement, tax compliance, financial accuracy
  - Tools: `reconcile_orders`, `calculate_driver_pay`, `generate_report`, `flag_discrepancy`
  - maxSteps: 10
- `settle-tools.ts` — tool definitions with Zod input schemas
- `settle-fallback.ts` — LLM down → all settlements to `pending_review` (no automated financial decisions without reasoning)

### Shared Tools

- `src/tools/supabase/settlements.ts`:
  - `create_settlement_period` — opens new period for driver + date
  - `add_line_item` — individual delivery line with amounts
  - `update_settlement_status` — lifecycle transitions
  - `attach_document` — link invoice/receipt to settlement

### Pay Calculation

All math is deterministic in tool code (not LLM-generated):

- Read `drivers.pay_config` JSONB per driver:
  ```json
  {
    "model": "per_delivery",
    "rate_per_delivery": 3500,
    "bonus_threshold": 20,
    "bonus_per_extra": 500,
    "deduction_failed": 1000
  }
  ```
- Calculate gross per delivery line
- Apply bonuses (exceeded threshold) and deductions (failed deliveries)
- Calculate IVA (19%) on taxable amount
- All amounts in CLP with NUMERIC(12,2) precision
- Driver RUT tracked for SII compliance

Claude's role: validate edge cases, identify discrepancies that rules miss, generate human-readable discrepancy explanations.

### Settlement Lifecycle

```
open → calculating → pending_review → approved → paid
                                    → disputed (driver or operator flags)
disputed → pending_review (after resolution)
```

### Report Contents

Per driver per day:
- Line items: order_id, delivery status, amount, bonus/deduction
- Subtotal, IVA, total
- Discrepancy flags with reasons
- SII folio reference (when applicable)

## Exit Criteria

- Cron fires at 10pm Santiago, processes all day's assignments
- Driver pay calculated correctly per pay model (per_delivery, per_km, fixed_daily, hybrid)
- IVA (19%) applied correctly on taxable amounts
- Settlement line items match actual deliveries
- Discrepancies flagged: missing POD, unconfirmed deliveries, amount mismatches
- Settlement reports generated with correct CLP totals
- Disputed settlements handled (status transition)
- Fallback: LLM down → all settlements → `pending_review`
- `operator_id` on every query, audit events for every action
- All files under 300 lines with collocated tests
