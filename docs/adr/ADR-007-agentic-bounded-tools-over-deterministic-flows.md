# ADR-007: Agentic with Bounded Tools over Deterministic BullMQ Flows

**Status:** Accepted
**Date:** 2026-03-17
**Deciders:** Development Team

---

## Context

The Aureon Agent Suite needs an execution model for logistics operations (ingestion, assignment, tracking, notifications). Two approaches were evaluated: deterministic state machines where every step is hardcoded in BullMQ flow definitions, or an agentic approach where LLM-powered agents select from bounded tool sets while BullMQ handles scheduling.

## Decision

Agents decide WHAT to do (selecting from a bounded set of TypeScript tool functions). BullMQ decides WHEN (cron, event-triggered, retry). Each agent has a fixed tool inventory scoped to its domain. The agent cannot call tools outside its boundary.

## Rationale

Logistics operations are semi-structured: 80% of orders follow the happy path, but 20% involve exceptions (address ambiguity, partial deliveries, SLA escalations, missing documents). Deterministic flows require a branch for every exception, leading to combinatorial explosion. An agent with tools can reason about novel combinations without new code.

Bounded tools (not open-ended function calling) prevent hallucination risk. The agent can only call `upsert_order`, `flag_exception`, `send_whatsapp` -- it cannot execute arbitrary code. If the agent fails to pick a tool, the system falls back to a rules-based default path.

## Rejected Alternatives

**Deterministic BullMQ state machines.** Every ingestion/assignment/notification path hardcoded as a BullMQ flow. Rejected because exception handling would require hundreds of branches. Adding a new client or exception type means code changes, not configuration. The 20% exception rate in Chilean last-mile makes this untenable.

**Fully autonomous agents (no tool boundaries).** Agents with unrestricted function calling. Rejected because compliance requires auditability of every action, and unbounded agents cannot guarantee they will stay within the operator's data boundary (operator_id isolation). Bounded tools enforce tenant isolation at the tool level.

**Hybrid: deterministic happy path + agent for exceptions only.** Conceptually appealing but creates two execution models to maintain. Agent observability and audit logging must work the same way regardless of path. Single model is simpler to operate.

## Consequences

- Every tool function must enforce operator_id isolation independently
- Agent decisions must be logged as Events (audit trail) with the tool selected and parameters
- Fallback rules must exist for every agent domain (if LLM is unavailable, system still works)
- Tool sets must be reviewed when adding new capabilities (security boundary)
