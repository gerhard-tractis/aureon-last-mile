# Aureon Agent Suite — Implementation Plan

> Master plan for building the Agent Suite product.
> Architecture: `agents.md`, `agents-api-design.md`, `agents-data-model.sql`
> ADRs: 007–011

_Date: 2026-03-18_

---

## Phase Map

```
Phase 0: Scaffold + Infrastructure        ← apps/agents/ bootable process
Phase 1: Database Migration               ← 15 tables, enums, indexes, RLS
Phase 2: Orchestration + WhatsApp Webhook  ← BullMQ queues, cron, command bridge
Phase 3: INTAKE Agent (Camera)            ← Mobile camera → OCR → orders
Phase 4: OR-Tools Sidecar                 ← Python route optimization service
Phase 5: ASSIGNMENT Agent                 ← Order-to-driver optimization
Phase 6: COORD Agent                      ← WhatsApp driver coordination
Phase 7: WISMO Agent                      ← Client communication
Phase 8: SETTLE Agent                     ← End-of-day reconciliation
Phase 9: EXCEPTION Agent                  ← Cross-cutting deviation handling
Phase 10: INTAKE Expansion                ← Email + dashboard upload channels
```

## Dependency Graph

```
Spec-09 (monorepo cleanup)
  │
  ▼
Phase 0 (scaffold)
  │
  ▼
Phase 1 (database) ──────────────────┐
  │                                   │
  ▼                                   ▼
Phase 2 (orchestration) ──┐    Phase 4 (OR-Tools)
  │                       │           │
  ▼                       │           │
Phase 3 (INTAKE)          │           │
  │                       ▼           ▼
  │              Phase 5 (ASSIGNMENT) ←┘
  │                       │
  │                       ▼
  │              Phase 6 (COORD)
  │               │             │
  │               ▼             ▼
  │        Phase 7 (WISMO)  Phase 8 (SETTLE)
  │               │             │
  │               ▼             ▼
  │              Phase 9 (EXCEPTION) ←┘
  │
  ▼
Phase 10 (INTAKE expansion)
```

**Parallelizable:** Phases 3 and 4 can be developed concurrently (no mutual dependency). Phase 5 requires both.

## Phase Summary

| Phase | Spec | Dependencies | LLM Models | Key Deliverable |
|-------|------|-------------|------------|-----------------|
| 0 | `spec-10a` | Spec-09 | — | Bootable `apps/agents/` with providers, base-agent |
| 1 | `spec-10b` | Phase 0 | — | 15 tables, enums, indexes, RLS in Supabase |
| 2 | `spec-10c` | Phase 1 | — | 8 BullMQ queues, cron, WA webhook, command bridge |
| 3 | `spec-10d` | Phase 2 | Groq + GLM-OCR | Camera → OCR → customer match → orders |
| 4 | `spec-10e` | Phase 1 | — | Python VRPTW solver on VPS |
| 5 | `spec-10f` | Phase 2, 4 | Claude Sonnet | Optimized order-to-driver assignment |
| 6 | `spec-10g` | Phase 5 | Groq | WhatsApp driver lifecycle |
| 7 | `spec-10h` | Phase 2, 6 | Groq | Proactive + reactive client messaging |
| 8 | `spec-10i` | Phase 5, 6 | Claude Sonnet | Delivery reconciliation + driver pay |
| 9 | `spec-10j` | Phase 6, 7, 8 | Claude Sonnet | Deviation classification + auto-resolve |
| 10 | `spec-10k` | Phase 3 | Groq | Email IMAP + dashboard upload intake |

## Cross-Cutting Invariants (All Phases)

- **TDD always:** test file before implementation file
- **`operator_id`:** required parameter on every tool function, every query
- **Audit trail:** every agent action → `agent_events` row
- **Fallback:** every agent has rules-based fallback when LLM unavailable
- **File limits:** <300 lines per file
- **Collocated tests:** `*.test.ts` next to source
- **Soft deletes only:** `deleted_at` column, never hard delete
- **No upward imports:** `lib/ ← providers/ ← tools/ ← agents/ ← orchestration/ ← index.ts`

## Prerequisites

- **Spec-09 completed:** `packages/database/`, shared types, Turborepo, npm workspaces
- **VPS:** Redis 7 installed and running on 187.77.48.107
- **Supabase:** Project accessible with service role key

## Out of Scope

- Legacy connector migration (Easy CSV, Beetrack stay in `apps/worker`)
- Staging environment setup (separate spec post-implementation)
