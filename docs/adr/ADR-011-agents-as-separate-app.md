# ADR-011: apps/agents as Separate App over Extending apps/worker

**Status:** Accepted
**Date:** 2026-03-17
**Deciders:** Development Team

---

## Context

The existing `apps/worker` is a node-cron + Postgres polling system with two connectors (csv_email, beetrack browser scraper). The new agent system introduces BullMQ, Redis, LLM providers, WhatsApp API integration, and agentic tool execution. The question is whether to extend `apps/worker` or create `apps/agents/`.

## Decision

Create `apps/agents/` as a new application in the monorepo. `apps/worker` continues operating unchanged during the transition. Once all worker jobs are migrated to BullMQ queues in `apps/agents/`, the worker is decommissioned.

## Rationale

`apps/worker` has a fundamentally different execution model: synchronous poll loop, one job at a time, direct Postgres queries via `pg` Pool. The agent system needs concurrent BullMQ workers, Redis connections, LLM provider clients, and HTTP clients for external APIs. Grafting this onto the existing worker would require rewriting every module while keeping the existing connectors running -- a risky in-place migration.

Separate apps allow: (1) independent deployment and rollback; (2) different dependency trees (BullMQ + ioredis vs node-cron + pg); (3) incremental migration -- move one connector at a time from worker to agents; (4) different process supervision (worker is a single-loop process, agents is a multi-queue concurrent process).

Both apps share the same Supabase database and can read/write the same tables. The migration path is: new ingestion goes through agents, existing connectors stay in worker, move them one at a time.

## Rejected Alternatives

**Extend apps/worker in-place.** Add BullMQ alongside node-cron in the same process. Rejected because: (1) two scheduling systems in one process (node-cron and BullMQ) creates confusion about which system owns which job; (2) the worker's `FOR UPDATE SKIP LOCKED` polling and BullMQ's Redis-based queue are incompatible job-claiming mechanisms; (3) rollback is impossible if the migration breaks existing connectors.

**Replace apps/worker entirely (big bang).** Delete worker, rebuild everything in agents. Rejected because: (1) existing Easy CSV and Paris/Beetrack connectors must keep running during development; (2) big-bang rewrites have high failure risk; (3) no ability to A/B test old vs new ingestion paths.

**Supabase Edge Functions for agent logic.** Rejected because: (1) Edge Functions have execution time limits (wall-clock timeout); (2) no persistent connections to Redis; (3) no BullMQ support in Deno runtime; (4) cannot run Playwright for browser connectors.

## Consequences

- Two Node.js processes on VPS during migration (worker + agents)
- Must coordinate database schema changes that affect both apps
- Shared types should move to `packages/types` (currently duplicated)
- VPS systemd must manage both services with separate logs
- Worker decommission is a future milestone, not a prerequisite
