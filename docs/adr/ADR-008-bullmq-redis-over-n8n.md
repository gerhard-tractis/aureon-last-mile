# ADR-008: BullMQ + Redis over n8n for Orchestration

**Status:** Accepted
**Date:** 2026-03-17
**Deciders:** Development Team
**Supersedes:** ADR-006 (Railway/n8n deferral -- n8n is now being decommissioned)

---

## Context

The existing `apps/worker` uses node-cron + PostgreSQL polling (`FOR UPDATE SKIP LOCKED`) for job scheduling. n8n was planned for workflow orchestration (ADR-006). As the system grows to include LLM-powered agents, document OCR, route optimization, and WhatsApp messaging, the orchestration layer needs reliable retry, rate limiting, priority queues, and concurrency control.

## Decision

Replace the current node-cron poller and decommission the planned n8n deployment. Use BullMQ backed by Redis for all job scheduling, retry, rate limiting, and cron triggers. BullMQ runs in `apps/agents/` on the existing VPS alongside `apps/worker` (which will be gradually migrated).

## Rationale

BullMQ provides exactly the primitives the agent system needs: named queues per agent domain, cron-repeatable jobs, exponential backoff retry, rate limiting (critical for WhatsApp API and LLM providers), job priority, and flow dependencies (parent/child jobs). All of this is configured in TypeScript, version-controlled, and testable.

The existing `apps/worker` poller (polling Postgres every 30s with `FOR UPDATE SKIP LOCKED`) works for 2 connectors but does not scale to dozens of concurrent agent operations with different retry/rate-limit needs. BullMQ's Redis-backed queues handle this natively.

## Rejected Alternatives

**n8n (visual workflow tool).** Originally planned per ADR-006. Rejected because: (1) n8n workflows are stored in n8n's internal DB, not version-controlled; (2) no native LLM tool-calling integration; (3) visual editor adds indirection when all developers work in TypeScript; (4) n8n's retry/error handling is per-node, not composable; (5) self-hosting n8n is another process to monitor. n8n is good for non-developer workflow automation but adds overhead for a TypeScript-native team.

**Temporal.io.** Durable workflow engine with replay. Rejected because: (1) requires a Temporal server cluster (Java/Go), adding operational complexity to the VPS; (2) overkill for the current scale (single operator, tens of thousands of orders/month); (3) learning curve for the workflow-as-code model. Would reconsider if multi-operator scale reaches 100K+ orders/month.

**Keep existing node-cron + Postgres polling.** Rejected because: (1) no rate limiting; (2) no priority queues; (3) polling interval creates latency (30s minimum); (4) no built-in retry with backoff; (5) `FOR UPDATE SKIP LOCKED` contention at scale. The current worker continues operating during migration but new agent work goes to BullMQ.

**AWS SQS / Google Cloud Tasks.** Managed queue services. Rejected because: (1) adds cloud vendor dependency when we run on a self-managed VPS; (2) network latency to cloud queue from Sao Paulo VPS; (3) cost scales with message volume; (4) Redis on VPS is zero additional cost.

## Consequences

- Redis becomes a critical dependency on the VPS (must be monitored, backed up)
- `apps/worker` continues running during migration; jobs gradually move to `apps/agents`
- BullMQ Dashboard (Bull Board) should be added for operational visibility
- n8n can be decommissioned once all workflows are migrated
