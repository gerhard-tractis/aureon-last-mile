# Spec-10e: OR-Tools Sidecar — Route Optimization (Phase 4)

**Status:** in progress

> Part of the Agent Suite implementation plan: `docs/architecture/agents-implementation-plan.md`
> Architecture: `docs/architecture/agents-api-design.md` §4
> ADR: `docs/adr/ADR-010-python-sidecar-for-or-tools.md`

_Date: 2026-03-18_

---

## Goal

Python HTTP microservice that solves VRPTW (Vehicle Routing Problem with Time Windows) using Google OR-Tools CP-SAT solver. Deployed on VPS as a systemd service alongside the Node.js agent process.

## Prerequisites

- Phase 1 (database — driver/order schemas exist for contract alignment)
- Python 3.11+ installed on VPS

## Architecture

```
ASSIGNMENT agent (Node.js)  →  HTTP POST  →  Python sidecar (:8090)
                            ←  JSON        ←  FastAPI + CP-SAT
```

## Deliverables

### Project Structure

```
sidecar/or-tools/
  solver.py              # FastAPI app + CP-SAT solver
  models.py              # Pydantic request/response models
  distance.py            # Haversine distance matrix calculation
  test_solver.py         # Test suite
  requirements.txt       # ortools, fastapi, uvicorn, numpy, pydantic
  Dockerfile             # Containerized deployment option
```

### API Contract

#### `POST /api/v1/optimize`

**Request:**
```json
{
  "operator_id": "uuid",
  "delivery_date": "YYYY-MM-DD",
  "orders": [{
    "id": "uuid",
    "lat": -33.45, "lng": -70.66,
    "time_window_start": "HH:MM",
    "time_window_end": "HH:MM",
    "service_time_minutes": 15,
    "weight_kg": 25.0, "volume_m3": 0.5,
    "priority": "urgent | alert | ok"
  }],
  "drivers": [{
    "id": "uuid", "name": "string",
    "start_lat": -33.45, "start_lng": -70.66,
    "end_lat": -33.45, "end_lng": -70.66,
    "shift_start": "HH:MM", "shift_end": "HH:MM",
    "max_weight_kg": 500, "max_volume_m3": 10,
    "max_stops": 30, "cost_per_km": 150
  }],
  "constraints": {
    "max_solve_time_seconds": 60,
    "allow_drops": true,
    "drop_penalty": 10000,
    "balance_routes": false
  }
}
```

**Response:**
```json
{
  "status": "optimal | feasible | infeasible | timeout",
  "solve_time_seconds": 12.3,
  "objective_value": 45000,
  "routes": [{
    "driver_id": "uuid",
    "stops": [{
      "order_id": "uuid",
      "sequence": 1,
      "arrival_time": "HH:MM",
      "departure_time": "HH:MM",
      "distance_from_prev_km": 3.2
    }],
    "total_distance_km": 45.0,
    "total_time_minutes": 180
  }],
  "unassigned_orders": [{
    "order_id": "uuid",
    "reason": "capacity | time_window | no_feasible_driver"
  }],
  "warnings": []
}
```

#### `GET /api/v1/health`

Returns `{ "status": "ok", "solver_version": "9.x" }`.

### Solver Capabilities

- **Capacity constraints:** weight, volume, max stops per driver
- **Time windows:** per-order delivery windows
- **Shift hours:** driver start/end times
- **Distance minimization:** Haversine-based distance matrix, cost_per_km weighting
- **Drop handling:** configurable penalty for unserviced orders
- **Route balancing:** optional even distribution across drivers
- **Priority handling:** urgent orders get higher drop penalty

### Timeout Strategy

- CP-SAT `max_solve_time_seconds` (default 60s)
- HTTP timeout from caller: 120s (AbortController)
- On timeout: return best feasible solution found so far (status: `timeout`)
- On infeasible: return empty routes + `unassigned_orders` with reasons

### Deployment

- systemd unit file: `aureon-solver.service`
- Runs as `aureon` user on port 8090
- Uvicorn with 2 workers
- Health check monitored by BetterStack

## Exit Criteria

- `GET /api/v1/health` responds 200
- 200 orders / 10 drivers solves within 60s
- Returns valid routes respecting all hard constraints (weight, volume, stops, time windows, shifts)
- Timeout returns best partial solution (not error)
- Infeasible inputs return `infeasible` status with per-order reasons
- Empty inputs (0 orders or 0 drivers) handled gracefully
- Test suite covers: small (10 orders), medium (100), large (200), edge cases (all same location, no feasible solution)
