# ADR-010: Python Sidecar for OR-Tools over Node.js Alternatives

**Status:** Accepted
**Date:** 2026-03-17
**Deciders:** Development Team

---

## Context

Route assignment optimization (assigning orders to drivers/vehicles considering capacity, time windows, zones, and vehicle constraints) requires a constraint programming or vehicle routing solver. Google OR-Tools CP-SAT is the industry standard for this class of problem. It is a Python/C++ library with no official Node.js binding.

## Decision

Run a Python HTTP sidecar on the VPS that exposes a `/solve` endpoint. The Node.js agent system sends a JSON payload (orders, vehicles, constraints) and receives an assignment solution. The sidecar runs as a separate systemd service alongside the Node.js agent process.

## Rationale

OR-Tools CP-SAT is the most capable open-source solver for vehicle routing problems (VRP) with time windows, capacity constraints, and zone preferences. It is written in C++ with Python bindings. The Python ecosystem (numpy, pandas) also simplifies data preprocessing for the solver input.

The sidecar pattern keeps the Node.js agent system clean (no Python interop complexity) and allows the solver to be scaled, updated, or replaced independently. Communication is a simple HTTP POST with a JSON payload, making the interface testable and language-agnostic.

## Rejected Alternatives

**Node.js constraint solvers (OptaPy/JS, or custom heuristics).** Rejected because: (1) no Node.js solver matches OR-Tools CP-SAT's capability for VRP with time windows; (2) custom heuristics (greedy assignment, nearest-neighbor) produce suboptimal routes, increasing fuel costs and delivery times; (3) maintaining a custom solver is a significant ongoing investment.

**Calling OR-Tools via child_process (Python script).** Rejected because: (1) process startup overhead on every solve call (~2-3s for Python + OR-Tools import); (2) no connection pooling or health checking; (3) error handling across process boundary is fragile. The HTTP sidecar amortizes startup cost and provides standard health/readiness endpoints.

**Cloud optimization API (Google Cloud Fleet Routing, AWS Route Optimization).** Rejected because: (1) per-request pricing scales with order volume; (2) network latency from VPS to cloud API; (3) vendor lock-in for a core business operation; (4) less control over solver parameters and constraints specific to Chilean last-mile (e.g., comuna-based zone preferences).

**Embedding Python in Node.js (node-calls-python, edge-py).** Rejected because: (1) fragile FFI bridge between Node.js and Python runtimes; (2) GIL contention if solver runs long; (3) debugging across language boundaries is painful; (4) deployment complexity (must install Python + OR-Tools in the Node.js container).

## Consequences

- Python 3.11+ and OR-Tools must be installed on the VPS
- Sidecar needs its own systemd service, health check, and monitoring
- Agent must handle sidecar timeout (solver may take 10-60s for large inputs) with a configurable deadline
- Solver input/output schema must be versioned (breaking changes require coordinated deploy)
- Second language in the monorepo (Python) but isolated to a single service
